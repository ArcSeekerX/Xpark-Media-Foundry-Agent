# Automated post-generation QC via the local vision model (ollama gemma3).
from __future__ import annotations

import base64
import json
import logging
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

from . import config
from .llm import extract_json

log = logging.getLogger("video-agent.qc")

SCHEMA = ('{"verdict":"pass|warn|fail","issues":["..."],"note":"一句中文结论"}')

VIDEO_PROMPT = (
    "你是视频质检员。以下是一条 AI 生成视频按时间顺序抽取的 {n} 帧。"
    "请检查:1) 画面是否清晰完整,有无明显畸变、崩坏或肢体错误;"
    "2) 是否有乱码文字、水印或 logo;3) 是否达到可用成片水准。"
    "判定:无问题=pass;轻微瑕疵=warn;严重崩坏/乱码/水印=fail。"
    "只输出 JSON,不要多余文字:" + SCHEMA)

IMAGE_PROMPT = (
    "你是图片质检员。以下是 AI 生成的一张参考图。"
    "请检查:1) 画面是否清晰完整,有无明显畸变或崩坏;"
    "2) 是否有乱码文字、错别字、水印或 logo;3) 是否达到可用参考图水准。"
    "判定:无问题=pass;轻微瑕疵=warn;严重崩坏/乱码/水印=fail。"
    "只输出 JSON,不要多余文字:" + SCHEMA)


def enabled() -> bool:
    return bool(config.QC_ENABLED and config.QC_BASE)


def _frames(path: Path, count: int = 3) -> list[bytes]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg:
        raise RuntimeError("ffmpeg 不可用")
    duration = 0.0
    if ffprobe:
        try:
            out = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(path)],
                capture_output=True, text=True, timeout=60, check=True).stdout
            duration = float(out.strip() or 0)
        except Exception:
            duration = 0.0
    if duration and duration > 1.5 and count > 1:
        stamps = [max(0.05, duration * f) for f in (0.05, 0.5, 0.95)][:count]
    elif duration:
        stamps = [duration / 2]
    else:
        stamps = [0.5]
    frames = []
    with tempfile.TemporaryDirectory() as td:
        for i, ts in enumerate(stamps):
            out_path = Path(td) / f"f{i}.jpg"
            subprocess.run(
                [ffmpeg, "-y", "-v", "error", "-ss", f"{ts:.3f}", "-i", str(path),
                 "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", str(out_path)],
                capture_output=True, timeout=120, check=True)
            if out_path.exists():
                frames.append(out_path.read_bytes())
    return frames


def _ask(prompt: str, frames: list[bytes]) -> dict:
    # plain replace: the prompt contains literal JSON braces
    content: list[dict] = [{"type": "text", "text": prompt.replace("{n}", str(len(frames)))}]
    for frame in frames:
        b64 = base64.b64encode(frame).decode()
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    headers = {"Content-Type": "application/json"}
    if config.QC_API_KEY:
        headers["Authorization"] = f"Bearer {config.QC_API_KEY}"
    data: dict | None = None
    for attempt in range(2):
        messages = [{"role": "user", "content": content}]
        if attempt == 1:
            messages.append({"role": "assistant", "content": "(上一次输出无法解析)"})
            messages.append({"role": "user", "content":
                             "只输出一行合法 JSON（以 { 开头、以 } 结尾），"
                             "不要任何解释、不要 markdown 代码块。"})
        payload = {"model": config.QC_MODEL, "messages": messages,
                   "max_tokens": 400, "temperature": 0.2}
        resp = httpx.post(f"{config.QC_BASE}/chat/completions", json=payload,
                          headers=headers, timeout=config.QC_TIMEOUT_S)
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        try:
            data = extract_json(text)
            break
        except ValueError:
            data = None
    if data is None:
        data = {"verdict": "warn", "issues": [],
                "note": "质检模型输出无法解析，建议人工复核"}
    verdict = str(data.get("verdict") or "").strip().lower()
    if verdict not in ("pass", "warn", "fail"):
        verdict = "warn"
    issues = data.get("issues")
    if not isinstance(issues, list):
        issues = []
    return {"verdict": verdict,
            "issues": [str(i)[:120] for i in issues[:5]],
            "note": str(data.get("note") or "")[:200],
            "model": config.QC_MODEL,
            "frames": len(frames),
            "checked_at": time.time()}


def check_video(path: Path) -> dict:
    frames = _frames(path, count=3)
    return _ask(VIDEO_PROMPT, frames)


def check_image(path: Path) -> dict:
    frames = _frames(path, count=1)
    return _ask(IMAGE_PROMPT, frames)
