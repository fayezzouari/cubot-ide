"""
CAD Part Executor

Generates CadQuery code for a single plan part, writes it as a real Python
file in the session temp directory (so later parts can import it), executes
it directly (like _execute_cadquery), and runs a reflection/retry loop on failure.
"""
import asyncio
import json
import base64
import subprocess
import os
import re
import logging
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig

from core.config import settings
from models.cad import CadPlanStep, CadPartResult

logger = logging.getLogger(__name__)

MAX_REFLECTION_ATTEMPTS = 3


EXECUTOR_SYSTEM_PROMPT = """You are a CadQuery code generator. You write Python scripts that build 3D geometry using CadQuery.

CRITICAL RULES:
1. Start with `import cadquery as cq`.
2. If the part depends on previous parts, import them at the top:
   `from part_X import result as X`
   (use the module name without .py, e.g. `from part_base_plate import result as base_plate`)
3. Assign the final geometry to a module-level variable called `result`.
4. `result` must be a CadQuery Workplane or Shape object.
5. Keep scripts SHORT — typically under 60 lines. Only geometry construction.
6. Do NOT call any export functions. The system handles export automatically.
7. Do NOT define main(), use sys.exit(), or use if __name__ == "__main__".
8. Do NOT import sys, os, argparse, pathlib, or any file I/O modules.
9. Use millimetres as default units.
10. Do NOT include XML tags, reasoning blocks, or thinking sections.
11. Return ONLY a single ```python``` code block. No explanation before or after."""


def _build_generation_prompt(
    part: CadPlanStep,
    completed_parts: dict[str, CadPartResult],
    overall_prompt: str,
) -> str:
    """Build the LLM prompt for generating one part's code."""
    lines = [
        f"Generate CadQuery Python code for the following part of a '{overall_prompt}' model:",
        "",
        f"Part name: {part.name}",
        f"Description: {part.description}",
    ]
    if part.approach_hint:
        lines.append(f"Suggested approach: {part.approach_hint}")

    if part.dependencies:
        lines.append("")
        lines.append("This part must import from these already-built parts:")
        for dep_id in part.dependencies:
            dep_result = completed_parts.get(dep_id)
            dep_module = f"part_{dep_id}"
            lines.append(f"  - `from {dep_module} import result as {dep_id}`")
            if dep_result and dep_result.code:
                lines.append(f"    Reference code for '{dep_id}':")
                lines.append("    ```python")
                for line in (dep_result.code or "").splitlines():
                    lines.append(f"    {line}")
                lines.append("    ```")
    else:
        lines.append("")
        lines.append("This part has no dependencies — build it from scratch.")

    lines.append("")
    lines.append("Return ONLY a ```python``` code block.")
    return "\n".join(lines)


def _build_reflection_prompt(
    part: CadPlanStep,
    code: str,
    error: str,
) -> str:
    return (
        f"The following CadQuery code for part '{part.name}' failed when executed.\n\n"
        f"Code:\n```python\n{code}\n```\n\n"
        f"Error:\n```\n{error}\n```\n\n"
        f"Fix the code so it runs without errors. Return ONLY a single ```python``` code block.\n\n"
        f"Fix guidelines:\n"
        f"- Keep the same structure; only change what causes the error.\n"
        f"- `result` must be assigned at module level.\n"
        f"- If importing from a dependency, use: from part_X import result as X\n"
        f"- No export calls, no main(), no sys/os imports.\n"
        f"- Use CadQuery defaults for any ambiguous values."
    )


class CadPartExecutor:
    def __init__(self):
        self._bedrock_runtime = None

    def _get_client(self):
        if self._bedrock_runtime is None:
            config = BotoConfig(
                region_name=settings.AWS_REGION,
                retries={"max_attempts": 3, "mode": "standard"},
            )
            self._bedrock_runtime = boto3.client("bedrock-runtime", config=config)
        return self._bedrock_runtime

    async def execute_part(
        self,
        part: CadPlanStep,
        completed_parts: dict[str, CadPartResult],
        session_tmp_dir: str,
        overall_prompt: str,
    ) -> CadPartResult:
        """Generate + execute code for one part. Returns result with reflection attempts."""
        logger.info("[Executor] Executing part '%s'", part.id)

        gen_prompt = _build_generation_prompt(part, completed_parts, overall_prompt)
        code = await self._generate_code(gen_prompt)

        if not code:
            logger.warning("[Executor] No code generated for part '%s'", part.id)
            return CadPartResult(part_id=part.id, success=False, error="No code generated", attempts=1)

        attempts = 0
        stl_b64 = None
        error = None

        while attempts < MAX_REFLECTION_ATTEMPTS:
            attempts += 1
            logger.info("[Executor] Part '%s' attempt %d/%d", part.id, attempts, MAX_REFLECTION_ATTEMPTS)

            # Write the part file so later parts can import it
            part_file = os.path.join(session_tmp_dir, part.filename)
            with open(part_file, "w") as f:
                f.write(code)
            logger.debug("[Executor] Wrote part file: %s", part_file)

            # Execute directly (avoids import fragility) and export STL
            stl_b64, error = self._execute_and_export(part, code, session_tmp_dir)

            if stl_b64:
                logger.info("[Executor] Part '%s' succeeded on attempt %d", part.id, attempts)
                return CadPartResult(
                    part_id=part.id,
                    success=True,
                    code=code,
                    stl_b64=stl_b64,
                    attempts=attempts,
                )

            # Log full error (no truncation)
            logger.warning("[Executor] Part '%s' failed (attempt %d):\n%s", part.id, attempts, error)

            if attempts < MAX_REFLECTION_ATTEMPTS:
                reflect_prompt = _build_reflection_prompt(part, code, error or "unknown error")
                fixed_code = await self._generate_code(reflect_prompt)
                if fixed_code:
                    code = fixed_code
                else:
                    logger.warning("[Executor] Reflection produced no code for '%s'", part.id)
                    break

        logger.error("[Executor] Part '%s' failed after %d attempts\nLast error:\n%s", part.id, attempts, error)
        return CadPartResult(
            part_id=part.id,
            success=False,
            code=code,
            error=error,
            attempts=attempts,
        )

    def _execute_and_export(
        self,
        part: CadPlanStep,
        code: str,
        session_tmp_dir: str,
    ) -> tuple[Optional[str], Optional[str]]:
        """
        Execute the part code directly in a subprocess and export STL.
        Mirrors _execute_cadquery() from cad_service — runs code inline rather
        than via import, which avoids Python import caching/path issues.
        sys.path includes session_tmp_dir so dependency imports still work.
        """
        stl_path = os.path.join(session_tmp_dir, f"{part.id}.stl")

        # Inline execution: sys.path includes session_tmp_dir so `from part_X import`
        # statements in the generated code resolve correctly.
        exec_script = f"""import sys
sys.path.insert(0, {repr(session_tmp_dir)})

{code}

# ── Export ──
import cadquery as cq
_stl_path = {repr(stl_path)}
try:
    _result = result
except NameError:
    raise ValueError("No 'result' variable found in part '{part.id}'")
cq.exporters.export(_result, _stl_path)
"""

        script_path = os.path.join(session_tmp_dir, f"_run_{part.id}.py")
        with open(script_path, "w") as f:
            f.write(exec_script)

        try:
            proc = subprocess.run(
                ["python", script_path],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            return None, f"Execution timed out (30s) for part '{part.id}'"
        except Exception as e:
            return None, str(e)

        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip() or "Execution failed"
            return None, err

        if os.path.exists(stl_path) and os.path.getsize(stl_path) > 0:
            with open(stl_path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8"), None

        return None, f"No STL output produced for part '{part.id}'"

    async def _generate_code(self, user_prompt: str) -> Optional[str]:
        """Call Bedrock and extract Python code block."""
        raw = await self._invoke(user_prompt)
        return self._extract_code(raw)

    def _extract_code(self, text: str) -> Optional[str]:
        match = re.search(r"```python\s*\n(.*?)```", text, re.DOTALL)
        if match:
            return match.group(1).strip()
        match2 = re.search(r"```\s*\n(.*?)```", text, re.DOTALL)
        if match2:
            code = match2.group(1).strip()
            if "cadquery" in code or "cq." in code:
                return code
        return None

    async def _invoke(self, user_prompt: str) -> str:
        """Call Bedrock in a thread so the event loop stays free for SSE flushing."""
        client = self._get_client()
        body = json.dumps({
            "messages": [{"role": "user", "content": user_prompt}],
            "system": EXECUTOR_SYSTEM_PROMPT,
            "max_tokens": 2048,
            "temperature": 0.2,
        })

        response = await asyncio.to_thread(
            client.invoke_model,
            modelId=settings.BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=body,
        )
        response_body = json.loads(response["body"].read())

        if "choices" in response_body:
            return response_body["choices"][0].get("message", {}).get("content", "")
        if "content" in response_body:
            content = response_body["content"]
            if isinstance(content, list):
                return content[0].get("text", "")
            return str(content)
        if "completion" in response_body:
            return response_body["completion"]
        return str(response_body)


cad_part_executor = CadPartExecutor()
