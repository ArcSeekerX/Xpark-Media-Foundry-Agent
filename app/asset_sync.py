# Unified external-asset registry: scan configured directories and register
# media into the library (files stay in place; origin_path points at them).
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from pathlib import Path

from . import config, store

log = logging.getLogger("video-agent.asset-sync")

SKIP_MARKERS = ("/node_modules/", "/.git/", "/.hypit/", "/venv/", "/.venv/",
                "/data/assets/", "/__pycache__/", "/.cache/")
VIDEO_EXT = (".mp4", ".mov", ".webm")

_cache: dict = {"at": 0.0, "data": None}
CACHE_TTL = 120.0


def _skip(path: Path) -> bool:
    text = str(path)
    return any(marker in text for marker in SKIP_MARKERS) or \
        path.name.startswith(".")


def _ffprobe(path: Path) -> dict:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {}
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,duration",
             "-show_entries", "format=duration", "-of", "json", str(path)],
            capture_output=True, timeout=60, check=True).stdout
        data = json.loads(out)
        stream = (data.get("streams") or [{}])[0]
        return {"width": int(stream.get("width") or 0),
                "height": int(stream.get("height") or 0),
                "duration_s": float((data.get("format") or {}).get("duration")
                                    or stream.get("duration") or 0)}
    except Exception:
        return {}


def _poster(video: Path, target: Path) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    try:
        subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-ss", "0.4", "-i", str(video),
             "-frames:v", "1", "-vf", "scale=960:-2", str(target)],
            capture_output=True, timeout=120, check=True)
        return target.exists() and target.stat().st_size > 0
    except Exception:
        return False


def register_file(path: Path, source: str = "imported") -> dict | None:
    kind = "video" if path.suffix.lower() in VIDEO_EXT else "image"
    meta: dict = {}
    if kind == "video":
        meta = _ffprobe(path)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0.0
    asset = store.create_asset(
        kind=kind, filename=path.name, title=path.stem[:40],
        source=source, origin_path=str(path),
        duration_s=meta.get("duration_s") or 0,
        width=meta.get("width", 0), height=meta.get("height", 0),
        size_bytes=path.stat().st_size if path.exists() else 0,
        created_at=mtime)
    if kind == "video":
        poster_name = "poster.jpg"
        if _poster(path, config.ASSET_DIR / asset["id"] / poster_name):
            asset = store.update_asset(asset["id"], poster=poster_name)
    return asset


def scan(dry_run: bool = False) -> dict:
    """Walk the configured sources; register not-yet-known media files."""
    known = {a.get("origin_path") for a in store.list_assets(limit=100000)
             if a.get("origin_path")}
    sources = []
    discovered = added = 0
    for src in config.ASSET_SOURCES:
        root = Path(src)
        entry = {"path": src, "exists": root.exists(), "found": 0,
                 "added": 0, "examples": []}
        if root.exists():
            for path in sorted(root.rglob("*")):
                if not path.is_file() or _skip(path):
                    continue
                if path.suffix.lower() not in config.ASSET_EXTENSIONS:
                    continue
                entry["found"] += 1
                if str(path) in known:
                    continue
                discovered += 1
                if len(entry["examples"]) < 3:
                    entry["examples"].append(path.name)
                if dry_run:
                    continue
                try:
                    register_file(path)
                    known.add(str(path))
                    entry["added"] += 1
                    added += 1
                except Exception:
                    log.warning("register failed: %s", path, exc_info=True)
        sources.append(entry)
    result = {"sources": sources, "discovered": discovered, "added": added,
              "dry_run": dry_run, "registered_total": len(known)}
    _cache["at"] = time.monotonic()
    _cache["data"] = result
    return result


def summary(force: bool = False) -> dict:
    if not force and _cache["data"] and time.monotonic() - _cache["at"] < CACHE_TTL:
        return _cache["data"]
    return scan(dry_run=True)
