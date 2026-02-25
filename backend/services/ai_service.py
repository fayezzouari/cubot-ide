import json
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime
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
from services.tools_definitions import get_tool_config
from services.tools_functions import handle_tool_use

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


class AIService:
    """Service for AI-powered code generation using AWS Bedrock with Converse API"""
    
    COLLECTION_NAME = "chat_messages"
    
    def __init__(self):
        self._bedrock_runtime = None
    
    def _get_bedrock_runtime(self):
        """Get Bedrock runtime client (lazy initialization)"""
        if self._bedrock_runtime is None:
            config = BotoConfig(
                region_name=settings.AWS_REGION,
                retries={"max_attempts": 3, "mode": "standard"}
            )
            self._bedrock_runtime = boto3.client(
                "bedrock-runtime",
                config=config,
            )
        return self._bedrock_runtime
    
    async def chat(
        self,
        project_id: str,
        request: ChatRequest,
    ) -> ChatResponse:
        """
        Process a chat request using Bedrock Converse API with tools
        
        Args:
            project_id: The project ID for context
            request: The chat request with message and optional file context
        
        Returns:
            ChatResponse with AI-generated content and file operations
        """
        try:
            # Build system prompt
            system_prompt = self._build_system_prompt(request.compiler)
            
            # Build messages array
            messages = []
            
            # Add conversation history if provided
            if request.conversation_history:
                for msg in request.conversation_history[-10:]:  # Last 10 messages
                    role = msg.get("role", "user")
                    content = msg.get("content", "")
                    if role and content:
                        messages.append({
                            "role": role,
                            "content": [{"text": content}]
                        })
            
            # Build current user message with file context
            user_content = request.message
            if request.file_context:
                context_section = "\n\n--- FILE CONTEXT ---\n"
                for fc in request.file_context:
                    context_section += f"\n### {fc.path}\n```\n{fc.content}\n```\n"
                context_section += "\n--- END FILE CONTEXT ---\n\n"
                user_content = context_section + user_content
            
            messages.append({
                "role": "user",
                "content": [{"text": user_content}]
            })
            
            # In plan mode skip tool use — the AI just returns a structured plan text
            if request.plan_mode:
                response_text = await self.generate_text(
                    system_prompt=self._build_plan_system_prompt(request.compiler),
                    user_prompt=user_content,
                    max_tokens=4096,
                )
                file_operations = []
            else:
                # Get tool configuration and run agentic loop
                tool_config = get_tool_config()
                response_text, file_operations, _ = await self._converse_with_tools(
                    messages=messages,
                    system_prompt=system_prompt,
                    tool_config=tool_config,
                    project_id=project_id,
                    max_iterations=50,
                )
            
            # Save messages to database
            await self._save_message(
                project_id=project_id,
                role=MessageRole.USER,
                content=request.message,
                file_context=request.file_context,
            )
            
            await self._save_message(
                project_id=project_id,
                role=MessageRole.ASSISTANT,
                content=response_text,
                file_operations=file_operations,
            )
            
            return ChatResponse(
                message=response_text,
                file_operations=file_operations,
            )
            
        except Exception as e:
            logger.error(f"Error in chat: {str(e)}")
            error_message = f"I encountered an error: {str(e)}"
            return ChatResponse(
                message=error_message,
                file_operations=[],
            )
    
    async def _converse_with_tools(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str,
        tool_config: Dict[str, Any],
        project_id: str,
        max_iterations: int = 5,
        workspace_id: Optional[str] = None,
    ) -> tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Use Bedrock with tool support.
        Supports both Claude and OpenAI models.
        Returns (response_text, file_operations, execution_logs).
        """
        # Detect model type from model ID
        model_id = settings.BEDROCK_MODEL_ID.lower()
        is_claude = "claude" in model_id or "anthropic" in model_id
        is_openai = "gpt" in model_id or "openai" in model_id

        logger.info(f"Using model: {settings.BEDROCK_MODEL_ID}, Claude: {is_claude}, OpenAI: {is_openai}")

        if is_claude:
            return await self._converse_claude(
                messages, system_prompt, tool_config, project_id, max_iterations, workspace_id
            )
        else:
            return await self._converse_openai(
                messages, system_prompt, tool_config, project_id, max_iterations, workspace_id
            )
    
    async def _converse_openai(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str,
        tool_config: Dict[str, Any],
        project_id: str,
        max_iterations: int = 5,
        workspace_id: Optional[str] = None,
    ) -> tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Use Bedrock with OpenAI models (GPT-4, etc.)
        Returns (response_text, file_operations, execution_logs).
        """
        client = self._get_bedrock_runtime()
        file_operations = []
        execution_logs = []
        
        # Convert messages to OpenAI format
        openai_messages = []
        
        # Add system message
        openai_messages.append({
            "role": "system",
            "content": system_prompt
        })
        
        # Convert existing messages
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", [])
            
            # Extract text from content blocks
            if isinstance(content, list):
                text_content = ""
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text_content += block.get("text", "")
                    elif isinstance(block, dict) and block.get("text"):
                        text_content += block["text"]
                openai_messages.append({
                    "role": role,
                    "content": text_content
                })
            else:
                openai_messages.append({
                    "role": role,
                    "content": str(content)
                })
        
        # Convert tools to OpenAI format
        openai_tools = []
        for tool in tool_config.get("tools", []):
            tool_spec = tool.get("toolSpec", {})
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool_spec.get("name"),
                    "description": tool_spec.get("description"),
                    "parameters": tool_spec.get("inputSchema", {}).get("json", {})
                }
            })
        
        for iteration in range(max_iterations):
            logger.info(f"OpenAI iteration {iteration + 1}")

            try:
                # Force tool use on the first call so the model can't skip tools
                # by returning text only.  Once at least one tool result has been
                # sent back we switch to "auto" so the model can produce the final
                # text summary without being forced to call another tool.
                has_tool_results = any(m.get("role") == "tool" for m in openai_messages)
                tool_choice = "auto" if has_tool_results else "required"

                # Prepare request body for OpenAI
                request_body = {
                    "model": settings.BEDROCK_MODEL_ID,
                    "messages": openai_messages,
                    "tools": openai_tools,
                    "tool_choice": tool_choice,
                    "temperature": 0.7,
                    "max_tokens": 4096
                }
                
                # Call Bedrock
                response = client.invoke_model(
                    modelId=settings.BEDROCK_MODEL_ID,
                    body=json.dumps(request_body),
                    contentType="application/json",
                    accept="application/json",
                )
                
                response_body = json.loads(response["body"].read())
                logger.info(f"Response keys: {response_body.keys()}")
                
                # Extract response
                choices = response_body.get("choices", [])
                if not choices:
                    return "No response from model", file_operations
                
                choice = choices[0]
                message = choice.get("message", {})
                finish_reason = choice.get("finish_reason")
                
                logger.info(f"Finish reason: {finish_reason}")
                
                # Add assistant message to history
                openai_messages.append(message)
                
                if finish_reason == "tool_calls":
                    # Tool use requested
                    tool_calls = message.get("tool_calls", [])
                    
                    for tool_call in tool_calls:
                        function = tool_call.get("function", {})
                        tool_name = function.get("name")
                        tool_args = json.loads(function.get("arguments", "{}"))
                        tool_call_id = tool_call.get("id")
                        
                        logger.info(f"Tool requested: {tool_name}, ID: {tool_call_id}")
                        
                        # Execute the tool
                        tool_result = await handle_tool_use(
                            tool_name=tool_name,
                            tool_input=tool_args,
                            project_id=project_id,
                            workspace_id=workspace_id,
                        )
                        logger.info(f"Tool result for {tool_name} (id={tool_call_id}): {tool_result}")

                        # Track file operations
                        if tool_name in ["create_file", "update_file"] and tool_result.get("success"):
                            file_operations.append({
                                "operation": tool_name,
                                "path": tool_result.get("path"),
                                "file_id": tool_result.get("file_id"),
                                "success": True,
                            })

                        # Track sandbox executions
                        if tool_name == "execute_in_sandbox":
                            execution_logs.append({
                                "command": tool_args.get("command", ""),
                                "stdout": tool_result.get("stdout", ""),
                                "stderr": tool_result.get("stderr", ""),
                                "exit_code": tool_result.get("exit_code", -1),
                                "success": tool_result.get("success", False),
                            })

                        # Add tool result to messages
                        openai_messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": json.dumps(tool_result)
                        })

                    # Continue loop to get final response
                    continue

                else:
                    # Model finished
                    response_text = message.get("content", "")
                    return response_text.strip(), file_operations, execution_logs
                    
            except ClientError as e:
                error_msg = e.response['Error']['Message']
                logger.error(f"Bedrock API error: {error_msg}")
                raise Exception(f"Bedrock API error: {error_msg}")
            except Exception as e:
                logger.error(f"Unexpected error: {str(e)}")
                raise

        return "Completed operations", file_operations, execution_logs

    async def _converse_claude(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str,
        tool_config: Dict[str, Any],
        project_id: str,
        max_iterations: int = 5,
        workspace_id: Optional[str] = None,
    ) -> tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Use Bedrock with Claude models.
        Returns (response_text, file_operations, execution_logs).
        """
        client = self._get_bedrock_runtime()
        file_operations = []
        execution_logs = []
        
        # Prepare system message
        system = [{"text": system_prompt}]
        
        for iteration in range(max_iterations):
            logger.info(f"Converse iteration {iteration + 1}")
            
            try:
                # Prepare request body for invoke_model
                request_body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "messages": messages,
                    "temperature": 0.7,
                    "tools": tool_config["tools"]
                }
                
                # Call Bedrock using invoke_model
                response = client.invoke_model(
                    modelId=settings.BEDROCK_MODEL_ID,
                    body=json.dumps(request_body),
                    contentType="application/json",
                    accept="application/json",
                )
                
                response_body = json.loads(response["body"].read())
                logger.info(f"Response body keys: {response_body.keys()}")
                
                # Extract stop reason and content
                stop_reason = response_body.get("stop_reason")
                content = response_body.get("content", [])
                
                logger.info(f"Stop reason: {stop_reason}")
                
                # Build output message
                output_message = {
                    "role": "assistant",
                    "content": content
                }
                messages.append(output_message)
                
                if stop_reason == 'tool_use':
                    # Tool use requested - handle it
                    tool_results = []
                    
                    for content_block in content:
                        if content_block.get("type") == "tool_use":
                            tool_use_id = content_block.get("id")
                            tool_name = content_block.get("name")
                            tool_input = content_block.get("input", {})
                            
                            logger.info(f"Tool requested: {tool_name}, ID: {tool_use_id}")
                            
                            # Execute the tool
                            tool_result_content = await handle_tool_use(
                                tool_name=tool_name,
                                tool_input=tool_input,
                                project_id=project_id,
                                workspace_id=workspace_id,
                            )
                            logger.info(f"Tool result for {tool_name} (id={tool_use_id}): {tool_result_content}")

                            # Track file operations
                            if tool_name in ["create_file", "update_file"] and tool_result_content.get("success"):
                                file_operations.append({
                                    "operation": tool_name,
                                    "path": tool_result_content.get("path"),
                                    "file_id": tool_result_content.get("file_id"),
                                    "success": True,
                                })

                            # Track sandbox executions
                            if tool_name == "execute_in_sandbox":
                                execution_logs.append({
                                    "command": tool_input.get("command", ""),
                                    "stdout": tool_result_content.get("stdout", ""),
                                    "stderr": tool_result_content.get("stderr", ""),
                                    "exit_code": tool_result_content.get("exit_code", -1),
                                    "success": tool_result_content.get("success", False),
                                })
                            
                            # Prepare tool result for model - must be a string or list of content blocks
                            if tool_result_content.get("success"):
                                # Success - return as JSON string in content
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": tool_use_id,
                                    "content": [{"type": "text", "text": json.dumps(tool_result_content)}]
                                })
                            else:
                                # Error - return error message
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": tool_use_id,
                                    "content": [{"type": "text", "text": tool_result_content.get("error", "Unknown error")}],
                                    "is_error": True
                                })
                    
                    # Send tool results back to model
                    if tool_results:
                        tool_result_message = {
                            "role": "user",
                            "content": tool_results
                        }
                        messages.append(tool_result_message)
                    
                    # Continue the loop to get final response
                    continue
                    
                elif stop_reason == 'end_turn':
                    # Model finished - extract text response
                    response_text = ""
                    for content_block in content:
                        if content_block.get("type") == "text":
                            response_text += content_block.get("text", "")
                    return response_text.strip(), file_operations, execution_logs

                else:
                    # Other stop reasons (max_tokens, etc.)
                    response_text = ""
                    for content_block in content:
                        if content_block.get("type") == "text":
                            response_text += content_block.get("text", "")
                    return response_text.strip(), file_operations, execution_logs

            except ClientError as e:
                error_msg = e.response['Error']['Message']
                logger.error(f"Bedrock API error: {error_msg}")
                raise Exception(f"Bedrock API error: {error_msg}")
            except Exception as e:
                logger.error(f"Unexpected error: {str(e)}")
                raise

        # Max iterations reached
        return "I've completed the requested operations. Please let me know if you need anything else!", file_operations, execution_logs
    
    async def execute_step(
        self,
        project_id: str,
        request: StepExecutionRequest,
    ) -> StepExecutionResponse:
        """
        Execute a single plan step using the AI agent.
        The agent has access to file tools and, when workspace_id is provided,
        the execute_in_sandbox tool for running shell commands.
        """
        try:
            has_sandbox = bool(request.workspace_id)
            system_prompt = self._build_step_execution_prompt(
                request.step_title,
                request.step_body,
                request.compiler,
                has_sandbox=has_sandbox,
            )

            user_content = (
                f"Execute this step now:\n\n"
                f"**{request.step_title}**\n{request.step_body}"
            )

            if request.file_context:
                context_section = "\n\n--- FILE CONTEXT ---\n"
                for fc in request.file_context:
                    context_section += f"\n### {fc.path}\n```\n{fc.content}\n```\n"
                context_section += "\n--- END FILE CONTEXT ---\n\n"
                user_content = context_section + user_content

            messages = [{"role": "user", "content": [{"text": user_content}]}]
            tool_config = get_tool_config(include_sandbox=has_sandbox)

            response_text, file_operations, execution_logs_raw = await self._converse_with_tools(
                messages=messages,
                system_prompt=system_prompt,
                tool_config=tool_config,
                project_id=project_id,
                workspace_id=request.workspace_id,
                max_iterations=20,
            )

            execution_logs = [ExecutionLogEntry(**log) for log in execution_logs_raw]

            return StepExecutionResponse(
                message=response_text,
                file_operations=file_operations,
                execution_logs=execution_logs,
                success=True,
            )

        except Exception as e:
            logger.error(f"execute_step error: {str(e)}")
            return StepExecutionResponse(
                message=f"Failed to execute step: {str(e)}",
                file_operations=[],
                execution_logs=[],
                success=False,
            )

    def _build_plan_system_prompt(self, compiler: Optional[str] = None) -> str:
        """System prompt for plan-mode — produces a structured numbered plan without executing anything."""
        compiler_info = f"\nYou are working with the {compiler} compiler/platform.\n" if compiler else ""
        return f"""You are CuBot, an expert AI assistant for embedded systems and robotics development.{compiler_info}

## YOUR TASK
The user wants a structured implementation plan. Output ONLY the plan — do NOT create or modify any files.

## OUTPUT FORMAT
Use exactly this format for every step (no deviations):

**Step N: [Short descriptive title]**
[Clear description of what needs to be done in this step, including relevant details, file paths, and code snippets if helpful]

## RULES
- Number steps sequentially starting from 1.
- Each step should be a concrete, actionable task (not vague).
- Steps should be ordered so that each one can be executed independently in sequence.
- Do NOT call any tools. Do NOT create or update files. Only output the plan text.
"""

    def _build_step_execution_prompt(
        self,
        step_title: str,
        step_body: str,
        compiler: Optional[str] = None,
        has_sandbox: bool = False,
    ) -> str:
        """System prompt for executing a single plan step with tools."""
        compiler_info = f"\nYou are working with the {compiler} compiler/platform.\n" if compiler else ""
        sandbox_section = """
- execute_in_sandbox: Run a shell command in the live sandbox (build, test, install packages, etc.)
  Always call list_files first to know the project structure, then execute commands from the right directory.
""" if has_sandbox else ""

        return f"""You are CuBot, an AI agent executing a specific implementation step for an embedded/robotics project.{compiler_info}

## YOUR TASK
Execute ONLY the step described below. Do not go beyond its scope.

## STEP TO EXECUTE
**{step_title}**
{step_body}

## AVAILABLE TOOLS
- list_files: See all project files and their paths
- read_file: Read a file before modifying it
- create_file: Create a new file
- update_file: Overwrite an existing file{sandbox_section}

## WORKFLOW
1. Call list_files to understand the project structure.
2. Read any relevant existing files before modifying them.
3. Create or update files as needed to complete the step.
4. If a sandbox is available, run a build or test command to verify the result.
5. Provide a brief summary of what you did.

## RULES
- Complete the step fully — don't leave it half-done.
- Always use the correct full path (as returned by list_files).
- Include all necessary imports and follow best practices for the target platform.
"""

    def _build_system_prompt(self, compiler: Optional[str] = None) -> str:
        """Build the system prompt for the AI"""
        compiler_info = ""
        if compiler:
            compiler_info = f"""
You are working with the {compiler} compiler/platform. Keep this in mind when:
- Suggesting code patterns and libraries
- Recommending pin configurations
- Writing hardware-specific code
"""
        
        return f"""You are CuBot, an expert AI assistant for embedded systems and robotics development.
You help users write code for microcontrollers including Arduino, TI ARM processors, and ESP32.

{compiler_info}

## CRITICAL RULE — TOOL USE IS MANDATORY
Whenever the user asks you to create, write, generate, or modify ANY file or code, you MUST call the appropriate tool (create_file or update_file). Do NOT write code in your text response for file-creation or file-modification tasks — use the tools instead. Responding with code in markdown without calling a tool is a failure.

## Available tools
- create_file: Create a new file with the given path and content
- update_file: Overwrite an existing file's content
- read_file: Read the current content of a file
- list_files: List all files in the project (returns full paths)

## Workflow for every code task
1. Call `list_files` to see existing files and directories.
2. If you need to read a file before editing, call `read_file` with its full path from the list.
3. Call `create_file` for new files or `update_file` for existing ones.
   - The `path` argument must be the exact full path returned by `list_files` (e.g. `src/pkg/scripts/node.py`).
   - For ROS packages, also update `package.xml` and `CMakeLists.txt` to register new nodes/scripts.
4. After all tool calls, summarize what you created or modified.

## Other guidelines
- Provide complete, working code in every tool call.
- Include all necessary imports/includes and helpful comments.
- Follow best practices for the target platform.
- Consider memory constraints for embedded targets.
"""
    
    async def _save_message(
        self,
        project_id: str,
        role: MessageRole,
        content: str,
        file_context: Optional[List[FileContext]] = None,
        file_operations: Optional[List[dict]] = None,
    ) -> None:
        """Save a chat message to the database"""
        collection = get_collection(self.COLLECTION_NAME)
        
        doc = {
            "project_id": project_id,
            "role": role.value,
            "content": content,
            "timestamp": datetime.utcnow(),
            "file_context": [fc.model_dump() for fc in file_context] if file_context else [],
            "file_operations": file_operations or [],
        }
        
        await collection.insert_one(doc)
    
    async def get_chat_history(
        self,
        project_id: str,
        limit: int = 50,
    ) -> List[ChatMessageInDB]:
        """Get chat history for a project"""
        collection = get_collection(self.COLLECTION_NAME)
        
        cursor = collection.find(
            {"project_id": project_id}
        ).sort("timestamp", 1).limit(limit)
        
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
            ))
        
        return messages
    
    async def apply_file_operations(
        self,
        project_id: str,
        operations: List[dict],
    ) -> List[dict]:
        """Apply file operations (legacy method for backward compatibility)"""
        results = []
        
        for op in operations:
            try:
                operation_type = op.get("operation")
                
                if operation_type == "create_file":
                    result = await handle_tool_use("create_file", op, project_id)
                    results.append(result)
                elif operation_type == "update_file":
                    result = await handle_tool_use("update_file", op, project_id)
                    results.append(result)
                else:
                    results.append({
                        "path": op.get("path", "unknown"),
                        "success": False,
                        "error": f"Unknown operation: {operation_type}"
                    })
                        
            except Exception as e:
                results.append({
                    "path": op.get("path", "unknown"),
                    "operation": op.get("operation", "unknown"),
                    "success": False,
                    "error": str(e),
                })
        
        return results
    
    async def explain_compile_logs(
        self,
        project_id: str,
        logs: str,
        errors: Optional[List[str]] = None,
        compiler: Optional[str] = None,
    ) -> str:
        """Generate a concise explanation for compile logs (without tools)"""
        system_prompt = f"You are CuBot, an embedded systems assistant. Explain compile logs concisely{' for ' + compiler if compiler else ''}. Provide a 1-sentence summary and list only the top 2 fixes. Be brief."
        
        error_section = "\n".join(errors or [])
        user_prompt = f"Summarize errors in 1 sentence. List only top 2 fixes.\n\nLogs:\n{logs}\n\nErrors:\n{error_section}"
        
        return await self.generate_text(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=256
        )
    
    async def generate_text(
        self,
        system_prompt: str,
        user_prompt: str,
        history: Optional[List[Dict[str, str]]] = None,
        max_tokens: int = 4096
    ) -> str:
        """
        Generate text using Bedrock without tools
        Public method for other services to use
        
        Args:
            system_prompt: System instructions
            user_prompt: User message
            history: Optional conversation history
            max_tokens: Maximum tokens to generate
            
        Returns:
            Generated text response
        """
        client = self._get_bedrock_runtime()
        
        # Detect model type
        model_id = settings.BEDROCK_MODEL_ID.lower()
        is_claude = "claude" in model_id or "anthropic" in model_id
        is_openai = "gpt" in model_id or "openai" in model_id
        
        messages = []
        
        # Add history if provided
        if history:
            for msg in history:
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": [{"text": msg.get("content", "")}] if is_claude else msg.get("content", "")
                })
        
        # Add current message
        if is_claude:
            messages.append({
                "role": "user",
                "content": [{"text": user_prompt}]
            })
        else:
            messages.append({
                "role": "user",
                "content": user_prompt
            })
        
        try:
            if is_claude:
                # Claude format
                request_body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": max_tokens,
                    "system": system_prompt,
                    "messages": messages,
                    "temperature": 0.7
                }
            else:
                # OpenAI format
                openai_messages = [{"role": "system", "content": system_prompt}]
                openai_messages.extend(messages)
                request_body = {
                    "model": settings.BEDROCK_MODEL_ID,
                    "messages": openai_messages,
                    "temperature": 0.7,
                    "max_tokens": max_tokens
                }
            
            response = client.invoke_model(
                modelId=settings.BEDROCK_MODEL_ID,
                body=json.dumps(request_body),
                contentType="application/json",
                accept="application/json",
            )
            
            response_body = json.loads(response["body"].read())
            
            # Extract text based on model type
            if is_claude:
                content = response_body.get("content", [])
                response_text = ""
                for content_block in content:
                    if content_block.get("type") == "text":
                        response_text += content_block.get("text", "")
                return response_text.strip()
            else:
                # OpenAI format
                choices = response_body.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "").strip()
                return ""
            
        except Exception as e:
            logger.error(f"Error generating text: {str(e)}")
            raise Exception(f"Text generation failed: {str(e)}")


ai_service = AIService()
