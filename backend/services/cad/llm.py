"""Bedrock calls for CAD Studio (planning and code writing)."""
import asyncio
import base64
import json
import logging
import random
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
            config=BotoConfig(region_name=settings.AWS_REGION, retries={"max_attempts": 2, "mode": "standard"},
                              read_timeout=120),
        )
    return _client


_unavailable: set[str] = set()  # models this account turned out not to have access to


RETRYABLE = {"ThrottlingException", "ServiceUnavailableException", "ModelNotReadyException",
             "TooManyRequestsException", "InternalServerException"}


async def _call(model: str, body: dict) -> dict:
    """invoke_model with patient retries: the swarm runs several agents at
    once and easily hits the account's per-minute token quota."""
    delay = 2.0
    for attempt in range(7):
        try:
            response = await asyncio.to_thread(
                _bedrock().invoke_model, modelId=model, contentType="application/json",
                accept="application/json", body=json.dumps(body),
            )
            return json.loads(response["body"].read())
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            message = e.response.get("Error", {}).get("Message", "")
            if code == "ThrottlingException" and "per day" in message:
                raise QuotaExceeded(
                    f"The AWS account's daily Bedrock token quota for {model} is used up. Try again tomorrow, "
                    "ask AWS for a higher quota, or set a cheaper model for the part agents (CAD_AGENT_MODEL_ID)."
                ) from e
            if code not in RETRYABLE or attempt == 6:
                raise
            wait = min(delay, 40.0) * (0.75 + random.random() / 2)
            logger.info("[cad] %s from %s, retrying in %.0fs", code, model, wait)
            await asyncio.sleep(wait)
            delay *= 2
    raise RuntimeError("unreachable")


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
                   think: int = 0, fast: bool = False, images: Optional[list[bytes]] = None) -> str:
    """One model call, run in a thread so the event loop keeps serving.
    `fast` prefers the quicker model (planning); `think` gives Anthropic
    models that many tokens of extended thinking; `images` (PNG) are shown to
    Anthropic models and dropped for others. A model this account can't use
    is skipped from then on."""
    models = _candidates(fast)
    for k, model in enumerate(models):
        try:
            anthropic = "anthropic" in model
            return await _invoke(model, system, user, max_tokens, temperature, think if anthropic else 0,
                                 images if anthropic else None)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            last = k == len(models) - 1
            if last or code not in ("AccessDeniedException", "ValidationException", "ResourceNotFoundException"):
                raise
            logger.warning("[cad] model %s unavailable (%s); trying %s", model, code, models[k + 1])
            _unavailable.add(model)
    raise RuntimeError("No model available")


async def _invoke(model: str, system: str, user: str, max_tokens: int, temperature: float, think: int,
                  images: Optional[list[bytes]] = None) -> str:
    content: object = user
    if images:
        content = [*(png_block(img) for img in images), {"type": "text", "text": user}]
    body: dict = {
        "messages": [{"role": "user", "content": content}],
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
    data = await _call(model, body)
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


class QuotaExceeded(Exception):
    """The account's daily Bedrock token quota is used up; retrying won't help today."""


class ToolsUnsupported(Exception):
    """No configured model this account can use supports tool use."""


IMAGE_TYPES = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg", b"RIFF": "image/webp"}


def image_type(img: bytes) -> Optional[str]:
    return next((t for magic, t in IMAGE_TYPES.items() if img.startswith(magic)), None)


def png_block(img: bytes) -> dict:
    """An image content block (PNG, JPEG or WebP, detected from the bytes)."""
    return {"type": "image", "source": {"type": "base64", "media_type": image_type(img) or "image/png",
                                        "data": base64.b64encode(img).decode()}}


def decode_view_image(data: Optional[str]) -> Optional[bytes]:
    """A viewport screenshot from the browser (data URL or bare base64), or
    None if missing or not a supported image."""
    if not data:
        return None
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    try:
        img = base64.b64decode(data, validate=True)
    except (ValueError, TypeError):
        return None
    return img if image_type(img) and len(img) <= 3_000_000 else None


async def agent_turn(system: str, messages: list[dict], tools: list[dict], max_tokens: int = 4096) -> dict:
    """One turn of a tool-using agent (Anthropic Messages API on Bedrock),
    on CAD_AGENT_MODEL_ID first. Returns the raw response:
    {"content": [...blocks], "stop_reason": ...}."""
    chain = [settings.CAD_AGENT_MODEL_ID] if settings.CAD_AGENT_MODEL_ID not in _unavailable else []
    for model in chain + [m for m in _candidates(fast=False) if m != settings.CAD_AGENT_MODEL_ID]:
        if "anthropic" not in model:
            continue
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "system": system,
            "messages": messages,
            "tools": tools,
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        try:
            return await _call(model, body)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("AccessDeniedException", "ResourceNotFoundException"):
                logger.warning("[cad] model %s unavailable for agents (%s)", model, code)
                _unavailable.add(model)
                continue
            raise
    raise ToolsUnsupported("No Anthropic model available for tool use")


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
