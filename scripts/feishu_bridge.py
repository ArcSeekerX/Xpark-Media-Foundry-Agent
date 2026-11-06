#!/usr/bin/env python3
"""Feishu -> Xpark pipeline bridge.

Polls the dedicated pipeline chat (VA_FEISHU_CHAT) for new user messages via
lark-cli, feeds them into the local agent API and replies in the same chat.
Finished jobs are pushed back by the render worker (job.feishu_target).

Commands: 「新对话」/「/new」 resets the pipeline conversation mapping.
"""
from __future__ import annotations

import json
import mimetypes
import subprocess
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, feishu  # noqa: E402

API = "http://127.0.0.1:5100"
POLL_S = 5
STATE_PATH = config.DATA_DIR / "feishu_state.json"
RESET_WORDS = {"新对话", "/new", "重置", "重新开始", "清空上下文"}


def log(*args) -> None:
    print("[feishu-bridge]", *args, flush=True)


def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"initialized": False, "seen": [], "conversations": {}}


def save_state(state: dict) -> None:
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_PATH)


def watch_chats() -> list[str]:
    out: list[str] = []
    for chat in [config.FEISHU_CHAT, *config.FEISHU_EXTRA_CHATS]:
        chat = (chat or "").strip()
        if chat and chat not in out:
            out.append(chat)
    return out


def fetch_messages(chat_id: str) -> list[dict]:
    cli = feishu.lark_cli()
    if not cli:
        raise RuntimeError("lark-cli 不可用")
    proc = subprocess.run(
        [cli, "im", "+chat-messages-list", "--chat-id", chat_id,
         "--as", "bot", "--order", "desc", "--page-size", "20", "--format", "json"],
        cwd=config.BASE_DIR, env=feishu.cli_env(), capture_output=True, text=True, timeout=60)
    data = json.loads(proc.stdout or "{}")
    if not data.get("ok"):
        raise RuntimeError(f"list failed: {str(data)[:200]}")
    return (data.get("data") or {}).get("messages") or []


def extract_text(msg: dict) -> str:
    if msg.get("msg_type") != "text":
        return ""
    return str(msg.get("content") or "").strip()


def download_image(msg: dict) -> Path | None:
    if msg.get("msg_type") != "image":
        return None
    try:
        key = json.loads(msg.get("content") or "{}").get("image_key")
    except ValueError:
        key = None
    if not key:
        return None
    suffix = ".png"
    out_dir = config.DATA_DIR / "tmp"
    out_dir.mkdir(parents=True, exist_ok=True)
    rel = f"data/tmp/feishu-{msg['message_id'][-8:]}{suffix}"
    cli = feishu.lark_cli()
    proc = subprocess.run(
        [cli, "im", "+messages-resources-download",
         "--message-id", msg["message_id"], "--file-key", key,
         "--type", "image", "--output", rel],
        cwd=config.BASE_DIR, env=feishu.cli_env(), capture_output=True, text=True, timeout=120)
    path = config.BASE_DIR / rel
    if proc.returncode != 0 or not path.exists():
        log("image download failed:", (proc.stdout or proc.stderr or "")[:200])
        return None
    return path


def upload_asset(path: Path) -> str:
    ctype = mimetypes.guess_type(path.name)[0] or "image/png"
    with open(path, "rb") as fh:
        resp = httpx.post(f"{API}/api/assets/upload",
                          files={"file": (path.name, fh, ctype)}, timeout=180)
    resp.raise_for_status()
    return resp.json()["id"]


def is_reset(text: str) -> bool:
    text = text.replace("／", "/").strip()
    if text.lower() in RESET_WORDS:
        return True
    return any(tok.lower() in RESET_WORDS for tok in text.split())


def handle_message(msg: dict, state: dict, chat: str) -> None:
    sender = msg.get("sender") or {}
    if sender.get("sender_type") != "user":
        return
    text = extract_text(msg)
    image_path = download_image(msg)
    if not text and not image_path:
        return
    if is_reset(text) and not image_path:
        state["conversations"].pop(chat, None)
        feishu.send_text("已开始新对话，说说你想生成什么。", chat)
        log("conversation reset by user")
        return
    attachment_id = upload_asset(image_path) if image_path else ""
    log(f"message ({chat}) -> pipeline: {text[:60]!r} attachment={attachment_id}")
    resp = httpx.post(f"{API}/api/chat", json={
        "conversation_id": state["conversations"].get(chat, ""),
        "content": text,
        "attachment_asset_id": attachment_id,
        "feishu_target": chat,
    }, timeout=300)
    resp.raise_for_status()
    data = resp.json()
    if data.get("conversation_id"):
        state["conversations"][chat] = data["conversation_id"]
    feishu.send_text(data.get("reply") or "…", chat)


def baseline_chat(chat: str, seen: set[str]) -> bool:
    try:
        for msg in fetch_messages(chat):
            seen.add(msg["message_id"])
        return True
    except Exception as exc:
        log(f"baseline fetch failed ({chat}):", str(exc)[:200])
        return False


def main() -> None:
    if not (config.FEISHU_ENABLED and config.FEISHU_CHAT):
        log("disabled: set VA_FEISHU_ENABLED=1 and VA_FEISHU_CHAT")
        return
    chats = watch_chats()
    log(f"watching chats: {', '.join(chats)}")
    state = load_state()
    seen: set[str] = set(state.get("seen") or [])
    baselined: list[str] = state.get("baselined") or []
    if not baselined and state.get("initialized"):
        baselined = [config.FEISHU_CHAT]
    while True:
        for chat in [c for c in chats if c not in baselined]:
            if baseline_chat(chat, seen):
                baselined.append(chat)
                state["baselined"] = baselined
                save_state({**state, "seen": list(seen)[-500:]})
                log(f"baseline established ({chat})")
        for chat in chats:
            if chat not in baselined:
                continue
            try:
                for msg in reversed(fetch_messages(chat)):
                    mid = msg.get("message_id")
                    if not mid or mid in seen:
                        continue
                    seen.add(mid)
                    handle_message(msg, state, chat)
            except Exception as exc:
                log(f"poll error ({chat}):", str(exc)[:200])
        try:
            state["seen"] = list(seen)[-500:]
            save_state(state)
        except Exception as exc:
            log("state save failed:", str(exc)[:200])
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
