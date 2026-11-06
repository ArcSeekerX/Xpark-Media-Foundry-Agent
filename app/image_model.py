# Qwen-Image 2.1 reference-image client (HTTP service on :8601).
from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Optional

import httpx

from . import config


def status() -> Optional[dict]:
    """Return {"status": "ok", "loaded": bool} when the service is up."""
    try:
        resp = httpx.get(f"{config.QWEN_IMAGE_URL}/", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return data if data.get("status") == "ok" else None
    except Exception:
        return None


def edit(image_path, prompt: str, *, steps: Optional[int] = None,
         seed: Optional[int] = None,
         negative: str = "乱码，错别字，繁体字，水印，logo，由AI生成",
         output_resolution: int = 0) -> tuple[bytes, dict]:
    """Image-edit mode: preserve the layout, change text / remove watermarks."""
    payload: dict = {"prompt": prompt, "negative_prompt": negative,
                     "steps": int(steps or 30),
                     "image_b64": base64.b64encode(Path(image_path).read_bytes()).decode()}
    if seed is not None:
        payload["seed"] = int(seed)
    if output_resolution:
        payload["output_resolution"] = int(output_resolution)
    started = time.monotonic()
    resp = httpx.post(f"{config.QWEN_IMAGE_URL}/generate", json=payload,
                      timeout=config.QWEN_TIMEOUT_S)
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise RuntimeError(f"qwen-image-edit: {data['error'][:300]}")
    png = base64.b64decode(data["image_b64"])
    return png, {"seconds": data.get("seconds") or round(time.monotonic() - started, 1),
                 "width": int(data.get("width") or 0),
                 "height": int(data.get("height") or 0)}


def generate(prompt: str, *, aspect: str = "16:9", steps: Optional[int] = None,
             seed: Optional[int] = None, negative: str = "") -> tuple[bytes, dict]:
    """Text-to-image. Returns (png_bytes, meta) with meta = seconds/w/h."""
    width, height = config.IMAGE_SIZES.get(aspect, config.IMAGE_SIZES["16:9"])
    payload: dict = {"prompt": prompt, "negative_prompt": negative,
                     "width": width, "height": height,
                     "steps": int(steps or config.IMAGE_STEPS)}
    if seed is not None:
        payload["seed"] = int(seed)
    started = time.monotonic()
    resp = httpx.post(f"{config.QWEN_IMAGE_URL}/generate", json=payload,
                      timeout=config.QWEN_TIMEOUT_S)
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise RuntimeError(f"qwen-image: {data['error'][:300]}")
    png = base64.b64decode(data["image_b64"])
    return png, {"seconds": data.get("seconds") or round(time.monotonic() - started, 1),
                 "width": int(data.get("width") or width),
                 "height": int(data.get("height") or height)}
