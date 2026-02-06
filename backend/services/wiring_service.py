from typing import Any
import json
import re
import ast
import logging

from services.ai_service import ai_service
from schemas.wiring import WiringGuide

logger = logging.getLogger(__name__)


WIRING_SYSTEM_PROMPT = """
You are an embedded hardware assistant. Generate a wiring guide for the user's code.
Return ONLY valid JSON (double quotes only) that matches this schema:
{
  "components": [
    {
      "name": "string",
      "type": "string",
      "connections": [
        {"from": "string", "to": "string", "color": "string", "note": "string"}
      ],
      "notes": ["string"],
      "pins": ["string"]
    }
  ],
  "power": [
    {"from": "string", "to": "string", "color": "string", "note": "string"}
  ],
  "warnings": ["string"],
  "summary": "string",
  "explanation": "string"
}
Rules:
- Be concrete about pin numbers and wire colors.
- If a component cannot be inferred, include a warning.
- Keep summary concise.
Return JSON only. Do not include markdown fences or extra text.
"""


class WiringService:
    def _extract_json(self, text: str) -> Any:
        cleaned = text.strip()
        cleaned = re.sub(r"<thinking>.*?</thinking>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"<reasoning>.*?</reasoning>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"```(?:json)?", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.strip()

        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise ValueError("No JSON object found")
        snippet = match.group(0)

        snippet = re.sub(r",\s*([}\]])", r"\1", snippet)

        try:
            return json.loads(snippet)
        except json.JSONDecodeError:
            pass

        try:
            converted = snippet.replace("'", '"')
            return json.loads(converted)
        except json.JSONDecodeError:
            pass

        try:
            parsed = ast.literal_eval(snippet)
            if isinstance(parsed, dict):
                return json.loads(json.dumps(parsed))
            return parsed
        except Exception:
            pass

        try:
            aggressive = re.sub(r"[\x00-\x1f]+", " ", snippet)
            aggressive = aggressive.replace("True", "true").replace("False", "false").replace("None", "null")
            aggressive = aggressive.replace("'", '"')
            aggressive = re.sub(r",\s*([}\]])", r"\1", aggressive)
            return json.loads(aggressive)
        except json.JSONDecodeError:
            pass

        raise ValueError(f"Could not parse JSON from response (first 500 chars): {snippet[:500]}")

    def _normalize_guide(self, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        components = data.get("components", []) or []
        normalized_components = []
        for comp in components:
            if not isinstance(comp, dict):
                continue
            normalized_components.append({
                "name": comp.get("name", "Unknown"),
                "type": comp.get("type", "Unknown"),
                "connections": comp.get("connections", []) or [],
                "notes": comp.get("notes", []) or [],
                "pins": comp.get("pins", []) or [],
            })
        data["components"] = normalized_components

        power = data.get("power", []) or []
        normalized_power = []
        for conn in power:
            if not isinstance(conn, dict):
                continue
            if "from" not in conn and "component" in conn:
                conn = {
                    "from": conn.get("component", ""),
                    "to": conn.get("to", ""),
                    "color": conn.get("color", ""),
                    "note": conn.get("note", conn.get("notes", "")),
                }
            normalized_power.append({
                "from": conn.get("from", ""),
                "to": conn.get("to", ""),
                "color": conn.get("color", ""),
                "note": conn.get("note", ""),
            })
        data["power"] = normalized_power

        data.setdefault("warnings", [])
        data.setdefault("summary", "")
        data.setdefault("explanation", None)
        return data

    async def generate(self, source_code: str, compiler: str | None = None) -> WiringGuide:
        response_text = await ai_service._invoke_bedrock(
            system_prompt=WIRING_SYSTEM_PROMPT,
            user_prompt=source_code,
            history=[],
            max_tokens=2048,
        )
        logger.info("Wiring AI raw response (first 2000 chars): %s", response_text[:2000])

        try:
            data = self._normalize_guide(self._extract_json(response_text))
        except Exception as first_err:
            logger.warning("First wiring parse failed: %s — retrying with strict prompt", first_err)
            strict_prompt = (
                "Analyze the following Arduino source code and return a JSON wiring guide.\n"
                "You MUST return ONLY a JSON object. No explanation, no markdown, no code fences.\n"
                "Use DOUBLE QUOTES for all keys and string values.\n"
                "Use this EXACT format:\n"
                '{"components":[{"name":"LED","type":"led","connections":'
                '[{"from":"D13","to":"Anode","color":"green","note":"Digital pin 13 to LED anode"}],'
                '"notes":["Connect cathode to GND via 220 ohm resistor"],"pins":["D13"]}],'
                '"power":[{"from":"5V","to":"VCC","color":"red","note":"5V power rail"}],'
                '"warnings":[],"summary":"Simple LED circuit","explanation":"LED on pin 13"}\n\n'
                "SOURCE CODE:\n"
            )
            retry_text = await ai_service._invoke_bedrock(
                system_prompt="You are a JSON generator. Return ONLY valid JSON with double quotes. No other text.",
                user_prompt=f"{strict_prompt}{source_code}",
                history=[],
                max_tokens=2048,
            )
            logger.info("Wiring AI retry raw response (first 2000 chars): %s", retry_text[:2000])
            data = self._normalize_guide(self._extract_json(retry_text))

        return WiringGuide.model_validate(data)


wiring_service = WiringService()
