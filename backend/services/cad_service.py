import json
import base64
import subprocess
import tempfile
import os
import uuid
import logging
from typing import List, Optional
from datetime import datetime

import boto3

logger = logging.getLogger(__name__)
from botocore.config import Config as BotoConfig

from core.config import settings
from core.database import get_collection
from models.cad import (
    CadChatRequest,
    CadChatResponse,
    CadMessage,
    CadMessageRole,
)


class CadService:
    """Service for AI-powered CAD model generation using CadQuery"""

    COLLECTION_NAME = "cad_sessions"

    def __init__(self):
        self._bedrock_runtime = None

    def _get_bedrock_runtime(self):
        """Get Bedrock runtime client (lazy initialization)"""
        if self._bedrock_runtime is None:
            config = BotoConfig(
                region_name=settings.AWS_REGION,
                retries={"max_attempts": 3, "mode": "standard"},
            )
            self._bedrock_runtime = boto3.client(
                "bedrock-runtime",
                config=config,
            )
        return self._bedrock_runtime

    # ------------------------------------------------------------------
    # System prompt
    # ------------------------------------------------------------------

    def _build_system_prompt(self) -> str:
        return """You are CuBot CAD Assistant — an automated CAD code generator.

You live inside a CAD application. The user's message is ALWAYS a request to create or modify a 3D model. Your job is to produce a SHORT CadQuery Python script that builds the geometry and assigns it to `result`. The system will handle exporting.

RESPONSE FORMAT (follow exactly):

```python
import cadquery as cq

# Short comment describing the model
result = cq.Workplane("XY").box(10, 10, 10)
```

**What was created:** One sentence describing the 3D model.

CRITICAL RULES:
1. ALWAYS start with `import cadquery as cq`.
2. The final geometry MUST be assigned to a variable called `result`.
3. `result` must be a CadQuery Workplane or Shape object.
4. Keep scripts SHORT — typically under 50 lines. Only geometry construction.
5. Do NOT call any export functions (no exportStl, exportStep, exportGLB, export, etc.). The system handles export automatically.
6. Do NOT define a main() function. Do NOT use sys.exit(). Do NOT use argparse.
7. Do NOT use if __name__ == "__main__". Just top-level geometry code.
8. Do NOT import sys, os, argparse, pathlib, or any file I/O modules.
9. NEVER ask clarifying questions. Make reasonable assumptions for vague requests.
10. Use millimetres as default units.
11. Do NOT include XML tags, <reasoning> blocks, or thinking sections.
12. After the code block, add ONE sentence starting with "**What was created:**" or "**What changed:**".

Example — user says "make a cube":

```python
import cadquery as cq

# Create a 20mm cube
result = cq.Workplane("XY").box(20, 20, 20)
```

**What was created:** A 20mm cube centered at the origin.

Example — user says "add a hole to it":

```python
import cadquery as cq

# Create a 20mm cube with a 5mm hole through the top
result = (
    cq.Workplane("XY")
    .box(20, 20, 20)
    .faces(">Z")
    .workplane()
    .hole(5)
)
```

**What changed:** Added a 5mm through-hole on the top face of the cube.
"""

    # ------------------------------------------------------------------
    # Generate / update a model
    # ------------------------------------------------------------------

    MAX_REFLECTION_ATTEMPTS = 3

    async def generate(
        self,
        session_id: str,
        request: CadChatRequest,
    ) -> CadChatResponse:
        """Process a CAD chat request and return CadQuery code + STL.
        
        Includes a reflection loop: if the generated code fails to execute,
        the error is fed back to the LLM to fix the code, up to
        MAX_REFLECTION_ATTEMPTS times.
        """
        logger.info("[CAD] ── generate() called ──")
        logger.info("[CAD]   session_id : %s", session_id)
        logger.info("[CAD]   message    : %s", request.message)
        logger.info("[CAD]   has current_code : %s", bool(request.current_code))
        logger.info("[CAD]   history len: %d", len(request.conversation_history or []))

        try:
            system_prompt = self._build_system_prompt()

            # Build the user prompt — always frame it as a CAD generation task
            if request.current_code:
                user_prompt = (
                    f"Here is the current CadQuery code:\n```python\n{request.current_code}\n```\n\n"
                    f"Generate an updated CadQuery script for: {request.message}"
                )
            else:
                user_prompt = f"Generate a CadQuery Python script for the following 3D model: {request.message}"

            logger.info("[CAD]   user_prompt (first 200 chars): %.200s", user_prompt)

            # ── Initial generation ──
            cadquery_code, explanation, raw_response = await self._generate_code(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                history=request.conversation_history or [],
            )

            # ── Execute + reflect loop ──
            stl_b64 = None
            error = None

            if cadquery_code:
                stl_b64, error = self._execute_cadquery(cadquery_code)

                # Reflection: if execution failed, ask the LLM to fix it
                attempt = 1
                while error and attempt <= self.MAX_REFLECTION_ATTEMPTS:
                    logger.info("[CAD:reflect] ── Attempt %d/%d ──", attempt, self.MAX_REFLECTION_ATTEMPTS)
                    logger.info("[CAD:reflect]   Error: %.300s", error)

                    reflection_prompt = (
                        f"The following CadQuery code produced an error when executed.\n\n"
                        f"**Code (use this as the base; preserve intent and comments where possible):**\n"
                        f"```python\n{cadquery_code}\n```\n\n"
                        f"**Error:**\n```\n{error}\n```\n\n"
                        f"Fix the code so it runs without errors. Return the FULL corrected script. "
                        f"Keep the same structure and comments where possible, only change what is needed. "
                        f"Remember: only geometry code, assign the result to `result`, no export calls, no main()."
                    )

                    cadquery_code, explanation, _ = await self._generate_code(
                        system_prompt=system_prompt,
                        user_prompt=reflection_prompt,
                        history=[],  # Clean context for the fix
                    )

                    if cadquery_code:
                        stl_b64, error = self._execute_cadquery(cadquery_code)
                        if stl_b64:
                            logger.info("[CAD:reflect] ✔ Fixed on attempt %d", attempt)
                            break
                        if error:
                            logger.warning("[CAD:reflect] ✘ Still failing on attempt %d: %.200s", attempt, error)
                    else:
                        logger.warning("[CAD:reflect] ✘ No code extracted on attempt %d", attempt)
                        break

                    attempt += 1

                if error:
                    logger.error("[CAD:reflect] ✘ All %d reflection attempts exhausted", self.MAX_REFLECTION_ATTEMPTS)
            else:
                logger.warning("[CAD]   Skipping CadQuery execution (no code extracted)")

            # Persist conversation
            logger.info("[CAD]   Saving session…")
            await self._save_session(
                session_id=session_id,
                user_message=request.message,
                assistant_message=explanation or raw_response,
                cadquery_code=cadquery_code,
                has_model=stl_b64 is not None,
            )

            logger.info("[CAD] ── generate() done (has_model=%s, has_error=%s) ──",
                        stl_b64 is not None, error is not None)

            return CadChatResponse(
                message=explanation or raw_response,
                cadquery_code=cadquery_code,
                stl_base64=stl_b64,
                error=error,
            )

        except Exception as e:
            logger.exception("[CAD]   ✘ Unhandled exception in generate()")
            return CadChatResponse(
                message=f"Error generating CAD model: {str(e)}",
                error=str(e),
            )

    async def _generate_code(
        self,
        system_prompt: str,
        user_prompt: str,
        history: List[dict],
    ) -> tuple[Optional[str], str, str]:
        """Call Bedrock, sanitize, extract code + explanation.
        
        Returns (cadquery_code, explanation, raw_response_text).
        """
        logger.info("[CAD]   → Invoking Bedrock (model=%s)…", settings.BEDROCK_MODEL_ID)
        raw_response = await self._invoke_bedrock(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            history=history,
        )
        logger.info("[CAD]   ← Bedrock raw response length: %d chars", len(raw_response))
        logger.debug("[CAD]   ← Bedrock raw response:\n%s", raw_response)

        # Sanitize LLM output (strip <reasoning> tags, etc.)
        response_text = self._sanitize_response(raw_response)
        if response_text != raw_response:
            logger.info("[CAD]   Sanitized response (removed %d chars)", len(raw_response) - len(response_text))

        # Extract code from response
        cadquery_code = self._extract_code(response_text)
        if cadquery_code:
            logger.info("[CAD]   ✔ Extracted CadQuery code (%d chars)", len(cadquery_code))
            logger.debug("[CAD]   Code:\n%s", cadquery_code)
        else:
            logger.warning("[CAD]   ✘ No CadQuery code found in response")

        explanation = self._extract_explanation(response_text, cadquery_code)
        logger.info("[CAD]   Explanation: %.200s", explanation)

        return cadquery_code, explanation, response_text

    # ------------------------------------------------------------------
    # Export STL from existing code
    # ------------------------------------------------------------------

    def export_stl(self, cadquery_code: str) -> tuple[Optional[bytes], Optional[str]]:
        """Execute CadQuery code and return raw STL bytes."""
        logger.info("[CAD] export_stl() called (%d chars of code)", len(cadquery_code))
        stl_b64, error = self._execute_cadquery(cadquery_code)
        if error:
            logger.error("[CAD] export_stl failed: %s", error)
            return None, error
        if stl_b64:
            stl_bytes = base64.b64decode(stl_b64)
            logger.info("[CAD] export_stl success (%d bytes)", len(stl_bytes))
            return stl_bytes, None
        return None, "No model produced"

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _sanitize_response(self, text: str) -> str:
        """Strip XML-like tags (reasoning, thinking, etc.) and clean up the LLM output."""
        import re

        # Remove common LLM reasoning/thinking XML tags and their content
        text = re.sub(r"<(reasoning|thinking|reflection|thought|scratchpad|analysis)>.*?</\1>", "", text, flags=re.DOTALL | re.IGNORECASE)
        # Remove any remaining orphan XML-like tags
        text = re.sub(r"</?\s*(reasoning|thinking|reflection|thought|scratchpad|analysis)\s*/?>", "", text, flags=re.IGNORECASE)
        # Collapse multiple blank lines
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _extract_code(self, text: str) -> Optional[str]:
        """Extract Python code from markdown fences."""
        import re

        pattern = r"```python\s*\n(.*?)```"
        match = re.search(pattern, text, re.DOTALL)
        if match:
            code = match.group(1).strip()
            return self._sanitize_code(code)

        # Fallback: try generic code fence
        pattern2 = r"```\s*\n(.*?)```"
        match2 = re.search(pattern2, text, re.DOTALL)
        if match2:
            code = match2.group(1).strip()
            if "cadquery" in code or "cq." in code:
                return self._sanitize_code(code)

        return None

    def _sanitize_code(self, code: str) -> str:
        """Remove dangerous or unnecessary patterns from generated CadQuery code.
        
        Strategy: parse the code into top-level blocks (functions, if-guards, 
        loose statements). Keep only imports and loose statements that build 
        geometry. Remove all function definitions, if __name__ guards, export
        calls, and forbidden imports.
        """
        import re

        lines = code.splitlines()

        # ── Pass 1: identify top-level blocks and classify them ──
        blocks: list[dict] = []  # {start, end, kind, keep}
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            # Calculate indentation level
            indent = len(line) - len(line.lstrip()) if stripped else 0

            # Top-level function definition → remove entire function
            if indent == 0 and re.match(r"def\s+\w+\s*\(", stripped):
                block_start = i
                i += 1
                # Consume entire indented body
                while i < len(lines):
                    s = lines[i].strip()
                    if s == "":
                        i += 1
                        continue
                    body_indent = len(lines[i]) - len(lines[i].lstrip())
                    if body_indent > 0:
                        i += 1
                    else:
                        break
                blocks.append({"start": block_start, "end": i, "kind": "func", "keep": False})
                logger.debug("[CAD:sanitize] Removing function block lines %d-%d", block_start + 1, i)
                continue

            # Top-level class definition → remove
            if indent == 0 and re.match(r"class\s+\w+", stripped):
                block_start = i
                i += 1
                while i < len(lines):
                    s = lines[i].strip()
                    if s == "":
                        i += 1
                        continue
                    body_indent = len(lines[i]) - len(lines[i].lstrip())
                    if body_indent > 0:
                        i += 1
                    else:
                        break
                blocks.append({"start": block_start, "end": i, "kind": "class", "keep": False})
                logger.debug("[CAD:sanitize] Removing class block lines %d-%d", block_start + 1, i)
                continue

            # if __name__ == "__main__" guard → remove
            if indent == 0 and re.match(r'if\s+__name__\s*==\s*["\']__main__["\']', stripped):
                block_start = i
                i += 1
                while i < len(lines):
                    s = lines[i].strip()
                    if s == "":
                        i += 1
                        continue
                    body_indent = len(lines[i]) - len(lines[i].lstrip())
                    if body_indent > 0:
                        i += 1
                    else:
                        break
                blocks.append({"start": block_start, "end": i, "kind": "main_guard", "keep": False})
                logger.debug("[CAD:sanitize] Removing __main__ guard lines %d-%d", block_start + 1, i)
                continue

            # Regular line → keep (will filter individually below)
            blocks.append({"start": i, "end": i + 1, "kind": "line", "keep": True})
            i += 1

        # ── Pass 2: collect kept lines, filter individual statements ──
        cleaned = []
        paren_balance = 0
        for block in blocks:
            if not block["keep"]:
                continue
            for j in range(block["start"], block["end"]):
                line = lines[j]
                stripped = line.strip()

                # Track paren balance to allow multi-line expressions
                paren_balance += stripped.count("(") - stripped.count(")")

                # Drop indented lines that are not part of a multi-line expression
                if line.startswith((" ", "\t")) and paren_balance <= 0:
                    logger.debug("[CAD:sanitize] Removed unexpected indented line: %s", stripped)
                    continue

                # Skip decorators
                if re.match(r"^\s*@", line):
                    logger.debug("[CAD:sanitize] Removed decorator: %s", stripped)
                    continue

                # Skip top-level control-flow blocks (we only want linear geometry code)
                if re.match(r"^\s*(if|for|while|with|try|except|elif|else)\b", line):
                    logger.debug("[CAD:sanitize] Removed control-flow line: %s", stripped)
                    continue

                # Remove dangling function signature lines like ") -> cq.Solid:"
                if re.match(r"^\s*\)\s*->.*:\s*$", line):
                    logger.debug("[CAD:sanitize] Removed dangling type-annotated line: %s", stripped)
                    continue

                # Remove any standalone block starters ending with ':'
                if stripped.endswith(":"):
                    logger.debug("[CAD:sanitize] Removed block-starter line: %s", stripped)
                    continue

                # Skip empty lines at the edges (keep in middle)
                # Skip forbidden imports
                if re.match(r"^\s*(import|from)\s+(sys|os|argparse|pathlib|shutil)\b", line):
                    logger.debug("[CAD:sanitize] Removed forbidden import: %s", stripped)
                    continue

                # Remove numpy imports (not needed for geometry generation)
                if re.match(r"^\s*(import|from)\s+numpy\b", line):
                    logger.debug("[CAD:sanitize] Removed numpy import: %s", stripped)
                    continue

                # Skip sys.exit()
                if "sys.exit" in stripped:
                    continue

                # Skip export calls
                if re.search(r"\.(exportStl|exportStep|exportGLB|exportBrep|exportVRML|exportSVG)\s*\(", line):
                    logger.debug("[CAD:sanitize] Removed export call: %s", stripped)
                    continue
                if re.match(r"^\s*cq\.exporters\.export\s*\(", line):
                    logger.debug("[CAD:sanitize] Removed cq.exporters.export call")
                    continue

                # Skip print() calls (often used for logging in generated scripts)
                if re.match(r"^\s*print\s*\(", line):
                    continue

                cleaned.append(line)

        result = "\n".join(cleaned).strip()
        if result != code.strip():
            original_count = len(lines)
            new_count = len(cleaned)
            logger.info("[CAD:sanitize] Code sanitized: %d -> %d lines (removed %d)",
                        original_count, new_count, original_count - new_count)
        return result

    def _extract_explanation(self, full_text: str, code: Optional[str]) -> str:
        """Extract a clean explanation from the response, stripping code and tags."""
        import re

        if not code:
            return self._sanitize_response(full_text)

        # Remove all code fences
        cleaned = re.sub(r"```(?:python)?\s*\n.*?```", "", full_text, flags=re.DOTALL)
        # Sanitize any remaining tags
        cleaned = self._sanitize_response(cleaned)

        if not cleaned:
            return "✅ Model generated successfully."

        return cleaned

    def _execute_cadquery(self, code: str) -> tuple[Optional[str], Optional[str]]:
        """
        Execute CadQuery code in a subprocess and return (stl_base64, error).
        """
        stl_path = None
        script_path = None
        try:
            # Create a temp file for the STL output
            stl_fd, stl_path = tempfile.mkstemp(suffix=".stl")
            os.close(stl_fd)
            logger.debug("[CAD:exec] STL output path: %s", stl_path)

            # Build the execution script
            # The generated code already includes `import cadquery as cq`,
            # so we run it directly. We also hoist any `from __future__`
            # imports to the very top of the file (Python requires them first).
            import re as _re

            future_imports = []
            code_lines = []
            for line in code.splitlines():
                if _re.match(r"^\s*from\s+__future__\s+import\s+", line):
                    future_imports.append(line)
                else:
                    code_lines.append(line)

            # Ensure cadquery is imported (add only if the code doesn't already import it)
            cleaned_code = "\n".join(code_lines)
            if "import cadquery" not in cleaned_code:
                code_lines.insert(0, "import cadquery as cq")

            assembled_code = "\n".join(code_lines)
            future_block = "\n".join(future_imports)

            exec_script = f"""{future_block}
{assembled_code}

# Export the result to STL
if 'result' in dir() or 'result' in globals():
    import cadquery as cq
    cq.exporters.export(result, "{stl_path}")
else:
    raise ValueError("No 'result' variable found in the CadQuery script")
"""
            script_fd, script_path = tempfile.mkstemp(suffix=".py")
            with os.fdopen(script_fd, "w") as f:
                f.write(exec_script)
            logger.debug("[CAD:exec] Script path: %s", script_path)

            # Run in subprocess with timeout
            logger.info("[CAD:exec] Running subprocess…")
            proc = subprocess.run(
                ["python", script_path],
                capture_output=True,
                text=True,
                timeout=30,
            )
            logger.info("[CAD:exec] Subprocess returned code %d", proc.returncode)

            if proc.stdout:
                logger.debug("[CAD:exec] stdout:\n%s", proc.stdout)
            if proc.stderr:
                logger.debug("[CAD:exec] stderr:\n%s", proc.stderr)

            if proc.returncode != 0:
                error_msg = proc.stderr.strip() or "CadQuery execution failed"
                logger.error("[CAD:exec] ✘ Execution failed: %s", error_msg)
                return None, error_msg

            # Read STL and encode
            if os.path.exists(stl_path) and os.path.getsize(stl_path) > 0:
                stl_size = os.path.getsize(stl_path)
                logger.info("[CAD:exec] ✔ STL file produced (%d bytes)", stl_size)
                with open(stl_path, "rb") as f:
                    stl_bytes = f.read()
                return base64.b64encode(stl_bytes).decode("utf-8"), None

            logger.warning("[CAD:exec] ✘ STL file missing or empty")
            return None, "CadQuery produced no output"

        except subprocess.TimeoutExpired:
            logger.error("[CAD:exec] ✘ Subprocess timed out (30s)")
            return None, "CadQuery execution timed out (30s)"
        except Exception as e:
            logger.exception("[CAD:exec] ✘ Unexpected error")
            return None, str(e)
        finally:
            if stl_path and os.path.exists(stl_path):
                os.unlink(stl_path)
            if script_path and os.path.exists(script_path):
                os.unlink(script_path)

    async def _invoke_bedrock(
        self,
        system_prompt: str,
        user_prompt: str,
        history: List[dict] = None,
        max_tokens: int = 4096,
    ) -> str:
        """Invoke Bedrock model to generate response."""
        client = self._get_bedrock_runtime()

        messages = []
        if history:
            for msg in history[-10:]:
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", ""),
                })
        messages.append({"role": "user", "content": user_prompt})

        logger.info("[CAD:bedrock] Sending %d messages (model=%s, max_tokens=%d)",
                    len(messages), settings.BEDROCK_MODEL_ID, max_tokens)

        body = json.dumps({
            "messages": messages,
            "system": system_prompt,
            "max_tokens": max_tokens,
            "temperature": 0.3,
            "top_p": 0.9,
        })

        try:
            response = client.invoke_model(
                modelId=settings.BEDROCK_MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
        except Exception as e:
            logger.exception("[CAD:bedrock] ✘ Bedrock API call failed")
            raise

        response_body = json.loads(response["body"].read())
        logger.debug("[CAD:bedrock] Response keys: %s", list(response_body.keys()))

        # Log token usage if available
        if "usage" in response_body:
            usage = response_body["usage"]
            logger.info("[CAD:bedrock] Token usage — prompt: %s, completion: %s, total: %s",
                        usage.get("prompt_tokens", "?"),
                        usage.get("completion_tokens", "?"),
                        usage.get("total_tokens", "?"))

        # OpenAI-compatible format: choices[].message.content
        if "choices" in response_body and isinstance(response_body["choices"], list):
            choice = response_body["choices"][0]
            text = choice.get("message", {}).get("content", "")
            logger.info("[CAD:bedrock] Parsed text from choices[0].message.content (%d chars)", len(text))
            return text

        # Anthropic format: content[] or content string
        if "content" in response_body:
            if isinstance(response_body["content"], list):
                text = response_body["content"][0].get("text", "")
                logger.info("[CAD:bedrock] Parsed text from content[0] (%d chars)", len(text))
                return text
            logger.info("[CAD:bedrock] Parsed text from content (%d chars)", len(str(response_body["content"])))
            return response_body["content"]

        # Legacy completion format
        if "completion" in response_body:
            logger.info("[CAD:bedrock] Parsed text from completion (%d chars)", len(response_body["completion"]))
            return response_body["completion"]

        logger.warning("[CAD:bedrock] Unknown response format, returning raw: %s", str(response_body)[:300])
        return str(response_body)

    # ------------------------------------------------------------------
    # Session persistence
    # ------------------------------------------------------------------

    async def _save_session(
        self,
        session_id: str,
        user_message: str,
        assistant_message: str,
        cadquery_code: Optional[str] = None,
        has_model: bool = False,
    ):
        """Save or update a CAD session in MongoDB."""
        collection = get_collection(self.COLLECTION_NAME)
        if collection is None:
            logger.warning("[CAD:db] No collection available, skipping session save")
            return
        logger.info("[CAD:db] Saving session %s (has_model=%s)", session_id, has_model)

        now = datetime.utcnow()

        user_msg = CadMessage(
            role=CadMessageRole.USER,
            content=user_message,
        )
        assistant_msg = CadMessage(
            role=CadMessageRole.ASSISTANT,
            content=assistant_message,
            cadquery_code=cadquery_code,
            has_model=has_model,
        )

        existing = await collection.find_one({"session_id": session_id})
        if existing:
            await collection.update_one(
                {"session_id": session_id},
                {
                    "$push": {
                        "messages": {
                            "$each": [user_msg.model_dump(), assistant_msg.model_dump()]
                        }
                    },
                    "$set": {
                        "current_code": cadquery_code or existing.get("current_code"),
                        "updated_at": now,
                    },
                },
            )
        else:
            await collection.insert_one({
                "_id": str(uuid.uuid4()),
                "session_id": session_id,
                "messages": [user_msg.model_dump(), assistant_msg.model_dump()],
                "current_code": cadquery_code,
                "created_at": now,
                "updated_at": now,
            })

    async def get_session(self, session_id: str) -> Optional[dict]:
        """Retrieve a CAD session."""
        collection = get_collection(self.COLLECTION_NAME)
        if collection is None:
            return None
        return await collection.find_one({"session_id": session_id})


# Singleton
cad_service = CadService()
