# Xpark digital asset pipeline — runtime configuration (env-overridable, secrets in .env).
from __future__ import annotations

import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and not os.environ.get(key):
            os.environ[key] = value.strip().strip('"').strip("'")


def _env_json(name: str) -> dict:
    try:
        value = json.loads(os.environ.get(name, "{}"))
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = json.loads(raw)
        return [str(v) for v in value] if isinstance(value, list) else default
    except ValueError:
        return [p.strip() for p in raw.replace(",", ":").split(":") if p.strip()]


_load_dotenv(BASE_DIR / ".env")

HOST = os.environ.get("VA_HOST", "0.0.0.0")
PORT = int(os.environ.get("VA_PORT", "5100"))

DATA_DIR = Path(os.environ.get("VA_DATA_DIR", BASE_DIR / "data"))
ASSET_DIR = Path(os.environ.get("VA_ASSET_DIR", DATA_DIR / "assets"))
DB_PATH = Path(os.environ.get("VA_DB", DATA_DIR / "video_agent.db"))

WORKFLOWS_DIR = Path(os.environ.get("VA_WORKFLOWS_DIR", BASE_DIR / "workflows"))
H3_T2V_WORKFLOW = WORKFLOWS_DIR / "h3_t2v.api.json"

COMFY_BASE = os.environ.get("VA_COMFY_BASE", "http://127.0.0.1:8188").rstrip("/")
RENDER_TIMEOUT_S = int(os.environ.get("VA_RENDER_TIMEOUT", "7200"))

# Qwen-Image 2.1 reference-image service (host-side, port 8601).
QWEN_IMAGE_URL = os.environ.get("VA_QWEN_IMAGE_URL", "http://127.0.0.1:8601").rstrip("/")
QWEN_TIMEOUT_S = float(os.environ.get("VA_QWEN_TIMEOUT", "1800"))
IMAGE_STEPS = int(os.environ.get("VA_IMAGE_STEPS", "20"))
IMAGE_COUNT_DEFAULT = int(os.environ.get("VA_IMAGE_COUNT", "4"))
IMAGE_COUNT_MAX = 6
IMAGE_SIZES: dict[str, tuple[int, int]] = {
    "16:9": (1024, 576),
    "9:16": (576, 1024),
    "1:1": (768, 768),
}

# Text model (OpenAI-compatible). Defaults to the local opencode-go gateway.
TEXT_BASE = os.environ.get("VA_TEXT_BASE", "http://127.0.0.1:11434/v1").rstrip("/")
TEXT_MODEL = os.environ.get("VA_TEXT_MODEL", "gemma3:4b")
TEXT_API_KEY = os.environ.get("VA_TEXT_API_KEY", "")
TEXT_HEADERS = _env_json("VA_TEXT_HEADERS")
TEXT_TIMEOUT_S = float(os.environ.get("VA_TEXT_TIMEOUT", "300"))

# Chat-visible skills: keep only creation/aesthetics ones (set VA_SKILLS_ALLOW=all to expose everything).
DEFAULT_SKILLS_ALLOW = [
    "hypit", "hypit-comfyui-video", "sound-director", "feishu-doc-glass-video",
    "color-expert", "theme-factory", "design-review", "frontend-design",
    "hallmark", "impeccable-design-polish",
]
SKILLS_ALLOW = _env_list("VA_SKILLS_ALLOW", DEFAULT_SKILLS_ALLOW)

# Automated QC after generation (local vision model, OpenAI-compatible).
QC_ENABLED = os.environ.get("VA_QC_ENABLED", "1") == "1"
QC_BASE = os.environ.get("VA_QC_BASE", "http://172.18.0.2:11434/v1").rstrip("/")
QC_MODEL = os.environ.get("VA_QC_MODEL", "gemma3:4b")
QC_API_KEY = os.environ.get("VA_QC_API_KEY", "")
QC_TIMEOUT_S = float(os.environ.get("VA_QC_TIMEOUT", "180"))

# Unified external asset registry: directories scanned by the sync tool.
DEFAULT_ASSET_SOURCES = [
    "/srv/projects",
]
ASSET_SOURCES = _env_list("VA_ASSET_SOURCES", DEFAULT_ASSET_SOURCES)
ASSET_EXTENSIONS = (".mp4", ".mov", ".webm", ".png", ".jpg", ".jpeg", ".webp")

# Narration TTS (edge-tts) and hypit long-form integration.
TTS_PYTHON = os.environ.get("VA_TTS_PYTHON", "/root/.local/ttsvenv/bin/python")
TTS_VOICE = os.environ.get("VA_TTS_VOICE", "zh-CN-YunyangNeural")
TTS_VOICES = ("zh-CN-YunyangNeural", "zh-CN-XiaoxiaoNeural",
              "zh-CN-YunxiNeural", "zh-CN-XiaoyiNeural")
HYPIT_PROJECT = os.environ.get("VA_HYPIT_PROJECT",
                               "/srv/projects/default/hypit-comfyui")
HYPIT_CLI = os.environ.get("VA_HYPIT_CLI",
                           f"{HYPIT_PROJECT}/node_modules/.bin/hypit")
HYPIT_TIMEOUT_S = int(os.environ.get("VA_HYPIT_TIMEOUT", str(6 * 3600)))
NODE_BIN = os.environ.get("VA_NODE_BIN", "/root/.nvm/versions/node/v26.4.0/bin")

# Feishu delivery / trigger (lark-cli). Empty target disables notifications.
FEISHU_ENABLED = os.environ.get("VA_FEISHU_ENABLED", "0") == "1"
FEISHU_TARGET = os.environ.get("VA_FEISHU_TARGET", "").strip()
FEISHU_CHAT = os.environ.get("VA_FEISHU_CHAT", "").strip()
FEISHU_EXTRA_CHATS = _env_list("VA_FEISHU_EXTRA_CHATS", [])
LARK_CLI = os.environ.get("VA_LARK_CLI", "").strip()

# opencode DM bridge (scripts/opencode_bridge.py): P2P chat -> general agent.
OPENCODE_CHAT = os.environ.get("VA_OPENCODE_CHAT", "").strip()
OPENCODE_BIN = os.environ.get("VA_OPENCODE_BIN", "/root/.opencode/bin/opencode")
OPENCODE_MODEL = os.environ.get("VA_OPENCODE_MODEL", "").strip()
OPENCODE_VARIANT = os.environ.get("VA_OPENCODE_VARIANT", "").strip()
OPENCODE_DIR = os.environ.get("VA_OPENCODE_DIR", "/root")
OPENCODE_TIMEOUT_S = int(os.environ.get("VA_OPENCODE_TIMEOUT", "1800"))

# MiniMax H3 generation envelope (24 fps, frame grid 17k+5, trained 124-362).
FPS = 24
DURATION_MIN, DURATION_MAX, DURATION_DEFAULT = 5, 15, 5
ASPECTS: dict[str, tuple[int, int]] = {
    "16:9": (1344, 768),
    "9:16": (768, 1344),
    "1:1": (1024, 1024),
}
FRAMES_MIN, FRAMES_MAX = 124, 362
MAX_UPLOAD_BYTES = 40 * 1024 * 1024

for d in (DATA_DIR, ASSET_DIR):
    d.mkdir(parents=True, exist_ok=True)
