"""Bedrock calls for CAD Studio (planning and code writing)."""
import asyncio
import json
import logging
import re
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

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


_unavailable: set[str] = set()  # models this account turned out not to have access to


def _candidates(fast: bool) -> list[str]:
    chain = [settings.CAD_FAST_MODEL_ID] if fast else []
    chain += [settings.CAD_MODEL_ID, settings.BEDROCK_MODEL_ID]
    seen, out = set(), []
    for m in chain:
        if m and m not in seen and m not in _unavailable:
            seen.add(m)
            out.append(m)
    return out or [settings.BEDROCK_MODEL_ID]


async def complete(system: str, user: str, max_tokens: int = 4096, temperature: float = 0.2,
                   think: int = 0, fast: bool = False) -> str:
    """One model call, run in a thread so the event loop keeps serving.
    `fast` prefers the quicker model (planning, placement); `think` gives
    Anthropic models that many tokens of extended thinking. A model this
    account can't use is skipped from then on."""
    models = _candidates(fast)
    for k, model in enumerate(models):
        try:
            return await _invoke(model, system, user, max_tokens, temperature, think if "anthropic" in model else 0)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            last = k == len(models) - 1
            if last or code not in ("AccessDeniedException", "ValidationException", "ResourceNotFoundException"):
                raise
            logger.warning("[cad] model %s unavailable (%s); trying %s", model, code, models[k + 1])
            _unavailable.add(model)
    raise RuntimeError("No model available")


async def _invoke(model: str, system: str, user: str, max_tokens: int, temperature: float, think: int) -> str:
    body: dict = {
        "messages": [{"role": "user", "content": user}],
        "system": system,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if "anthropic" in model:
        body["anthropic_version"] = "bedrock-2023-05-31"
        if think:
            body["thinking"] = {"type": "enabled", "budget_tokens": think}
            body["max_tokens"] = max_tokens + think
            body["temperature"] = 1  # required with extended thinking
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
        text = ("".join(c.get("text", "") for c in content if c.get("type", "text") == "text")
                if isinstance(content, list) else str(content))
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
