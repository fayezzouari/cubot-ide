"""
The coding agent behind the IDE chat.

One turn is an agentic loop over Bedrock `invoke_model`: the model calls tools
(read, edit, create, compile, sandbox, web) until it answers in text. The loop
reports progress through an optional event sink so the client can stream a live
activity timeline, and returns the files it changed with enough data to revert them.
"""

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, Iterable, List, Optional

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from core.config import settings
from core.database import get_collection
from models.chat import (
    ChatRequest,
    ChatResponse,
    ChatMessageInDB,
    MessageRole,
    FileContext,
    StepExecutionRequest,
    StepExecutionResponse,
    ExecutionLogEntry,
)
from services.tools_definitions import FILE_TOOL_NAMES, get_tool_config
from services.tools_functions import handle_tool_use, project_snapshot, result_for_model

logger = logging.getLogger(__name__)

EventSink = Optional[Callable[[Dict[str, Any]], Awaitable[None]]]
TextSink = Optional[Callable[[str], Awaitable[None]]]

REASONING_TAGS = ("reasoning", "thinking", "analysis", "reflection")
_OPENERS = tuple(f"<{t}>" for t in REASONING_TAGS)


class _ReasoningFilter:
    """
    Drops <reasoning>…</reasoning> spans from a token stream. Some models emit their
    chain of thought as plain text; the final message strips it, so the live stream must too.
    Text that could be the start of a tag is held back until it resolves.
    """

    def __init__(self) -> None:
        self.buffer = ""
        self.closing: Optional[str] = None

    def feed(self, text: str) -> str:
        self.buffer += text
        out = ""
        while self.buffer:
            if self.closing:
                end = self.buffer.lower().find(self.closing)
                if end == -1:
                    if len(self.buffer) > len(self.closing) * 8:
                        self.buffer = self.buffer[-len(self.closing):]
                    return out
                self.buffer = self.buffer[end + len(self.closing):]
                self.closing = None
                continue
            lower = self.buffer.lower()
            starts = [(lower.find(o), o) for o in _OPENERS if lower.find(o) != -1]
            if starts:
                start, opener = min(starts)
                out += self.buffer[:start]
                self.buffer = self.buffer[start + len(opener):]
                self.closing = opener.replace("<", "</", 1)
                continue
            lt = self.buffer.rfind("<")
            if lt != -1 and any(o.startswith(lower[lt:]) for o in _OPENERS):
                out += self.buffer[:lt]
                self.buffer = self.buffer[lt:]
                return out
            out += self.buffer
            self.buffer = ""
        return out


def _assemble_claude_stream(chunks: Iterable[Dict[str, Any]], emit: Callable[[str], None]) -> Dict[str, Any]:
    """Rebuild a Messages-API response from its stream events, emitting text deltas on the way."""
    content: List[Dict[str, Any]] = []
    partial_json: Dict[int, str] = {}
    stop_reason = None
    for chunk in chunks:
        kind = chunk.get("type")
        if kind == "content_block_start":
            block = dict(chunk.get("content_block", {}))
            index = chunk.get("index", len(content))
            if block.get("type") == "tool_use":
                partial_json[index] = ""
                block["input"] = {}
            elif block.get("type") == "text":
                block["text"] = block.get("text", "")
            while len(content) <= index:
                content.append({})
            content[index] = block
        elif kind == "content_block_delta":
            index = chunk.get("index", 0)
            delta = chunk.get("delta", {})
            if delta.get("type") == "text_delta":
                text = delta.get("text", "")
                content[index]["text"] = content[index].get("text", "") + text
                emit(text)
            elif delta.get("type") == "input_json_delta":
                partial_json[index] = partial_json.get(index, "") + delta.get("partial_json", "")
        elif kind == "content_block_stop":
            index = chunk.get("index", 0)
            if index in partial_json:
                raw = partial_json.pop(index)
                try:
                    content[index]["input"] = json.loads(raw) if raw.strip() else {}
                except json.JSONDecodeError:
                    logger.warning("tool input was not valid JSON: %s", raw[:200])
                    content[index]["input"] = {}
        elif kind == "message_delta":
            stop_reason = chunk.get("delta", {}).get("stop_reason", stop_reason)
    return {"content": [b for b in content if b], "stop_reason": stop_reason}


def _assemble_openai_stream(chunks: Iterable[Dict[str, Any]], emit: Callable[[str], None]) -> Dict[str, Any]:
    """Rebuild a chat-completion response from its stream chunks, emitting text deltas on the way."""
    text = ""
    tool_calls: Dict[int, Dict[str, Any]] = {}
    finish_reason = None
    for chunk in chunks:
        for choice in chunk.get("choices", []):
            delta = choice.get("delta", {})
            piece = delta.get("content")
            if piece:
                text += piece
                emit(piece)
            for call in delta.get("tool_calls") or []:
                index = call.get("index", 0)
                slot = tool_calls.setdefault(index, {"id": None, "type": "function", "function": {"name": "", "arguments": ""}})
                if call.get("id"):
                    slot["id"] = call["id"]
                function = call.get("function", {})
                if function.get("name"):
                    slot["function"]["name"] += function["name"]
                if function.get("arguments"):
                    slot["function"]["arguments"] += function["arguments"]
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]
    message: Dict[str, Any] = {"role": "assistant", "content": text or None}
    if tool_calls:
        message["tool_calls"] = [tool_calls[i] for i in sorted(tool_calls)]
    return {"choices": [{"message": message, "finish_reason": finish_reason}]}

AGENT_NAME = "CuBot"
AGENT_TEMPERATURE = 0.2
MAX_HISTORY_MESSAGES = 12
MAX_HISTORY_CHARS = 6000
MAX_CHAT_ITERATIONS = 30
MAX_STEP_ITERATIONS = 20

# Compilers that `compile_project` can drive. ROS projects verify through the sandbox instead.
COMPILABLE = {"arduino", "ti_arm", "esp32"}


def _tool_label(name: str, tool_input: Dict[str, Any]) -> tuple[str, str]:
    """Human label and detail for the activity timeline."""
    path = tool_input.get("path", "")
    if name == "list_files":
        return "Listing project files", ""
    if name == "read_file":
        return "Reading", path
    if name == "create_file":
        return "Creating", path
    if name == "edit_file":
        return "Editing", path
    if name == "update_file":
        return "Rewriting", path
    if name == "compile_project":
        return "Compiling project", tool_input.get("main_file", "")
    if name == "execute_in_sandbox":
        return "Running", tool_input.get("command", "")
    if name == "search_web":
        return "Searching the web", tool_input.get("query", "")
    return name, ""


class AIService:
    """Coding agent on AWS Bedrock (Claude and OpenAI-compatible models)."""

    COLLECTION_NAME = "chat_messages"

    def __init__(self):
        self._bedrock_runtime = None

    # ------------------------------------------------------------------ Bedrock

    def _get_bedrock_runtime(self):
        if self._bedrock_runtime is None:
            config = BotoConfig(region_name=settings.AWS_REGION, retries={"max_attempts": 3, "mode": "standard"})
            self._bedrock_runtime = boto3.client("bedrock-runtime", config=config)
        return self._bedrock_runtime

    @staticmethod
    def _is_claude() -> bool:
        model_id = settings.BEDROCK_MODEL_ID.lower()
        return "claude" in model_id or "anthropic" in model_id

    async def _invoke(self, request_body: Dict[str, Any], on_text: TextSink = None) -> Dict[str, Any]:
        """
        Call the model off the event loop so streamed events keep flowing while it thinks.

        With `on_text`, the call uses the response stream: every text delta is handed to
        `on_text` as it arrives, and the assembled response is returned in the same shape
        as a non-streaming call, so the tool loops don't care which path ran.
        """
        client = self._get_bedrock_runtime()
        loop = asyncio.get_running_loop()
        is_claude = self._is_claude()

        def emit(text: str) -> None:
            if on_text and text:
                asyncio.run_coroutine_threadsafe(on_text(text), loop)

        def call_plain() -> Dict[str, Any]:
            response = client.invoke_model(
                modelId=settings.BEDROCK_MODEL_ID,
                body=json.dumps(request_body),
                contentType="application/json",
                accept="application/json",
            )
            return json.loads(response["body"].read())

        def call_stream() -> Dict[str, Any]:
            body = dict(request_body)
            if not is_claude:
                body["stream"] = True
            response = client.invoke_model_with_response_stream(
                modelId=settings.BEDROCK_MODEL_ID,
                body=json.dumps(body),
                contentType="application/json",
                accept="application/json",
            )
            chunks = (json.loads(ev["chunk"]["bytes"]) for ev in response["body"] if "chunk" in ev)
            return _assemble_claude_stream(chunks, emit) if is_claude else _assemble_openai_stream(chunks, emit)

        try:
            if on_text is None:
                return await asyncio.to_thread(call_plain)
            try:
                return await asyncio.to_thread(call_stream)
            except ClientError as e:
                # Some models reject the streaming API; fall back to one shot and emit the text at once.
                logger.warning("streaming invoke failed, falling back: %s", e)
                body = await asyncio.to_thread(call_plain)
                emit(self._text_of(body))
                return body
        except ClientError as e:
            message = e.response.get("Error", {}).get("Message", str(e))
            logger.error("Bedrock API error: %s", message)
            raise RuntimeError(f"Bedrock API error: {message}") from e

    def _text_of(self, body: Dict[str, Any]) -> str:
        """Text content of a response body, either model family."""
        if self._is_claude():
            return "".join(b.get("text", "") for b in body.get("content", []) if b.get("type") == "text")
        choices = body.get("choices", [])
        return (choices[0].get("message", {}).get("content") or "") if choices else ""

    # --------------------------------------------------------------- public API

    async def chat(self, project_id: str, request: ChatRequest) -> ChatResponse:
        """Non-streaming chat turn (kept for API clients that don't read SSE)."""
        try:
            result = await self._run_chat(project_id, request, on_event=None)
            return ChatResponse(**result)
        except Exception as e:
            logger.exception("chat failed")
            return ChatResponse(message=f"I hit an error: {e}", file_operations=[], execution_logs=[])

    async def chat_stream(self, project_id: str, request: ChatRequest) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Streaming chat turn. Yields activity events while the agent works, then one
        `done` event with the final message and file operations (or an `error` event).
        Cancelling the generator (client disconnect, stop button) cancels the agent loop.
        """
        queue: asyncio.Queue = asyncio.Queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def runner() -> None:
            try:
                result = await self._run_chat(project_id, request, on_event=emit)
                await queue.put({"type": "done", **result})
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("chat_stream failed")
                await queue.put({"type": "error", "message": str(e)})
            finally:
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield event
        finally:
            if not task.done():
                task.cancel()

    async def execute_step(self, project_id: str, request: StepExecutionRequest) -> StepExecutionResponse:
        """Execute one plan step with the full tool set."""
        try:
            has_sandbox = bool(request.workspace_id)
            can_compile = bool(request.compiler) and request.compiler in COMPILABLE and not has_sandbox
            snapshot = await project_snapshot(project_id, request.active_file_path)
            system_prompt = self._build_step_execution_prompt(
                request.step_title, request.step_body, request.compiler, snapshot,
                has_sandbox=has_sandbox, has_websearch=request.enable_websearch, can_compile=can_compile,
            )
            user_content = self._with_file_context(
                f"Execute this step now:\n\n**{request.step_title}**\n{request.step_body}", request.file_context
            )
            messages = [{"role": "user", "content": [{"type": "text", "text": user_content}]}]
            tool_config = get_tool_config(
                include_sandbox=has_sandbox, include_websearch=request.enable_websearch, include_compile=can_compile
            )
            text, file_operations, logs = await self._converse_with_tools(
                messages, system_prompt, tool_config, project_id,
                max_iterations=MAX_STEP_ITERATIONS, workspace_id=request.workspace_id, on_event=None,
            )
            failed_build = any(not log["success"] for log in logs if log["command"].startswith("compile"))
            return StepExecutionResponse(
                message=text,
                file_operations=file_operations,
                execution_logs=[ExecutionLogEntry(**log) for log in logs],
                success=not failed_build,
            )
        except Exception as e:
            logger.exception("execute_step failed")
            return StepExecutionResponse(message=f"Failed to execute step: {e}", success=False)

    # ---------------------------------------------------------------- one turn

    async def _run_chat(self, project_id: str, request: ChatRequest, on_event: EventSink) -> Dict[str, Any]:
        mode = "plan" if request.plan_mode else "build"
        history = self._history_messages(request.conversation_history)
        user_content = self._with_file_context(request.message, request.file_context)

        if request.plan_mode:
            if on_event:
                await on_event({"type": "status", "text": "Planning"})
            snapshot = await project_snapshot(project_id, request.active_file_path)
            text = await self.generate_text(
                system_prompt=self._build_plan_system_prompt(request.compiler, snapshot),
                user_prompt=user_content,
                history=[{"role": m["role"], "content": m["content"][0]["text"]} for m in history],
                max_tokens=4096,
                on_text=self._text_sink(on_event),
            )
            file_operations: List[Dict[str, Any]] = []
            logs: List[Dict[str, Any]] = []
        else:
            has_sandbox = bool(request.workspace_id)
            can_compile = bool(request.compiler) and request.compiler in COMPILABLE and not has_sandbox
            snapshot = await project_snapshot(project_id, request.active_file_path)
            system_prompt = self._build_system_prompt(
                request.compiler, snapshot, request.active_file_path,
                has_sandbox=has_sandbox, has_websearch=request.enable_websearch, can_compile=can_compile,
            )
            messages = history + [{"role": "user", "content": [{"type": "text", "text": user_content}]}]
            tool_config = get_tool_config(
                include_sandbox=has_sandbox, include_websearch=request.enable_websearch, include_compile=can_compile
            )
            text, file_operations, logs = await self._converse_with_tools(
                messages, system_prompt, tool_config, project_id,
                max_iterations=MAX_CHAT_ITERATIONS, workspace_id=request.workspace_id, on_event=on_event,
            )

        await self._save_message(project_id, MessageRole.USER, request.message, file_context=request.file_context, mode=mode)
        await self._save_message(project_id, MessageRole.ASSISTANT, text, file_operations=file_operations, mode=mode)
        return {"message": text, "file_operations": file_operations, "execution_logs": logs}

    @staticmethod
    def _history_messages(history: Optional[List[dict]]) -> List[Dict[str, Any]]:
        """Trim history to the recent window and cap each entry so one long paste can't eat the context."""
        out: List[Dict[str, Any]] = []
        for msg in (history or [])[-MAX_HISTORY_MESSAGES:]:
            role = msg.get("role")
            content = (msg.get("content") or "").strip()
            if role not in ("user", "assistant") or not content or content == "...":
                continue
            if len(content) > MAX_HISTORY_CHARS:
                content = content[:MAX_HISTORY_CHARS] + "\n…[truncated]"
            # Bedrock rejects two consecutive messages with the same role; merge them.
            if out and out[-1]["role"] == role:
                out[-1]["content"][0]["text"] += "\n\n" + content
            else:
                out.append({"role": role, "content": [{"type": "text", "text": content}]})
        if out and out[0]["role"] == "assistant":
            out = out[1:]
        return out

    @staticmethod
    def _with_file_context(message: str, file_context: Optional[List[FileContext]]) -> str:
        if not file_context:
            return message
        parts = ["--- CONTEXT FROM THE EDITOR ---"]
        for fc in file_context:
            parts.append(f"\n### {fc.path}\n```\n{fc.content}\n```")
        parts.append("--- END CONTEXT ---\n")
        return "\n".join(parts) + "\n" + message

    # --------------------------------------------------------------- tool loop

    async def _converse_with_tools(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str,
        tool_config: Dict[str, Any],
        project_id: str,
        max_iterations: int,
        workspace_id: Optional[str],
        on_event: EventSink,
    ) -> tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Run the agentic loop. Returns (final_text, file_operations, execution_logs)."""
        if self._is_claude():
            return await self._converse_claude(messages, system_prompt, tool_config, project_id, max_iterations, workspace_id, on_event)
        return await self._converse_openai(messages, system_prompt, tool_config, project_id, max_iterations, workspace_id, on_event)

    async def _run_tool(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        project_id: str,
        workspace_id: Optional[str],
        file_operations: List[Dict[str, Any]],
        execution_logs: List[Dict[str, Any]],
        on_event: EventSink,
        call_id: str,
    ) -> Dict[str, Any]:
        """Execute one tool call, record its side effects and report progress."""
        label, detail = _tool_label(tool_name, tool_input)
        if on_event:
            await on_event({"type": "tool_start", "id": call_id, "tool": tool_name, "label": label, "detail": detail})

        result = await handle_tool_use(tool_name, tool_input, project_id, workspace_id)
        ok = bool(result.get("success"))

        file_op = None
        if tool_name in FILE_TOOL_NAMES and ok:
            file_op = {
                "operation": result.get("operation", tool_name),
                "path": result.get("path"),
                "file_id": result.get("file_id"),
                "summary": result.get("summary"),
                "added": result.get("added", 0),
                "removed": result.get("removed", 0),
                "previous_content": result.get("previous_content"),
                "success": True,
            }
            file_operations.append(file_op)

        log = None
        if tool_name == "execute_in_sandbox":
            log = {
                "command": tool_input.get("command", ""),
                "stdout": result.get("stdout", ""),
                "stderr": result.get("stderr", "") or result.get("error", ""),
                "exit_code": result.get("exit_code", -1),
                "success": ok,
            }
            execution_logs.append(log)
        elif tool_name == "compile_project":
            log = {
                "command": f"compile ({result.get('compiler', 'project')})",
                "stdout": result.get("output", ""),
                "stderr": "\n".join(result.get("errors", [])) or result.get("error", ""),
                "exit_code": 0 if ok else 1,
                "success": ok,
            }
            execution_logs.append(log)

        if on_event:
            await on_event({
                "type": "tool_end",
                "id": call_id,
                "tool": tool_name,
                "label": label,
                "detail": detail,
                "ok": ok,
                "summary": result.get("message") or result.get("error") or "",
                "file_op": file_op,
                "log": log,
            })
        return result

    async def _converse_claude(self, messages, system_prompt, tool_config, project_id, max_iterations, workspace_id, on_event):
        file_operations: List[Dict[str, Any]] = []
        execution_logs: List[Dict[str, Any]] = []
        messages = list(messages)
        on_text = self._text_sink(on_event)
        transcript: List[str] = []
        anthropic_tools = [{
            "name": t["toolSpec"]["name"],
            "description": t["toolSpec"]["description"],
            "input_schema": t["toolSpec"]["inputSchema"]["json"],
        } for t in tool_config.get("tools", [])]

        for _ in range(max_iterations):
            if on_event:
                await on_event({"type": "status", "text": "Thinking"})
            body = await self._invoke({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 8192,
                "system": system_prompt,
                "messages": messages,
                "temperature": AGENT_TEMPERATURE,
                "tools": anthropic_tools,
            }, on_text=on_text)
            content = body.get("content", [])
            stop_reason = body.get("stop_reason")
            messages.append({"role": "assistant", "content": content})

            text = "".join(b.get("text", "") for b in content if b.get("type") == "text").strip()
            if text:
                transcript.append(text)
            if stop_reason != "tool_use":
                return self._strip_reasoning_tags("\n\n".join(transcript)), file_operations, execution_logs

            tool_results = []
            for block in content:
                if block.get("type") != "tool_use":
                    continue
                result = await self._run_tool(
                    block.get("name"), block.get("input", {}), project_id, workspace_id,
                    file_operations, execution_logs, on_event, block.get("id"),
                )
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.get("id"),
                    "content": [{"type": "text", "text": json.dumps(result_for_model(result))}],
                    **({} if result.get("success") else {"is_error": True}),
                })
            messages.append({"role": "user", "content": tool_results})

        return self._iteration_cap_message(file_operations, transcript), file_operations, execution_logs

    async def _converse_openai(self, messages, system_prompt, tool_config, project_id, max_iterations, workspace_id, on_event):
        file_operations: List[Dict[str, Any]] = []
        execution_logs: List[Dict[str, Any]] = []

        openai_messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            content = msg.get("content", [])
            if isinstance(content, list):
                text = "".join(b.get("text", "") for b in content if isinstance(b, dict))
            else:
                text = str(content)
            openai_messages.append({"role": msg.get("role"), "content": text})

        openai_tools = [{
            "type": "function",
            "function": {
                "name": t["toolSpec"]["name"],
                "description": t["toolSpec"]["description"],
                "parameters": t["toolSpec"]["inputSchema"]["json"],
            },
        } for t in tool_config.get("tools", [])]

        on_text = self._text_sink(on_event)
        transcript: List[str] = []

        for _ in range(max_iterations):
            if on_event:
                await on_event({"type": "status", "text": "Thinking"})
            body = await self._invoke({
                "model": settings.BEDROCK_MODEL_ID,
                "messages": openai_messages,
                "tools": openai_tools,
                "tool_choice": "auto",
                "temperature": AGENT_TEMPERATURE,
                "max_tokens": 8192,
            }, on_text=on_text)
            choices = body.get("choices", [])
            if not choices:
                return "The model returned no response.", file_operations, execution_logs

            message = choices[0].get("message", {})
            tool_calls = message.get("tool_calls") or []
            openai_messages.append(message)

            text = (message.get("content") or "").strip()
            if text:
                transcript.append(text)
            if not tool_calls:
                return self._strip_reasoning_tags("\n\n".join(transcript)), file_operations, execution_logs

            for call in tool_calls:
                function = call.get("function", {})
                try:
                    args = json.loads(function.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await self._run_tool(
                    function.get("name"), args, project_id, workspace_id,
                    file_operations, execution_logs, on_event, call.get("id"),
                )
                openai_messages.append({
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "content": json.dumps(result_for_model(result)),
                })

        return self._iteration_cap_message(file_operations, transcript), file_operations, execution_logs

    @staticmethod
    def _text_sink(on_event: EventSink) -> TextSink:
        """Turn the event sink into a text-delta sink for the model stream, minus reasoning tags."""
        if on_event is None:
            return None
        strip = _ReasoningFilter()

        async def sink(text: str) -> None:
            visible = strip.feed(text)
            if visible:
                await on_event({"type": "text_delta", "text": visible})

        return sink

    @staticmethod
    def _iteration_cap_message(file_operations: List[Dict[str, Any]], transcript: List[str]) -> str:
        changed = sorted({op["path"] for op in file_operations if op.get("path")})
        if changed:
            files = ", ".join(f"`{p}`" for p in changed)
            note = f"I stopped after reaching the step limit for one turn. Files changed so far: {files}. Ask me to continue if the task is not finished."
        else:
            note = "I stopped after reaching the step limit for one turn without finishing. Ask me to continue."
        return "\n\n".join(transcript + [note])

    @staticmethod
    def _strip_reasoning_tags(text: str) -> str:
        for tag in REASONING_TAGS:
            text = re.sub(rf"<{tag}>.*?</{tag}>", "", text, flags=re.DOTALL | re.IGNORECASE)
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    # ----------------------------------------------------------------- prompts

    @staticmethod
    def _platform_line(compiler: Optional[str]) -> str:
        names = {"arduino": "Arduino (AVR)", "esp32": "ESP32 (Arduino core)", "ti_arm": "TI ARM Cortex-M"}
        if not compiler:
            return ""
        return f"Target platform: {names.get(compiler, compiler)}. Use its idioms, pin conventions and libraries.\n"

    def _build_system_prompt(
        self, compiler: Optional[str], snapshot: str, active_path: Optional[str],
        has_sandbox: bool, has_websearch: bool, can_compile: bool,
    ) -> str:
        verify = ""
        if can_compile:
            verify = (
                "4. After changing code, call compile_project. If the build fails, read the errors, fix them "
                "and compile again (at most 3 rounds). Do not report success without a passing build.\n"
            )
        elif has_sandbox:
            verify = (
                "4. After changing code, verify it in the sandbox with execute_in_sandbox (build or run a test). "
                "Fix what fails and re-run.\n"
            )
        web = "- search_web is available for information newer than your training data (library APIs, datasheets).\n" if has_websearch else ""
        open_file = (
            f"The user has `{active_path}` open in the editor; its content is in the context. "
            "Requests that name no file refer to this one.\n"
        ) if active_path else ""

        return f"""You are {AGENT_NAME}, the AI coding agent inside CuBot IDE. You work on embedded and robotics projects: Arduino, ESP32, TI ARM and ROS 2.
{self._platform_line(compiler)}{open_file}
## Project files (snapshot at the start of this turn)
{snapshot}

## How you work
1. Understand the request. If the open file or a selection is already in the context, do not read it again.
   Go through the whole file line by line and list every problem you find before touching anything:
   a request like "fix the error" means fix all of them, not the first one.
2. Read any other file before changing it (read_file). Use the full paths listed above.
3. Make changes with tools, never by pasting code into your reply:
   - edit_file for targeted changes (preferred: replace one exact span),
   - update_file only when most of the file changes,
   - create_file for new files.
{verify}5. Finish with a short summary.
{web}
## Reply format
- 1 to 5 bullet points: what changed and why, with file paths in backticks.
- Do not paste whole files; the editor shows the diff.
- If something blocked you, say exactly what.
- Pure questions or explanations that need no file changes: answer directly, short code snippets are fine.

## Rules
- Keep the user's style and the existing structure; make the smallest change that solves the request.
- Fix every occurrence of a problem, not only the first one you see; re-read the file after editing when in doubt.
- Do not add comments to code unless the user asks for them.
- Include every needed #include / import. Respect memory and timing limits of the target.
- ROS packages: register new nodes in package.xml, CMakeLists.txt or setup.py.
- Never claim that code builds or runs unless a tool result showed it. If compile_project fails for a
  reason unrelated to the code (tool error, missing toolchain), say the build was not verified.
"""

    def _build_plan_system_prompt(self, compiler: Optional[str], snapshot: str) -> str:
        return f"""You are {AGENT_NAME}, the AI coding agent inside CuBot IDE, in planning mode.
{self._platform_line(compiler)}
## Project files
{snapshot}

## Your task
Write an implementation plan for the user's request. Do not create or modify files, do not call tools.

## Output format (exactly this, nothing else)
Optional one-line intro, then:

**Step N: Short title**
What to do in this step: files to touch (full paths), functions, key code fragments if they help.

## Rules
- Number steps from 1. Each step is one concrete, independently executable task.
- Order steps so each builds on the previous one.
- 2 to 8 steps. Merge trivial steps, split large ones.
- The last step verifies the result (build, run or test).
"""

    def _build_step_execution_prompt(
        self, step_title: str, step_body: str, compiler: Optional[str], snapshot: str,
        has_sandbox: bool, has_websearch: bool, can_compile: bool,
    ) -> str:
        verify = ""
        if can_compile:
            verify = "4. If you changed code, call compile_project and fix errors until it passes (max 3 rounds).\n"
        elif has_sandbox:
            verify = "4. If a build or test applies, run it with execute_in_sandbox and fix what fails.\n"
        web = "Use search_web when you need current documentation.\n" if has_websearch else ""
        return f"""You are {AGENT_NAME}, the AI coding agent inside CuBot IDE, executing one step of an approved plan.
{self._platform_line(compiler)}
## Project files
{snapshot}

## Step to execute
**{step_title}**
{step_body}

## How you work
1. Execute only this step; do not start later steps.
2. Read files before changing them. Use full paths as listed.
3. Prefer edit_file; use update_file for rewrites and create_file for new files. Do not add comments to code.
{verify}5. Finish with 1 to 3 bullet points describing what you did. No full file dumps.
{web}"""

    # ----------------------------------------------------------------- storage

    async def _save_message(
        self, project_id: str, role: MessageRole, content: str,
        file_context: Optional[List[FileContext]] = None,
        file_operations: Optional[List[dict]] = None,
        mode: Optional[str] = None,
    ) -> None:
        collection = get_collection(self.COLLECTION_NAME)
        await collection.insert_one({
            "project_id": project_id,
            "role": role.value,
            "content": content,
            "timestamp": datetime.utcnow(),
            "file_context": [fc.model_dump() for fc in file_context] if file_context else [],
            "file_operations": file_operations or [],
            "mode": mode,
        })

    async def get_chat_history(self, project_id: str, limit: int = 50) -> List[ChatMessageInDB]:
        collection = get_collection(self.COLLECTION_NAME)
        cursor = collection.find({"project_id": project_id}).sort("timestamp", 1).limit(limit)
        messages = []
        async for doc in cursor:
            messages.append(ChatMessageInDB(
                id=str(doc["_id"]),
                project_id=doc["project_id"],
                role=doc["role"],
                content=doc["content"],
                timestamp=doc["timestamp"],
                file_context=doc.get("file_context", []),
                file_operations=doc.get("file_operations", []),
                mode=doc.get("mode"),
            ))
        return messages

    async def clear_chat_history(self, project_id: str) -> None:
        collection = get_collection(self.COLLECTION_NAME)
        await collection.delete_many({"project_id": project_id})

    async def apply_file_operations(self, project_id: str, operations: List[dict]) -> List[dict]:
        """Apply a list of file operations (legacy endpoint)."""
        results = []
        for op in operations:
            operation_type = op.get("operation")
            if operation_type in ("create_file", "update_file", "edit_file"):
                results.append(await handle_tool_use(operation_type, op, project_id))
            else:
                results.append({"path": op.get("path", "unknown"), "success": False, "error": f"Unknown operation: {operation_type}"})
        return results

    # ------------------------------------------------------------- plain text

    async def explain_compile_logs(
        self, project_id: str, logs: str, errors: Optional[List[str]] = None, compiler: Optional[str] = None,
    ) -> str:
        system_prompt = (
            f"You are {AGENT_NAME}, an embedded systems assistant. Explain compile output concisely"
            f"{' for ' + compiler if compiler else ''}. One sentence on the root cause, then at most two fixes."
        )
        user_prompt = f"Logs:\n{logs}\n\nErrors:\n" + "\n".join(errors or [])
        return await self.generate_text(system_prompt=system_prompt, user_prompt=user_prompt, max_tokens=300)

    async def generate_text(
        self, system_prompt: str, user_prompt: str,
        history: Optional[List[Dict[str, str]]] = None, max_tokens: int = 4096,
        on_text: TextSink = None,
    ) -> str:
        """Single completion without tools. Used by plan mode and by other services."""
        is_claude = self._is_claude()
        messages: List[Dict[str, Any]] = []
        for msg in history or []:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            messages.append({"role": role, "content": [{"type": "text", "text": content}] if is_claude else content})
        messages.append({"role": "user", "content": [{"type": "text", "text": user_prompt}] if is_claude else user_prompt})

        if is_claude:
            body = await self._invoke({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "system": system_prompt,
                "messages": messages,
                "temperature": AGENT_TEMPERATURE,
            }, on_text=on_text)
            text = "".join(b.get("text", "") for b in body.get("content", []) if b.get("type") == "text")
            return self._strip_reasoning_tags(text)

        body = await self._invoke({
            "model": settings.BEDROCK_MODEL_ID,
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": AGENT_TEMPERATURE,
            "max_tokens": max_tokens,
        }, on_text=on_text)
        choices = body.get("choices", [])
        if not choices:
            return ""
        return self._strip_reasoning_tags(choices[0].get("message", {}).get("content") or "")


ai_service = AIService()
