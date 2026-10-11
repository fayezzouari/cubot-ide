"""Bedrock calls for CAD Studio (planning and code writing)."""
import asyncio
import json
import logging
import re
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig

from core.config import settings

logger = logging.getLogger(__name__)

_client = None


def _bedrock():
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            config=BotoConfig(region_name=settings.AWS_REGION, retries={"max_attempts": 3, "mode": "standard"},
                              read_timeout=120),
        )
    return _client


def model_id() -> str:
    return settings.CAD_MODEL_ID or settings.BEDROCK_MODEL_ID


async def complete(system: str, user: str, max_tokens: int = 4096, temperature: float = 0.2) -> str:
    """One model call, run in a thread so the event loop keeps serving."""
    model = model_id()
    body: dict = {
        "messages": [{"role": "user", "content": user}],
        "system": system,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if "anthropic" in model:
        body["anthropic_version"] = "bedrock-2023-05-31"
    response = await asyncio.to_thread(
        _bedrock().invoke_model,
        modelId=model,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(body),
    )
    data = json.loads(response["body"].read())
    if "choices" in data:  # OpenAI-style models (gpt-oss)
        text = data["choices"][0].get("message", {}).get("content", "") or ""
    elif "content" in data:  # Anthropic
        content = data["content"]
        text = "".join(c.get("text", "") for c in content) if isinstance(content, list) else str(content)
    else:
        text = data.get("completion", "") or str(data)
    # Some models wrap their reasoning in tags; it is never part of the answer.
    return re.sub(r"<reasoning>.*?</reasoning>", "", text, flags=re.DOTALL).strip()


def extract_code(text: str) -> Optional[str]:
    blocks = re.findall(r"```(?:python|py)?\s*\n(.*?)```", text, re.DOTALL)
    if blocks:
        # The last block is the final answer when a model shows a draft first.
        code = max(blocks, key=lambda b: ("result" in b, len(b)))
        return code.strip()
    if "result" in text and ("cq." in text or "P(" in text):
        return text.strip()
    return None


def extract_json(text: str) -> dict:
    fenced = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("No JSON object in the model's answer")
    return json.loads(text[start:end + 1])
