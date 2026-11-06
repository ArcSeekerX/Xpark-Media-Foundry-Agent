#!/usr/bin/env python3
"""Feishu DM -> opencode general-agent bridge.

Watches the bot's P2P chat (VA_OPENCODE_CHAT) and runs each user message
through `opencode run --format json --thinking`, forwarding the thinking /
tool-execution trace and the final reply back to the chat.

Commands: 「新对话」/「/new」 starts a fresh opencode session.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, feishu  # noqa: E402
from feishu_bridge import extract_text, fetch_messages, is_reset  # noqa: E402

POLL_S = 5
ACK_AFTER_S = 15
STATE_PATH = config.DATA_DIR / "opencode_state.json"
MAX_SEND_CHARS = 8500


def log(*args) -> None:
    print("[opencode-bridge]", *args, flush=True)


def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"baselined": False, "seen": [], "session": ""}


def save_state(state: dict) -> None:
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_PATH)


def cli_env() -> dict:
    env = dict(os.environ)
    node_bin = "/root/.nvm/versions/node/v26.4.0/bin"
    env["PATH"] = f"/root/.opencode/bin:{node_bin}:{env.get('PATH', '/usr/local/bin:/usr/bin:/bin')}"
    env.setdefault("HOME", "/root")
    return env


def send_chunked(chat: str, text: str, limit: int = 1700) -> None:
    text = (text or "").strip()[:MAX_SEND_CHARS]
    while text:
        if len(text) <= limit:
            chunk, text = text, ""
        else:
            cut = text.rfind("\n", 0, limit)
            if cut < limit // 2:
                cut = limit
            chunk, text = text[:cut], text[cut:].lstrip()
        feishu.send_text(chunk, chat)


def summarize_tool(part: dict) -> str:
    name = part.get("tool") or "tool"
    state = part.get("state") or {}
    inp = state.get("input") or {}
    detail = ""
    if isinstance(inp, dict):
        for key in ("command", "filePath", "path", "pattern", "description", "url", "query"):
            if inp.get(key):
                detail = str(inp[key])
                break
        else:
            detail = json.dumps(inp, ensure_ascii=False)
    else:
        detail = str(inp)
    detail = " ".join(detail.split())[:90]
    icon = {"completed": "✓", "error": "✗", "running": "…"}.get(state.get("status") or "", "")
    return f"🔧 {name} {detail} {icon}".rstrip()


def format_trace(reasonings: list[str], tools: list[str]) -> str:
    blocks = []
    if reasonings:
        blocks.append("🧠 思考\n" + "\n".join(reasonings))
    if tools:
        blocks.append("⚙️ 执行\n" + "\n".join(tools))
    return "\n\n".join(blocks).strip()


def run_agent(text: str, state: dict, chat: str) -> None:
    cmd = [config.OPENCODE_BIN, "run", "--format", "json", "--thinking"]
    if config.OPENCODE_MODEL:
        cmd += ["-m", config.OPENCODE_MODEL]
    if config.OPENCODE_VARIANT:
        cmd += ["--variant", config.OPENCODE_VARIANT]
    if state.get("session"):
        cmd += ["-s", state["session"]]
    cmd += ["--", text]
    log(f"agent start: {text[:60]!r} session={state.get('session') or '(new)'}")

    done = {"finished": False, "acked": False}

    def ack_later() -> None:
        time.sleep(ACK_AFTER_S)
        if not done["finished"] and not done["acked"]:
            done["acked"] = True
            try:
                feishu.send_text("⏳ 收到，处理中…", chat)
            except Exception as exc:
                log("ack failed:", str(exc)[:150])

    threading.Thread(target=ack_later, daemon=True).start()

    proc = subprocess.Popen(
        cmd, cwd=config.OPENCODE_DIR, env=cli_env(),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    killer = threading.Timer(config.OPENCODE_TIMEOUT_S, proc.kill)
    killer.start()

    reasonings: list[str] = []
    tools: list[str] = []
    replies: list[str] = []
    noise: list[str] = []
    session_id = ""
    try:
        for line in proc.stdout or []:
            line = line.strip()
            if not line:
                continue
            if not line.startswith("{"):
                noise.append(line)
                noise = noise[-5:]
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            etype = event.get("type")
            part = event.get("part") or {}
            session_id = event.get("sessionID") or session_id
            if etype == "reasoning":
                chunk = str(part.get("text") or "").strip()
                if chunk:
                    reasonings.append(chunk)
            elif etype == "tool_use":
                tools.append(summarize_tool(part))
            elif etype == "text":
                chunk = str(part.get("text") or "").strip()
                if chunk:
                    replies.append(chunk)
            elif etype == "error":
                tools.append(f"⚠️ {str(event.get('error') or event)[:200]}")
    finally:
        proc.wait(timeout=30)
        killer.cancel()
        done["finished"] = True

    if session_id and session_id != state.get("session"):
        state["session"] = session_id
        save_state(state)

    trace = format_trace(reasonings, tools)
    if trace:
        send_chunked(chat, trace)
    reply = "\n\n".join(replies).strip()
    if reply:
        send_chunked(chat, reply)
    elif proc.returncode not in (0, None):
        detail = "\n".join(noise)[-300:] or f"rc={proc.returncode}"
        send_chunked(chat, f"⚠️ 执行失败：{detail}")
    else:
        send_chunked(chat, "（本轮没有文字输出）")
    log(f"agent done rc={proc.returncode} reply={len(reply)}chars tools={len(tools)}")


def handle_message(msg: dict, state: dict, chat: str) -> None:
    sender = msg.get("sender") or {}
    if sender.get("sender_type") != "user":
        return
    text = extract_text(msg)
    if not text:
        return
    if is_reset(text):
        state["session"] = ""
        save_state(state)
        feishu.send_text("已开始新对话，直接说要做什么就行。", chat)
        log("conversation reset by user")
        return
    run_agent(text, state, chat)


def main() -> None:
    chat = config.OPENCODE_CHAT
    if not (config.FEISHU_ENABLED and chat):
        log("disabled: set VA_FEISHU_ENABLED=1 and VA_OPENCODE_CHAT")
        return
    log(f"watching chat {chat}")
    state = load_state()
    seen: set[str] = set(state.get("seen") or [])
    while not state.get("baselined"):
        try:
            for msg in fetch_messages(chat):
                seen.add(msg["message_id"])
            state["baselined"] = True
            state["seen"] = list(seen)[-500:]
            save_state(state)
            log("baseline established")
        except Exception as exc:
            log("baseline failed:", str(exc)[:200])
            time.sleep(POLL_S)
    while True:
        try:
            for msg in reversed(fetch_messages(chat)):
                mid = msg.get("message_id")
                if not mid or mid in seen:
                    continue
                seen.add(mid)
                state["seen"] = list(seen)[-500:]
                save_state(state)
                handle_message(msg, state, chat)
        except Exception as exc:
            log("poll error:", str(exc)[:200])
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
