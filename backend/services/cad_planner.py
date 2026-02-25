"""
CAD Planning Layer

Decomposes a user's natural-language CAD prompt into an ordered list of
parts/components that can be built and verified independently.
"""
import asyncio
import json
import re
import logging
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig

from core.config import settings
from models.cad import CadPlan, CadPlanStep

logger = logging.getLogger(__name__)


PLANNER_SYSTEM_PROMPT = """You are a CAD planning assistant. Your job is to decompose a 3D modeling request into an ordered list of self-contained parts that can be built and verified independently using CadQuery (Python).

Rules:
- Produce 1 to 5 parts. Simple shapes = 1 part. Complex assemblies = 2-5 parts.
- Each part builds on the previous via Python imports.
- Part IDs must be snake_case (e.g. base_plate, finger_arm).
- Filenames follow the pattern: part_{id}.py
- The last part is always the final assembly or the complete model.
- Dependencies list the IDs of parts that this part imports from.
- approach_hint is a 1-sentence CadQuery technique note (e.g. "box() with fillet on top edges").

Respond ONLY with a JSON object in this exact format (no markdown fences, no extra text):
{
  "parts": [
    {
      "id": "base_plate",
      "name": "Base Plate",
      "filename": "part_base_plate.py",
      "description": "Flat rectangular plate that serves as the foundation",
      "dependencies": [],
      "approach_hint": "box() with fillet on all top edges"
    },
    {
      "id": "mounting_holes",
      "name": "Mounting Holes",
      "filename": "part_mounting_holes.py",
      "description": "4 corner holes for M3 screws",
      "dependencies": ["base_plate"],
      "approach_hint": "Import base_plate result and apply .hole() on top face"
    }
  ]
}"""


class CadPlanner:
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

    async def create_plan(self, prompt: str, current_code: Optional[str] = None) -> CadPlan:
        """Call LLM to decompose prompt into an ordered list of parts."""
        logger.info("[Planner] Creating plan for: %.100s", prompt)

        context = ""
        if current_code:
            context = f"\n\nExisting CadQuery code to build upon:\n```python\n{current_code}\n```"

        user_message = f"Create a build plan for this 3D model request: {prompt}{context}"

        try:
            raw = await self._invoke(user_message)
            plan = self._parse_plan(raw)
            logger.info("[Planner] Plan has %d parts: %s", len(plan.parts), [p.id for p in plan.parts])
            return plan
        except Exception as e:
            logger.warning("[Planner] Failed to parse plan (%s), falling back to single-part plan", e)
            return self._fallback_plan(prompt)

    def _parse_plan(self, raw: str) -> CadPlan:
        """Extract and parse JSON plan from LLM response."""
        # Strip markdown fences if present
        text = re.sub(r"```(?:json)?\s*\n?", "", raw).strip()
        text = text.rstrip("`").strip()

        data = json.loads(text)
        parts = []
        for p in data.get("parts", []):
            parts.append(CadPlanStep(
                id=p["id"],
                name=p["name"],
                filename=p.get("filename", f"part_{p['id']}.py"),
                description=p.get("description", ""),
                dependencies=p.get("dependencies", []),
                approach_hint=p.get("approach_hint", ""),
            ))

        if not parts:
            raise ValueError("Plan has no parts")

        return CadPlan(parts=parts)

    def _fallback_plan(self, prompt: str) -> CadPlan:
        """Return a single-part plan if planning LLM call fails."""
        return CadPlan(parts=[
            CadPlanStep(
                id="model",
                name="Model",
                filename="part_model.py",
                description=prompt,
                dependencies=[],
                approach_hint="",
            )
        ])

    async def _invoke(self, user_message: str) -> str:
        """Call Bedrock in a thread so the event loop stays free for SSE flushing."""
        client = self._get_client()
        body = json.dumps({
            "messages": [{"role": "user", "content": user_message}],
            "system": PLANNER_SYSTEM_PROMPT,
            "max_tokens": 1024,
            "temperature": 0.1,
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


cad_planner = CadPlanner()
