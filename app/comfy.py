# ComfyUI HTTP client for the local MiniMax H3 workflow.
from __future__ import annotations

import json
import mimetypes
import time
from typing import Any, Optional

import httpx

from . import config


def ping() -> Optional[dict]:
    """Return /system_stats when ComfyUI is reachable, else None."""
    try:
        resp = httpx.get(f"{config.COMFY_BASE}/system_stats", timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def queue_state() -> dict:
    try:
        resp = httpx.get(f"{config.COMFY_BASE}/queue", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return {"running": len(data.get("queue_running") or []),
                "pending": len(data.get("queue_pending") or [])}
    except Exception:
        return {"running": 0, "pending": 0}


def upload_image(data: bytes, filename: str) -> str:
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    resp = httpx.post(
        f"{config.COMFY_BASE}/upload/image",
        files={"image": (filename, data, ctype)},
        data={"overwrite": "true"},
        timeout=180)
    resp.raise_for_status()
    return resp.json()["name"]


def submit(workflow: dict) -> str:
    resp = httpx.post(f"{config.COMFY_BASE}/prompt", json={"prompt": workflow},
                      timeout=60)
    resp.raise_for_status()
    return resp.json()["prompt_id"]


def history(prompt_id: str) -> Optional[dict]:
    resp = httpx.get(f"{config.COMFY_BASE}/history/{prompt_id}", timeout=60)
    resp.raise_for_status()
    return resp.json().get(prompt_id)


def download(item: dict) -> bytes:
    params = {"filename": item["filename"],
              "subfolder": item.get("subfolder") or "",
              "type": item.get("type") or "output"}
    resp = httpx.get(f"{config.COMFY_BASE}/view", params=params, timeout=600)
    resp.raise_for_status()
    return resp.content


def cancel_prompt(prompt_id: str) -> None:
    """Cancel only our prompt: drop it from the pending queue if it has not
    started, or interrupt ComfyUI when it is the prompt actually running.

    ComfyUI shares one GPU with any other client (web UI, other tools), so a
    blind /interrupt could kill someone else's render.
    """
    if not prompt_id:
        return
    try:
        httpx.post(f"{config.COMFY_BASE}/queue", json={"delete": [prompt_id]},
                   timeout=10)
    except Exception:
        pass
    try:
        data = httpx.get(f"{config.COMFY_BASE}/queue", timeout=10).json()
        running = data.get("queue_running") or []
        if running and running[0][1] == prompt_id:
            httpx.post(f"{config.COMFY_BASE}/interrupt", json={}, timeout=10)
    except Exception:
        pass


_VIDEO_EXT = (".mp4", ".webm", ".mov", ".mkv", ".gif")


def find_video(entry: dict) -> dict:
    """First video artifact in a history entry.

    SaveVideo in this ComfyUI build reports mp4 under 'images' with
    animated=[true], so video extensions are matched there too.
    """
    outputs = entry.get("outputs") or {}
    for node_out in outputs.values():
        for item in node_out.get("videos") or []:
            if item.get("filename"):
                return item
        for item in node_out.get("gifs") or []:
            if item.get("filename"):
                return item
    for node_out in outputs.values():
        for item in node_out.get("images") or []:
            if str(item.get("filename", "")).lower().endswith(_VIDEO_EXT):
                return item
    raise RuntimeError(f"ComfyUI history has no video output: {list(outputs)}")


def wait_for_prompt(prompt_id: str, should_cancel, timeout_s: float,
                    on_tick=None, interval_s: float = 3.0) -> dict:
    """Poll /history until the prompt completes.

    `should_cancel()` is checked every tick; `on_tick(elapsed)` lets the caller
    update progress. ComfyUI's HTTP loop can stall for minutes while the GPU is
    saturated, so HTTP errors are transient until the overall deadline.
    """
    deadline = time.monotonic() + timeout_s
    started = time.monotonic()
    while True:
        if should_cancel():
            cancel_prompt(prompt_id)
            raise JobCancelled()
        elapsed = int(time.monotonic() - started)
        try:
            entry = history(prompt_id)
        except Exception:
            entry = None
        if entry:
            status = entry.get("status") or {}
            if status.get("completed"):
                return entry
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI render failed: {status.get('messages')}")
        if on_tick:
            on_tick(elapsed, entry)
        if time.monotonic() > deadline:
            cancel_prompt(prompt_id)
            raise RuntimeError(f"render timed out after {timeout_s:.0f}s")
        time.sleep(interval_s)


class JobCancelled(Exception):
    pass


def watch_progress(prompt_id: str, on_progress, is_done) -> None:
    """Follow ComfyUI's websocket and report sampling progress.

    Runs in its own thread; silently degrades to no-progress when the
    websocket is unavailable. `on_progress(value, maximum)` receives the
    sampler step counter from the running prompt only.
    """
    try:
        import websocket  # websocket-client
    except Exception:
        return
    client_id = f"va_{int(time.time() * 1000)}"
    url = config.COMFY_BASE.replace("http://", "ws://").replace("https://", "wss://")
    try:
        ws = websocket.create_connection(f"{url}/ws?clientId={client_id}",
                                         timeout=8)
    except Exception:
        return
    ws.settimeout(1.5)
    failures = 0
    try:
        while not is_done():
            try:
                raw = ws.recv()
                failures = 0
            except websocket.WebSocketTimeoutException:
                failures = 0
                continue
            except Exception:
                failures += 1
                if failures >= 3 or not ws.connected:
                    return
                time.sleep(0.5)
                continue
            if not raw:
                failures += 1
                if failures >= 3:
                    return
                time.sleep(0.2)
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if msg.get("type") != "progress":
                continue
            data = msg.get("data") or {}
            if data.get("prompt_id") and data["prompt_id"] != prompt_id:
                continue
            maximum = int(data.get("max") or 0)
            value = int(data.get("value") or 0)
            if maximum > 0:
                on_progress(value, maximum)
    finally:
        try:
            ws.close()
        except Exception:
            pass


def http_json(path: str, timeout: float = 10) -> dict[str, Any]:
    resp = httpx.get(config.COMFY_BASE + path, timeout=timeout)
    resp.raise_for_status()
    return resp.json()
