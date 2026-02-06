import json
import base64
import subprocess
import tempfile
import os
import uuid
from typing import List, Optional
from datetime import datetime

import boto3
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
        return """You are CuBot CAD Assistant, an expert AI that generates 3D CAD models using CadQuery (Python).

Your job is to translate the user's natural-language description into a **complete, runnable CadQuery Python script** that produces a solid 3D model.

Rules:
1. Always import cadquery:  `import cadquery as cq`
2. The final result MUST be stored in a variable called `result`.
   Example:  `result = cq.Workplane("XY").box(10, 10, 10)`
3. Return ONLY the Python code block — no prose before or after the code fence.
4. If the user asks you to *modify* an existing model, take the current code they provide, apply the requested changes, and return the full updated script.
5. Use millimetres as units unless instructed otherwise.
6. Keep the code readable with comments.
7. If the request is ambiguous, make reasonable engineering assumptions and note them in code comments.
8. Do NOT use any external files, images, or assets — everything must be procedurally generated.
9. Always wrap your code in a ```python ... ``` code block.

After the code block you may optionally add a short plain-text explanation (1–3 sentences) of what was created or changed.
"""

    # ------------------------------------------------------------------
    # Generate / update a model
    # ------------------------------------------------------------------

    async def generate(
        self,
        session_id: str,
        request: CadChatRequest,
    ) -> CadChatResponse:
        """Process a CAD chat request and return CadQuery code + STL."""
        try:
            system_prompt = self._build_system_prompt()

            # Build the user prompt
            user_prompt = request.message
            if request.current_code:
                user_prompt = (
                    f"Here is the current CadQuery code:\n```python\n{request.current_code}\n```\n\n"
                    f"User request: {request.message}"
                )

            # Call Bedrock
            response_text = await self._invoke_bedrock(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                history=request.conversation_history or [],
            )

            # Extract code from response
            cadquery_code = self._extract_code(response_text)
            explanation = self._extract_explanation(response_text, cadquery_code)

            # Execute CadQuery and produce STL
            stl_b64 = None
            error = None
            if cadquery_code:
                stl_b64, error = self._execute_cadquery(cadquery_code)

            # Persist conversation
            await self._save_session(
                session_id=session_id,
                user_message=request.message,
                assistant_message=explanation or response_text,
                cadquery_code=cadquery_code,
                has_model=stl_b64 is not None,
            )

            return CadChatResponse(
                message=explanation or response_text,
                cadquery_code=cadquery_code,
                stl_base64=stl_b64,
                error=error,
            )

        except Exception as e:
            return CadChatResponse(
                message=f"Error generating CAD model: {str(e)}",
                error=str(e),
            )

    # ------------------------------------------------------------------
    # Export STL from existing code
    # ------------------------------------------------------------------

    def export_stl(self, cadquery_code: str) -> tuple[Optional[bytes], Optional[str]]:
        """Execute CadQuery code and return raw STL bytes."""
        stl_b64, error = self._execute_cadquery(cadquery_code)
        if error:
            return None, error
        if stl_b64:
            return base64.b64decode(stl_b64), None
        return None, "No model produced"

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_code(self, text: str) -> Optional[str]:
        """Extract Python code from markdown fences."""
        import re

        pattern = r"```python\s*\n(.*?)```"
        match = re.search(pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()

        # Fallback: try generic code fence
        pattern2 = r"```\s*\n(.*?)```"
        match2 = re.search(pattern2, text, re.DOTALL)
        if match2:
            code = match2.group(1).strip()
            if "cadquery" in code or "cq." in code:
                return code

        return None

    def _extract_explanation(self, full_text: str, code: Optional[str]) -> str:
        """Extract explanation text that comes after the code block."""
        if not code:
            return full_text

        import re
        # Remove all code fences and return remaining text
        cleaned = re.sub(r"```(?:python)?\s*\n.*?```", "", full_text, flags=re.DOTALL).strip()
        return cleaned if cleaned else "Model generated successfully."

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

            # Build the execution script
            exec_script = f"""
import cadquery as cq

{code}

# Export the result to STL
if 'result' in dir() or 'result' in globals():
    cq.exporters.export(result, "{stl_path}")
else:
    raise ValueError("No 'result' variable found in the CadQuery script")
"""
            script_fd, script_path = tempfile.mkstemp(suffix=".py")
            with os.fdopen(script_fd, "w") as f:
                f.write(exec_script)

            # Run in subprocess with timeout
            proc = subprocess.run(
                ["python", script_path],
                capture_output=True,
                text=True,
                timeout=30,
            )

            if proc.returncode != 0:
                return None, proc.stderr.strip() or "CadQuery execution failed"

            # Read STL and encode
            if os.path.exists(stl_path) and os.path.getsize(stl_path) > 0:
                with open(stl_path, "rb") as f:
                    stl_bytes = f.read()
                return base64.b64encode(stl_bytes).decode("utf-8"), None

            return None, "CadQuery produced no output"

        except subprocess.TimeoutExpired:
            return None, "CadQuery execution timed out (30s)"
        except Exception as e:
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

        body = json.dumps({
            "messages": messages,
            "system": system_prompt,
            "max_tokens": max_tokens,
            "temperature": 0.3,
            "top_p": 0.9,
        })

        response = client.invoke_model(
            modelId=settings.BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=body,
        )

        response_body = json.loads(response["body"].read())

        # Handle different response formats
        if "content" in response_body:
            if isinstance(response_body["content"], list):
                return response_body["content"][0].get("text", "")
            return response_body["content"]
        if "completion" in response_body:
            return response_body["completion"]

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
            return

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
