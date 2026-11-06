# Feishu (lark-cli) delivery: push finished assets / status to a user or chat.
#
# Reuses the production conventions: relative paths only (lark-cli rejects
# absolute paths), cover frame for videos, and compress when > 30 MB.
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from . import config, store

log = logging.getLogger("video-agent.feishu")

MAX_VIDEO_BYTES = 30 * 1024 * 1024
_LARK_FALLBACKS = (
    "/root/.nvm/versions/node/v26.4.0/bin/lark-cli",
    "/home/admin/.local/npm/bin/lark-cli",
)


def cli_env() -> dict:
    """lark-cli is a node script; make sure node is reachable."""
    env = dict(os.environ)
    node_bin = "/root/.nvm/versions/node/v26.4.0/bin"
    env["PATH"] = f"{node_bin}:{env.get('PATH', '/usr/local/bin:/usr/bin:/bin')}"
    env.setdefault("HOME", "/root")
    return env


def lark_cli() -> Optional[str]:
    if config.LARK_CLI and Path(config.LARK_CLI).exists():
        return config.LARK_CLI
    found = shutil.which("lark-cli")
    if found:
        return found
    for candidate in _LARK_FALLBACKS:
        if Path(candidate).exists():
            return candidate
    return None


def enabled() -> bool:
    return bool(config.FEISHU_ENABLED and config.FEISHU_TARGET and lark_cli())


def _relative(path: Path) -> str:
    """lark-cli only accepts cwd-relative paths."""
    try:
        return str(path.resolve().relative_to(config.BASE_DIR))
    except ValueError:
        target = config.DATA_DIR / "tmp" / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        return str(target.relative_to(config.BASE_DIR))


def _run(args: list[str], timeout: float = 180) -> dict:
    cli = lark_cli()
    if not cli:
        raise RuntimeError("lark-cli 不可用")
    proc = subprocess.run([cli, *args], cwd=config.BASE_DIR, env=cli_env(),
                          capture_output=True, text=True, timeout=timeout)
    raw = (proc.stdout or "").strip()
    try:
        data = json.loads(raw)
    except ValueError:
        data = {"ok": proc.returncode == 0, "raw": raw[:300]}
    if not data.get("ok", proc.returncode == 0):
        detail = str(data)[:200] or (proc.stderr or "")[:200]
        raise RuntimeError(f"lark-cli 失败(rc={proc.returncode}): {detail}")
    return data


def _target_args(target: str) -> list[str]:
    target = (target or config.FEISHU_TARGET).strip()
    if not target:
        raise RuntimeError("未配置飞书接收人")
    return ["--chat-id", target] if target.startswith("oc_") else ["--user-id", target]


def send_text(text: str, target: str = "") -> None:
    _run(["im", "+messages-send", *_target_args(target), "--text", text[:1800]])


def send_image(path: Path, target: str = "") -> None:
    _run(["im", "+messages-send", *_target_args(target),
          "--image", _relative(path)])


def _prepare_video(path: Path) -> Path:
    """Compress to <30MB when needed (production delivery rule)."""
    if path.stat().st_size <= MAX_VIDEO_BYTES:
        return path
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return path
    out_dir = config.DATA_DIR / "tmp"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"feishu-{path.stem}-compressed.mp4"
    try:
        subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-i", str(path),
             "-c:v", "libx264", "-crf", "26", "-c:a", "aac", "-b:a", "128k",
             "-movflags", "+faststart", str(out)],
            capture_output=True, timeout=900, check=True)
        if out.exists() and out.stat().st_size > 0:
            return out
    except Exception:
        log.warning("compress failed, sending original", exc_info=True)
    return path


def _cover_for(video: Path, asset: Optional[dict]) -> Optional[Path]:
    if asset:
        poster = store.poster_path(asset)
        if poster and poster.exists():
            return poster
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    out_dir = config.DATA_DIR / "tmp"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{video.stem}-cover.jpg"
    try:
        subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-ss", "0.4", "-i", str(video),
             "-frames:v", "1", "-vf", "scale=960:-2", str(out)],
            capture_output=True, timeout=120, check=True)
        return out if out.exists() else None
    except Exception:
        return None


def send_video(path: Path, target: str = "",
               asset: Optional[dict] = None) -> None:
    prepared = _prepare_video(path)
    cover = _cover_for(prepared, asset)
    args = ["im", "+messages-send", *_target_args(target),
            "--video", _relative(prepared)]
    if cover:
        args += ["--video-cover", _relative(cover)]
    _run(args, timeout=300)


def send_asset(asset: dict, target: str = "") -> None:
    path = store.asset_file_path(asset)
    if not path.exists():
        raise RuntimeError("资产文件不存在")
    if asset["kind"] == "video":
        send_video(path, target, asset)
    else:
        send_image(path, target)


def notify_job(job: dict, assets: Optional[list[dict]] = None) -> None:
    """Push a finished (or failed) job to Feishu. Never raises."""
    if not enabled():
        return
    target = (job.get("feishu_target") or "").strip()
    try:
        if job["status"] == "succeeded" and assets:
            lines = [f"《{job['title']}》已完成"]
            if job.get("kind") == "image":
                for asset in assets[:4]:
                    send_image(store.asset_file_path(asset), target)
                lines.append(f"共 {len(assets)} 张参考图已入库")
                send_text("\n".join(lines), target)
            else:
                asset = assets[0]
                send_video(store.asset_file_path(asset), target, asset)
                duration = asset.get("duration_s") or 0
                send_text(f"{lines[0]}\n时长 {duration:.1f}s · 分辨率 "
                          f"{asset.get('width')}×{asset.get('height')}\n"
                          f"提示词: {(job.get('prompt') or '')[:120]}", target)
        elif job["status"] == "failed":
            send_text(f"《{job.get('title') or '任务'}》生成失败: "
                      f"{(job.get('error') or '')[:200]}", target)
    except Exception:
        log.warning("feishu notify failed for job %s", job.get("id"),
                    exc_info=True)
