# OpenAI-compatible text-model client (default: local opencode-go gateway).
from __future__ import annotations

import json
import re
from typing import Any

import httpx

from . import config

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def chat(messages: list[dict], max_tokens: int = 3072,
         temperature: float = 0.6) -> str:
    headers = {"Content-Type": "application/json", **config.TEXT_HEADERS}
    if config.TEXT_API_KEY:
        headers["Authorization"] = f"Bearer {config.TEXT_API_KEY}"
    payload = {"model": config.TEXT_MODEL, "messages": messages,
               "max_tokens": max_tokens, "temperature": temperature}
    resp = httpx.post(f"{config.TEXT_BASE}/chat/completions", json=payload,
                      headers=headers, timeout=config.TEXT_TIMEOUT_S)
    resp.raise_for_status()
    data = resp.json()
    message = (data.get("choices") or [{}])[0].get("message") or {}
    content = str(message.get("content") or "").strip()
    if not content:
        content = str(message.get("reasoning_content") or "").strip()
    return content


def extract_json(text: str) -> dict:
    """Best-effort JSON object extraction from a model reply."""
    text = (text or "").strip()
    fence = _JSON_FENCE_RE.search(text)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except ValueError:
        pass
    # Fallback: scan for the first balanced {...} block.
    start = text.find("{")
    if start >= 0:
        depth, in_str, escape = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        data = json.loads(text[start:i + 1])
                        if isinstance(data, dict):
                            return data
                    except ValueError:
                        break
    raise ValueError("model reply is not a JSON object")


def as_str(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]
