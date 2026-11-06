# SQLite-backed store for assets and generation jobs.
from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from . import config

_LOCK = threading.RLock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    title TEXT DEFAULT '',
    prompt TEXT DEFAULT '',
    source TEXT DEFAULT 'generated',
    job_id TEXT DEFAULT '',
    poster TEXT DEFAULT '',
    duration_s REAL DEFAULT 0,
    width INTEGER DEFAULT 0,
    height INTEGER DEFAULT 0,
    size_bytes INTEGER DEFAULT 0,
    origin_path TEXT DEFAULT '',
    conversation_id TEXT DEFAULT '',
    qc TEXT DEFAULT '',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT DEFAULT 'video',
    image_count INTEGER DEFAULT 1,
    title TEXT DEFAULT '',
    prompt TEXT NOT NULL,
    duration_s INTEGER DEFAULT 5,
    aspect TEXT DEFAULT '16:9',
    first_frame_asset_id TEXT DEFAULT '',
    last_frame_asset_id TEXT DEFAULT '',
    source_asset_id TEXT DEFAULT '',
    params TEXT DEFAULT '{}',
    conversation_id TEXT DEFAULT '',
    feishu_target TEXT DEFAULT '',
    status TEXT DEFAULT 'queued',
    stage TEXT DEFAULT '排队中',
    progress REAL DEFAULT 0,
    error TEXT DEFAULT '',
    asset_id TEXT DEFAULT '',
    comfy_prompt_id TEXT DEFAULT '',
    cancel_requested INTEGER DEFAULT 0,
    created_at REAL NOT NULL,
    started_at REAL DEFAULT 0,
    finished_at REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT '',
    checklist TEXT DEFAULT '',
    proposal TEXT DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT DEFAULT '',
    job_id TEXT DEFAULT '',
    asset_id TEXT DEFAULT '',
    skills TEXT DEFAULT '',
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv
    ON messages(conversation_id, created_at);
"""

_ASSET_FIELDS = ("kind", "filename", "title", "prompt", "source", "job_id",
                 "poster", "duration_s", "width", "height", "size_bytes",
                 "origin_path", "conversation_id", "qc")
_JOB_FIELDS = ("kind", "image_count", "title", "prompt", "duration_s", "aspect",
               "first_frame_asset_id", "last_frame_asset_id", "source_asset_id",
               "params", "feishu_target", "status", "stage", "progress", "error",
               "asset_id", "comfy_prompt_id", "cancel_requested", "started_at",
               "finished_at")


def init_db() -> None:
    with _LOCK, _conn() as conn:
        conn.executescript(_SCHEMA)
        cols = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
        if "kind" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN kind TEXT DEFAULT 'video'")
        if "image_count" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN image_count INTEGER DEFAULT 1")
        if "last_frame_asset_id" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN last_frame_asset_id TEXT DEFAULT ''")
        if "feishu_target" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN feishu_target TEXT DEFAULT ''")
        if "source_asset_id" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN source_asset_id TEXT DEFAULT ''")
        if "params" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN params TEXT DEFAULT '{}'")
        if "conversation_id" not in cols:
            conn.execute("ALTER TABLE jobs ADD COLUMN conversation_id TEXT DEFAULT ''")
        acols = {row[1] for row in conn.execute("PRAGMA table_info(assets)")}
        if "origin_path" not in acols:
            conn.execute("ALTER TABLE assets ADD COLUMN origin_path TEXT DEFAULT ''")
        if "conversation_id" not in acols:
            conn.execute("ALTER TABLE assets ADD COLUMN conversation_id TEXT DEFAULT ''")
        if "qc" not in acols:
            conn.execute("ALTER TABLE assets ADD COLUMN qc TEXT DEFAULT ''")
        mcols = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
        if "skills" not in mcols:
            conn.execute("ALTER TABLE messages ADD COLUMN skills TEXT DEFAULT ''")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def now() -> float:
    return time.time()


def _row(row: Optional[sqlite3.Row]) -> Optional[dict]:
    return dict(row) if row else None


# ------------------------------------------------------------------ assets --

def asset_path(asset: dict) -> Path:
    return config.ASSET_DIR / asset["id"] / asset["filename"]


def asset_file_path(asset: dict) -> Path:
    """Local copy when present, otherwise the registered external origin."""
    local = asset_path(asset)
    if local.exists():
        return local
    origin = (asset.get("origin_path") or "").strip()
    return Path(origin) if origin else local


def poster_path(asset: dict) -> Optional[Path]:
    if not asset.get("poster"):
        return None
    return config.ASSET_DIR / asset["id"] / asset["poster"]


def create_asset(*, kind: str, filename: str, title: str = "", prompt: str = "",
                 source: str = "generated", job_id: str = "", poster: str = "",
                 duration_s: float = 0, width: int = 0, height: int = 0,
                 size_bytes: int = 0, origin_path: str = "",
                 conversation_id: str = "", created_at: float = 0.0,
                 data: bytes | None = None,
                 src_path: str | Path | None = None) -> dict:
    asset_id = new_id("a")
    target_dir = config.ASSET_DIR / asset_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / filename
    if data is not None:
        target.write_bytes(data)
    elif src_path is not None:
        shutil.copy2(src_path, target)
    elif not origin_path:
        raise ValueError("create_asset needs data, src_path or origin_path")
    record = {
        "id": asset_id, "kind": kind, "filename": filename, "title": title,
        "prompt": prompt, "source": source, "job_id": job_id, "poster": poster,
        "duration_s": float(duration_s or 0), "width": int(width or 0),
        "height": int(height or 0),
        "size_bytes": int(size_bytes or (target.stat().st_size
                                         if target.exists() else 0)),
        "origin_path": origin_path,
        "conversation_id": conversation_id,
        "created_at": float(created_at or now()),
    }
    cols = ", ".join(record)
    marks = ", ".join("?" for _ in record)
    with _LOCK, _conn() as conn:
        conn.execute(f"INSERT INTO assets ({cols}) VALUES ({marks})",
                     list(record.values()))
    return record


def update_asset(asset_id: str, **fields: Any) -> Optional[dict]:
    fields = {k: v for k, v in fields.items() if k in _ASSET_FIELDS}
    if not fields:
        return get_asset(asset_id)
    sets = ", ".join(f"{k}=?" for k in fields)
    with _LOCK, _conn() as conn:
        conn.execute(f"UPDATE assets SET {sets} WHERE id=?",
                     [*fields.values(), asset_id])
    return get_asset(asset_id)


def get_asset(asset_id: str) -> Optional[dict]:
    with _LOCK, _conn() as conn:
        row = conn.execute("SELECT * FROM assets WHERE id=?",
                           (asset_id,)).fetchone()
    return _row(row)


def count_assets(kind: Optional[str] = None,
                 conversation_id: Optional[str] = None) -> int:
    sql = "SELECT COUNT(*) FROM assets"
    where: list[str] = []
    args: list[Any] = []
    if kind in ("image", "video"):
        where.append("kind=?")
        args.append(kind)
    if conversation_id:
        where.append("conversation_id=?")
        args.append(conversation_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    with _LOCK, _conn() as conn:
        return int(conn.execute(sql, args).fetchone()[0])


def list_assets(kind: Optional[str] = None, limit: int = 500,
                offset: int = 0, conversation_id: Optional[str] = None,
                order: str = "desc") -> list[dict]:
    sql = "SELECT * FROM assets"
    where: list[str] = []
    args: list[Any] = []
    if kind in ("image", "video"):
        where.append("kind=?")
        args.append(kind)
    if conversation_id:
        where.append("conversation_id=?")
        args.append(conversation_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    direction = "ASC" if str(order).lower() == "asc" else "DESC"
    sql += f" ORDER BY created_at {direction} LIMIT ? OFFSET ?"
    args.extend((limit, offset))
    with _LOCK, _conn() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


def _origin_deletable(path: Path) -> bool:
    """Only delete originals that live under a configured asset source."""
    try:
        resolved = path.resolve()
    except OSError:
        return False
    for src in config.ASSET_SOURCES:
        try:
            root = Path(src).resolve()
        except OSError:
            continue
        if resolved == root or root in resolved.parents:
            return True
    return False


def delete_asset(asset_id: str) -> dict:
    """Delete the asset record, its local files, and the origin file."""
    asset = get_asset(asset_id)
    if not asset:
        return {"deleted": False, "origin_deleted": False, "origin": ""}
    origin = (asset.get("origin_path") or "").strip()
    origin_deleted = False
    if origin:
        origin_path = Path(origin)
        if origin_path.exists() and _origin_deletable(origin_path):
            try:
                origin_path.unlink()
                origin_deleted = True
            except OSError:
                pass
    with _LOCK, _conn() as conn:
        cur = conn.execute("DELETE FROM assets WHERE id=?", (asset_id,))
        if cur.rowcount:
            conn.execute("UPDATE jobs SET asset_id='' WHERE asset_id=?",
                         (asset_id,))
    if cur.rowcount:
        shutil.rmtree(config.ASSET_DIR / asset_id, ignore_errors=True)
    return {"deleted": bool(cur.rowcount),
            "origin_deleted": origin_deleted, "origin": origin if origin_deleted else ""}


# -------------------------------------------------------------------- jobs --

def create_job(*, prompt: str, title: str = "", duration_s: int = 5,
               aspect: str = "16:9", first_frame_asset_id: str = "",
               last_frame_asset_id: str = "", source_asset_id: str = "",
               params: Optional[dict] = None, conversation_id: str = "",
               feishu_target: str = "",
               kind: str = "video", image_count: int = 1) -> dict:
    job_id = new_id("j")
    record = {
        "id": job_id, "kind": kind, "image_count": int(image_count),
        "title": title or prompt[:24], "prompt": prompt,
        "duration_s": int(duration_s), "aspect": aspect,
        "first_frame_asset_id": first_frame_asset_id,
        "last_frame_asset_id": last_frame_asset_id,
        "source_asset_id": source_asset_id,
        "params": json.dumps(params or {}, ensure_ascii=False),
        "conversation_id": conversation_id,
        "feishu_target": feishu_target,
        "status": "queued", "stage": "排队中", "progress": 0.0,
        "created_at": now(),
    }
    with _LOCK, _conn() as conn:
        conn.execute(
            "INSERT INTO jobs (id, kind, image_count, title, prompt, "
            "duration_s, aspect, first_frame_asset_id, last_frame_asset_id, "
            "source_asset_id, params, conversation_id, feishu_target, status, "
            "stage, progress, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (record["id"], record["kind"], record["image_count"],
             record["title"], record["prompt"], record["duration_s"],
             record["aspect"], record["first_frame_asset_id"],
             record["last_frame_asset_id"], record["source_asset_id"],
             record["params"], record["conversation_id"], record["feishu_target"],
             record["status"],
             record["stage"], record["progress"], record["created_at"]))
    return record


def update_job(job_id: str, **fields: Any) -> Optional[dict]:
    fields = {k: v for k, v in fields.items() if k in _JOB_FIELDS}
    if not fields:
        return get_job(job_id)
    sets = ", ".join(f"{k}=?" for k in fields)
    with _LOCK, _conn() as conn:
        conn.execute(f"UPDATE jobs SET {sets} WHERE id=?",
                     [*fields.values(), job_id])
    return get_job(job_id)


def get_job(job_id: str) -> Optional[dict]:
    with _LOCK, _conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    return _row(row)


def list_jobs(limit: int = 30, statuses: Optional[list[str]] = None) -> list[dict]:
    sql = "SELECT * FROM jobs"
    args: list[Any] = []
    if statuses:
        marks = ", ".join("?" for _ in statuses)
        sql += f" WHERE status IN ({marks})"
        args.extend(statuses)
    sql += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)
    with _LOCK, _conn() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


def job_counts() -> dict:
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").fetchall()
    counts = {r["status"]: r["n"] for r in rows}
    for key in ("queued", "running", "succeeded", "failed", "cancelled"):
        counts.setdefault(key, 0)
    return counts


# --------------------------------------------------------- conversations --

def create_conversation(title: str = "") -> dict:
    conv_id = new_id("c")
    ts = now()
    with _LOCK, _conn() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, checklist, proposal, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (conv_id, title, "", "", ts, ts))
    return {"id": conv_id, "title": title, "checklist": "", "proposal": "",
            "created_at": ts, "updated_at": ts}


_CONV_FIELDS = ("title", "checklist", "proposal", "updated_at")


def update_conversation(conv_id: str, **fields: Any) -> Optional[dict]:
    fields = {k: v for k, v in fields.items() if k in _CONV_FIELDS}
    if not fields:
        return get_conversation(conv_id)
    sets = ", ".join(f"{k}=?" for k in fields)
    with _LOCK, _conn() as conn:
        conn.execute(f"UPDATE conversations SET {sets} WHERE id=?",
                     [*fields.values(), conv_id])
    return get_conversation(conv_id)


def get_conversation(conv_id: str) -> Optional[dict]:
    with _LOCK, _conn() as conn:
        row = conn.execute("SELECT * FROM conversations WHERE id=?",
                           (conv_id,)).fetchone()
    return _row(row)


def list_conversations(limit: int = 50) -> list[dict]:
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            "SELECT c.*, (SELECT COUNT(*) FROM messages m "
            " WHERE m.conversation_id = c.id) AS message_count, "
            "(SELECT content FROM messages m WHERE m.conversation_id = c.id "
            " ORDER BY created_at DESC LIMIT 1) AS last_message "
            "FROM conversations c WHERE EXISTS "
            "(SELECT 1 FROM messages m WHERE m.conversation_id = c.id) "
            "ORDER BY c.updated_at DESC LIMIT ?",
            (limit,)).fetchall()
    return [dict(r) for r in rows]


def delete_conversation(conv_id: str) -> bool:
    with _LOCK, _conn() as conn:
        cur = conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
        conn.execute("DELETE FROM messages WHERE conversation_id=?", (conv_id,))
    return bool(cur.rowcount)


def add_message(conversation_id: str, role: str, content: str = "",
                job_id: str = "", asset_id: str = "",
                skills: str = "") -> dict:
    record = {"id": new_id("m"), "conversation_id": conversation_id,
              "role": role, "content": content, "job_id": job_id,
              "asset_id": asset_id, "skills": skills, "created_at": now()}
    with _LOCK, _conn() as conn:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, "
            "job_id, asset_id, skills, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (record["id"], conversation_id, role, content, job_id,
             asset_id, skills, record["created_at"]))
        conn.execute("UPDATE conversations SET updated_at=? WHERE id=?",
                     (record["created_at"], conversation_id))
    return record


def list_messages(conversation_id: str, limit: int = 200) -> list[dict]:
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? "
            "ORDER BY created_at ASC, id ASC LIMIT ?",
            (conversation_id, limit)).fetchall()
    return [dict(r) for r in rows]


def requeue_interrupted() -> list[str]:
    """Jobs left `running` by a crash go back to the queue at startup."""
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            "SELECT id FROM jobs WHERE status IN ('running','queued') "
            "ORDER BY created_at").fetchall()
        conn.execute(
            "UPDATE jobs SET status='queued', stage='排队中', progress=0, "
            "cancel_requested=0 WHERE status='running'")
    return [r["id"] for r in rows]


def active_job() -> Optional[dict]:
    with _LOCK, _conn() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE status IN ('running','queued') "
            "ORDER BY created_at LIMIT 1").fetchone()
    return _row(row)
