# FastAPI app: chat + generation jobs + digital-asset library, served on :5100.
from __future__ import annotations

import mimetypes
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import json
import shutil
import subprocess
import tempfile

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import (agent, asset_sync, comfy, config, feishu, image_model, qc,
               skills as skills_mod, store, worker)

STATIC_DIR = Path(__file__).resolve().parent / "static"
_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
                "image/gif": ".gif"}


class ChatRequest(BaseModel):
    conversation_id: str = ""
    content: str = ""
    attachment_asset_id: str = ""
    last_frame_asset_id: str = ""
    reference_note: str = ""
    feishu_target: str = ""
    skills: list[str] = []
    messages: list[dict] = []   # legacy clients: last user message is used


class JobCreate(BaseModel):
    title: str = ""
    prompt: str
    duration_s: int = config.DURATION_DEFAULT
    aspect: str = "16:9"
    first_frame_asset_id: str = ""
    last_frame_asset_id: str = ""
    conversation_id: str = ""


class FrameRequest(BaseModel):
    position: str = "first"   # first | last | middle | <seconds>
    conversation_id: str = ""


class EditRequest(BaseModel):
    asset_id: str
    prompt: str = ""
    steps: int = 30
    conversation_id: str = ""


class HypitRequest(BaseModel):
    name: str
    title: str = ""
    conversation_id: str = ""


class PostRequest(BaseModel):
    asset_id: str
    narration_text: str = ""
    voice: str = config.TTS_VOICE
    bgm_gain: float = 0.15
    burn_subs: bool = True
    conversation_id: str = ""


class ImageCreate(BaseModel):
    prompt: str
    title: str = ""
    count: int = config.IMAGE_COUNT_DEFAULT
    aspect: str = "16:9"
    conversation_id: str = ""


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.init_db()
    worker.start_worker()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Xpark Digital Asset Generation Pipeline",
                  lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    # ------------------------------------------------------------ pages --
    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(
            STATIC_DIR / "index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate",
                     "Pragma": "no-cache", "Expires": "0"})

    # ----------------------------------------------------------- status --
    @app.get("/api/skills")
    def list_skills() -> dict:
        return {"skills": skills_mod.list_skills(),
                "dir": str(skills_mod.SKILLS_DIR)}

    @app.get("/api/status")
    def status() -> dict:
        stats = comfy.ping()
        gpu = ""
        devices = (stats or {}).get("devices") or []
        if devices:
            gpu = devices[0].get("name") or ""
        qwen = image_model.status()
        return {"online": stats is not None, "gpu": gpu,
                "queue": comfy.queue_state() if stats else {"running": 0, "pending": 0},
                "qwen": {"online": qwen is not None,
                         "loaded": bool(qwen and qwen.get("loaded"))},
                "active_job_id": (store.active_job() or {}).get("id", "")}

    # ------------------------------------------------------------- chat --
    @app.post("/api/chat")
    def chat_turn(body: ChatRequest) -> dict:
        content = body.content.strip()
        if not content and body.messages:
            for m in reversed(body.messages):
                if m.get("role") == "user" and str(m.get("content") or "").strip():
                    content = str(m["content"]).strip()
                    break
        attachment = store.get_asset(body.attachment_asset_id) \
            if body.attachment_asset_id else None
        if not content and not attachment:
            raise HTTPException(422, "content 不能为空")
        conv = store.get_conversation(body.conversation_id) \
            if body.conversation_id else None
        if not conv:
            conv = store.create_conversation()
        conv_id = conv["id"]
        used_skills: list[tuple[str, str]] = []
        for name in (body.skills or [])[:skills_mod.MAX_SKILLS_PER_TURN]:
            loaded = skills_mod.load_skill(name)
            if loaded:
                used_skills.append(loaded)
        store.add_message(conv_id, "user", content or "（附了一张参考图）",
                          asset_id=attachment["id"] if attachment else "",
                          skills=json.dumps([n for n, _ in used_skills],
                                            ensure_ascii=False) if used_skills else "")
        if not (conv.get("title") or "") and content:
            store.update_conversation(conv_id, title=content[:24])
        history = [{"role": m["role"], "content": m["content"]}
                   for m in store.list_messages(conv_id, limit=20)]
        result = agent.run_chat(history, attachment=attachment,
                                note=body.reference_note[:400],
                                skills=used_skills)
        job = None
        proposal = result.get("proposal")
        if proposal and result.get("image_intent"):
            job = _create_image_job(
                title=proposal["title"],
                prompt=proposal.get("image_prompt") or proposal["summary"],
                count=config.IMAGE_COUNT_DEFAULT, aspect=proposal["aspect"],
                conversation_id=conv_id, feishu_target=body.feishu_target)
            result["reply"] = result["reply"].rstrip("。") + \
                f"。已先排 {job['image_count']} 张参考图（Qwen-Image 2.1），" \
                "完成后挑一张就能出片。"
        elif proposal and result.get("start_intent"):
            job = _create_job(
                title=proposal["title"], prompt=proposal["prompt"],
                duration_s=proposal["duration_s"], aspect=proposal["aspect"],
                first_frame_asset_id=body.attachment_asset_id,
                last_frame_asset_id=body.last_frame_asset_id,
                conversation_id=conv_id, feishu_target=body.feishu_target)
            result["reply"] = result["reply"].rstrip("。") + \
                f"。已提交生成《{job['title']}》,进度在对话里实时更新。"
            result["checklist"]["duration"] = f"{proposal['duration_s']} 秒"
            result["checklist"]["aspect"] = proposal["aspect"]
            proposal = None
        store.update_conversation(
            conv_id,
            checklist=json.dumps(result["checklist"], ensure_ascii=False),
            proposal=json.dumps(proposal, ensure_ascii=False) if proposal else "")
        store.add_message(conv_id, "assistant", result["reply"],
                          job_id=job["id"] if job else "")
        return {"conversation_id": conv_id, "reply": result["reply"],
                "checklist": result["checklist"], "proposal": proposal,
                "job": job}

    # ---------------------------------------------------- conversations --
    @app.get("/api/conversations")
    def list_conversations() -> dict:
        return {"conversations": [
            {"id": c["id"], "title": c.get("title") or "未命名对话",
             "message_count": c.get("message_count", 0),
             "last_message": (c.get("last_message") or "")[:60],
             "created_at": c["created_at"], "updated_at": c["updated_at"]}
            for c in store.list_conversations(limit=50)]}

    @app.get("/api/conversations/{conv_id}")
    def get_conversation(conv_id: str) -> dict:
        conv = store.get_conversation(conv_id)
        if not conv:
            raise HTTPException(404, "conversation not found")
        messages = []
        for m in store.list_messages(conv_id):
            item = {"id": m["id"], "role": m["role"], "content": m["content"],
                    "job_id": m["job_id"], "created_at": m["created_at"],
                    "skills": json.loads(m["skills"]) if m.get("skills") else []}
            if m["asset_id"]:
                asset = store.get_asset(m["asset_id"])
                if asset:
                    item["asset"] = {
                        "id": asset["id"], "title": asset["title"],
                        "kind": asset["kind"],
                        "file_url": f"/api/assets/{asset['id']}/file"}
            messages.append(item)
        return {"conversation": {
                    "id": conv["id"], "title": conv["title"],
                    "checklist": json.loads(conv["checklist"] or "{}"),
                    "proposal": json.loads(conv["proposal"] or "null"),
                    "created_at": conv["created_at"],
                    "updated_at": conv["updated_at"]},
                "messages": messages}

    @app.delete("/api/conversations/{conv_id}")
    def delete_conversation(conv_id: str) -> dict:
        if not store.get_conversation(conv_id):
            raise HTTPException(404, "conversation not found")
        return {"ok": store.delete_conversation(conv_id)}

    # ------------------------------------------------------------- jobs --
    def _log_conv_job(conv_id: str, job: dict, content: str) -> None:
        """Persist a job-card message so it survives page reloads."""
        if conv_id and store.get_conversation(conv_id):
            store.add_message(conv_id, "assistant", content, job_id=job["id"])

    def _create_job(*, title: str, prompt: str, duration_s: int, aspect: str,
                    first_frame_asset_id: str = "",
                    last_frame_asset_id: str = "",
                    conversation_id: str = "",
                    feishu_target: str = "") -> dict:
        if not prompt.strip():
            raise HTTPException(422, "prompt 不能为空")
        duration = max(config.DURATION_MIN,
                       min(config.DURATION_MAX, int(duration_s or config.DURATION_DEFAULT)))
        if aspect not in config.ASPECTS:
            aspect = "16:9"
        if first_frame_asset_id and not store.get_asset(first_frame_asset_id):
            first_frame_asset_id = ""
        if last_frame_asset_id and not store.get_asset(last_frame_asset_id):
            last_frame_asset_id = ""
        job = store.create_job(prompt=prompt.strip(), title=title.strip()[:40],
                               duration_s=duration, aspect=aspect,
                               first_frame_asset_id=first_frame_asset_id,
                               last_frame_asset_id=last_frame_asset_id,
                               conversation_id=conversation_id.strip(),
                               feishu_target=feishu_target.strip())
        worker.enqueue(job["id"])
        return job

    def _create_image_job(*, title: str, prompt: str, count: int,
                          aspect: str, conversation_id: str = "",
                          feishu_target: str = "") -> dict:
        if not prompt.strip():
            raise HTTPException(422, "prompt 不能为空")
        if aspect not in config.ASPECTS:
            aspect = "16:9"
        count = max(1, min(config.IMAGE_COUNT_MAX, int(count or 1)))
        job = store.create_job(prompt=prompt.strip(), title=title.strip()[:40],
                               duration_s=0, aspect=aspect, kind="image",
                               image_count=count,
                               conversation_id=conversation_id.strip(),
                               feishu_target=feishu_target.strip())
        worker.enqueue(job["id"])
        return job

    @app.post("/api/jobs", status_code=201)
    def create_job(body: JobCreate) -> dict:
        job = _create_job(title=body.title, prompt=body.prompt,
                          duration_s=body.duration_s, aspect=body.aspect,
                          first_frame_asset_id=body.first_frame_asset_id,
                          last_frame_asset_id=body.last_frame_asset_id,
                          conversation_id=body.conversation_id)
        if body.conversation_id and store.get_conversation(body.conversation_id):
            store.update_conversation(body.conversation_id, proposal="")
        _log_conv_job(body.conversation_id, job,
                      f"已提交生成《{job['title']}》，渲染约 5~15 分钟，完成后自动入库。")
        return job

    @app.post("/api/images", status_code=201)
    def create_image_job(body: ImageCreate) -> dict:
        job = _create_image_job(title=body.title, prompt=body.prompt,
                                count=body.count, aspect=body.aspect,
                                conversation_id=body.conversation_id)
        _log_conv_job(body.conversation_id, job,
                      f"已先排 {job['image_count']} 张参考图（Qwen-Image 2.1），"
                      "完成后挑一张就能出片。")
        return job

    # ------------------------------------------- repair / long-form / post --
    EDIT_PROMPT_DEFAULT = (
        "保持原图构图、人物、风格与配色不变，把画面中的文字改为正确、清晰的简体中文；"
        "删除所有水印、logo、角标；不要新增文字，不要改变画面内容。")

    def _create_edit_job(*, asset_id: str, prompt: str, steps: int = 30,
                         conversation_id: str = "") -> dict:
        asset = store.get_asset(asset_id)
        if not asset or asset["kind"] != "image":
            raise HTTPException(422, "需要一张图片资产")
        job = store.create_job(
            prompt=(prompt or EDIT_PROMPT_DEFAULT).strip()[:400],
            title=f"{asset['title']} · 修复", kind="edit",
            source_asset_id=asset_id, params={"steps": steps},
            conversation_id=conversation_id.strip())
        worker.enqueue(job["id"])
        return job

    @app.post("/api/images/edit", status_code=201)
    def create_edit_job(body: EditRequest) -> dict:
        job = _create_edit_job(asset_id=body.asset_id, prompt=body.prompt,
                               steps=body.steps,
                               conversation_id=body.conversation_id)
        _log_conv_job(body.conversation_id, job,
                      f"已提交参考图修复《{job['title']}》，完成后自动入库。")
        return job

    @app.get("/api/hypit/projects")
    def hypit_projects() -> dict:
        root = Path(config.HYPIT_PROJECT)
        projects = []
        if root.exists():
            for f in sorted(root.glob("*.svrun"), key=lambda p: -p.stat().st_mtime):
                projects.append({"name": f.name, "stem": f.stem,
                                 "updated_at": f.stat().st_mtime})
        return {"projects": projects[:100], "project_dir": str(root)}

    def _create_hypit_job(*, name: str, title: str,
                          conversation_id: str = "") -> dict:
        name = (name or "").strip()
        if not name:
            raise HTTPException(422, "name 不能为空")
        if not (Path(config.HYPIT_PROJECT) /
                (name if name.endswith(".svrun") else name + ".svrun")).exists():
            raise HTTPException(404, f"找不到 run 文件: {name}")
        job = store.create_job(prompt=name, title=(title or name)[:40],
                               duration_s=0, kind="hypit",
                               conversation_id=conversation_id.strip())
        worker.enqueue(job["id"])
        return job

    @app.post("/api/hypit/build", status_code=201)
    def create_hypit_job(body: HypitRequest) -> dict:
        job = _create_hypit_job(name=body.name, title=body.title,
                                conversation_id=body.conversation_id)
        _log_conv_job(body.conversation_id, job,
                      f"已提交讲解片《{job['title']}》构建（hypit），约 30 分钟起。")
        return job

    def _create_post_job(*, asset_id: str, narration: str, voice: str,
                         bgm_gain: float, burn_subs: bool,
                         conversation_id: str = "") -> dict:
        asset = store.get_asset(asset_id)
        if not asset or asset["kind"] != "video":
            raise HTTPException(422, "需要一个视频资产")
        narration = (narration or "").strip()
        bgm_gain = max(0.0, min(1.0, float(bgm_gain)))
        if not narration and bgm_gain >= 1.0:
            raise HTTPException(422, "至少填写旁白文本或调低 BGM 音量")
        job = store.create_job(
            prompt=narration[:2000], title=f"{asset['title']} · 后期",
            duration_s=0, kind="post", source_asset_id=asset_id,
            params={"voice": voice, "bgm_gain": bgm_gain,
                    "burn_subs": bool(burn_subs)},
            conversation_id=conversation_id.strip())
        worker.enqueue(job["id"])
        return job

    @app.post("/api/post", status_code=201)
    def create_post_job(body: PostRequest) -> dict:
        job = _create_post_job(asset_id=body.asset_id,
                               narration=body.narration_text,
                               voice=body.voice, bgm_gain=body.bgm_gain,
                               burn_subs=body.burn_subs,
                               conversation_id=body.conversation_id)
        _log_conv_job(body.conversation_id, job,
                      f"已提交后期任务《{job['title']}》（旁白/字幕/BGM），完成后自动入库。")
        return job

    @app.get("/api/jobs")
    def list_jobs(limit: int = 30, status: str = "") -> dict:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        return {"jobs": store.list_jobs(limit=min(limit, 200),
                                        statuses=statuses or None),
                "counts": store.job_counts()}

    @app.post("/api/jobs/{job_id}/retry", status_code=201)
    def retry_job(job_id: str) -> dict:
        job = store.get_job(job_id)
        if not job:
            raise HTTPException(404, "job not found")
        if job["status"] not in ("failed", "cancelled"):
            raise HTTPException(409, "只能重试失败或已取消的任务")
        kind = job.get("kind") or "video"
        params = {}
        try:
            params = json.loads(job.get("params") or "{}")
        except ValueError:
            pass
        if kind == "image":
            return _create_image_job(
                title=job["title"], prompt=job["prompt"],
                count=job.get("image_count") or 1, aspect=job["aspect"],
                conversation_id=job.get("conversation_id") or "")
        if kind == "edit":
            return _create_edit_job(asset_id=job.get("source_asset_id") or "",
                                    prompt=job["prompt"],
                                    steps=int(params.get("steps") or 30),
                                    conversation_id=job.get("conversation_id") or "")
        if kind == "hypit":
            return _create_hypit_job(name=job["prompt"], title=job["title"],
                                     conversation_id=job.get("conversation_id") or "")
        if kind == "post":
            return _create_post_job(
                asset_id=job.get("source_asset_id") or "",
                narration=job["prompt"], voice=params.get("voice") or config.TTS_VOICE,
                bgm_gain=float(params.get("bgm_gain", 0.15)),
                burn_subs=bool(params.get("burn_subs", True)),
                conversation_id=job.get("conversation_id") or "")
        return _create_job(
            title=job["title"], prompt=job["prompt"],
            duration_s=job["duration_s"], aspect=job["aspect"],
            first_frame_asset_id=job.get("first_frame_asset_id") or "",
            last_frame_asset_id=job.get("last_frame_asset_id") or "",
            conversation_id=job.get("conversation_id") or "")

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        job = store.get_job(job_id)
        if not job:
            raise HTTPException(404, "job not found")
        return job

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict:
        job = store.get_job(job_id)
        if not job:
            raise HTTPException(404, "job not found")
        if job["status"] in ("succeeded", "failed", "cancelled"):
            return job
        if job["status"] == "queued":
            store.update_job(job_id, status="cancelled", stage="已取消",
                             finished_at=store.now())
        else:
            store.update_job(job_id, cancel_requested=1, stage="正在停止…")
            if job.get("comfy_prompt_id"):
                comfy.cancel_prompt(job["comfy_prompt_id"])
        return store.get_job(job_id)

    # ----------------------------------------------------------- assets --
    @app.get("/api/assets")
    def list_assets(kind: Optional[str] = None,
                    conversation_id: Optional[str] = None,
                    order: str = "desc", limit: int = 50,
                    offset: int = 0) -> dict:
        if kind not in (None, "image", "video"):
            raise HTTPException(422, "kind 必须是 image 或 video")
        limit = max(1, min(limit, 100))
        offset = max(0, offset)
        return {
            "assets": [_asset_out(a) for a in store.list_assets(
                kind, limit=limit, offset=offset,
                conversation_id=conversation_id, order=order)],
            "total": store.count_assets(kind, conversation_id),
            "kind": kind or "all",
            "limit": limit,
            "offset": offset,
        }

    @app.get("/api/assets/sources")
    def asset_sources() -> dict:
        return asset_sync.summary()

    def _asset_out(asset: dict) -> dict:
        return {
            "id": asset["id"], "kind": asset["kind"], "title": asset["title"],
            "prompt": asset["prompt"], "source": asset["source"],
            "job_id": asset["job_id"], "duration_s": asset["duration_s"],
            "width": asset["width"], "height": asset["height"],
            "size_bytes": asset["size_bytes"], "created_at": asset["created_at"],
            "conversation_id": asset.get("conversation_id") or "",
            "external": bool(asset.get("origin_path")),
            "qc": json.loads(asset["qc"]) if asset.get("qc") else None,
            "has_poster": bool(asset["poster"]),
            "file_url": f"/api/assets/{asset['id']}/file",
            "poster_url": f"/api/assets/{asset['id']}/poster" if asset["poster"] else "",
        }

    @app.get("/api/assets/{asset_id}")
    def get_asset(asset_id: str) -> dict:
        asset = store.get_asset(asset_id)
        if not asset:
            raise HTTPException(404, "asset not found")
        return _asset_out(asset)

    @app.post("/api/assets/upload", status_code=201)
    async def upload_asset(file: UploadFile,
                           conversation_id: str = Form("")) -> dict:
        data = await file.read()
        if not data:
            raise HTTPException(422, "空文件")
        if len(data) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(413, "文件超过 40MB")
        ctype = (file.content_type or "").split(";")[0].strip().lower()
        ext = _IMAGE_TYPES.get(ctype) or Path(file.filename or "").suffix.lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            raise HTTPException(415, "只支持图片上传(png/jpg/webp/gif)")
        if ext == ".jpeg":
            ext = ".jpg"
        filename = f"ref-{store.new_id('u')[-8:]}{ext}"
        asset = store.create_asset(kind="image", filename=filename,
                                   title=Path(file.filename or "参考图").stem[:40],
                                   source="uploaded", data=data,
                                   size_bytes=len(data),
                                   conversation_id=conversation_id.strip())
        return _asset_out(asset)

    @app.get("/api/assets/{asset_id}/file")
    def asset_file(asset_id: str, request: Request) -> Response:
        asset = store.get_asset(asset_id)
        if not asset:
            raise HTTPException(404, "asset not found")
        path = store.asset_file_path(asset)
        if not path.exists():
            raise HTTPException(404, "file missing")
        return _range_response(request, path, _mime(asset))

    @app.post("/api/assets/{asset_id}/frame", status_code=201)
    def extract_frame(asset_id: str, body: FrameRequest) -> dict:
        """Grab a reference frame out of a video (for video-based remakes)."""
        asset = store.get_asset(asset_id)
        if not asset:
            raise HTTPException(404, "asset not found")
        if asset["kind"] != "video":
            raise HTTPException(422, "只有视频支持抽帧")
        path = store.asset_file_path(asset)
        if not path.exists():
            raise HTTPException(404, "file missing")
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise HTTPException(500, "ffmpeg 不可用")
        duration = float(asset.get("duration_s") or 0)
        pos = (body.position or "first").strip().lower()
        if pos == "first":
            ts = 0.05
        elif pos == "last":
            ts = max(0.0, duration - 0.15)
        elif pos == "middle":
            ts = duration / 2 if duration > 0.4 else 0.1
        else:
            try:
                ts = max(0.0, float(pos))
            except ValueError:
                ts = 0.05
        label = {"first": "首帧", "last": "尾帧", "middle": "中间帧"}.get(
            pos, f"{ts:.1f}s 帧")
        filename = f"frame-{store.new_id('f')[-8:]}.png"
        with tempfile.TemporaryDirectory() as td:
            out = f"{td}/{filename}"
            subprocess.run(
                [ffmpeg, "-y", "-v", "error", "-ss", f"{ts:.3f}",
                 "-i", str(path), "-frames:v", "1", out],
                capture_output=True, timeout=120, check=True)
            frame_asset = store.create_asset(
                kind="image", filename=filename,
                title=f"{asset['title']} · {label}",
                prompt=f"参考帧（来自视频《{asset['title']}》）",
                source="derived", src_path=out,
                width=asset.get("width") or 0, height=asset.get("height") or 0,
                conversation_id=body.conversation_id.strip())
        return _asset_out(frame_asset)

    @app.get("/api/assets/{asset_id}/poster")
    def asset_poster(asset_id: str) -> Response:
        asset = store.get_asset(asset_id)
        path = store.poster_path(asset) if asset else None
        if not path or not path.exists():
            raise HTTPException(404, "no poster")
        return FileResponse(path, media_type="image/jpeg")

    @app.post("/api/assets/sync")
    def asset_sync_run() -> dict:
        return asset_sync.scan(dry_run=False)

    @app.post("/api/assets/{asset_id}/qc")
    def run_asset_qc(asset_id: str) -> dict:
        asset = store.get_asset(asset_id)
        if not asset:
            raise HTTPException(404, "asset not found")
        if not qc.enabled():
            raise HTTPException(409, "质检未启用（VA_QC_ENABLED / VA_QC_BASE）")
        path = store.asset_file_path(asset)
        if not path.exists():
            raise HTTPException(404, "file missing")
        try:
            result = (qc.check_video(path) if asset["kind"] == "video"
                      else qc.check_image(path))
        except Exception as exc:
            raise HTTPException(500, f"质检失败: {exc}"[:300])
        store.update_asset(asset_id, qc=json.dumps(result, ensure_ascii=False))
        return {"ok": True, "qc": result}

    @app.post("/api/assets/{asset_id}/feishu")
    def send_asset_feishu(asset_id: str) -> dict:
        asset = store.get_asset(asset_id)
        if not asset:
            raise HTTPException(404, "asset not found")
        if not feishu.enabled():
            raise HTTPException(409, "飞书推送未启用（检查 VA_FEISHU_ENABLED / VA_FEISHU_TARGET）")
        try:
            feishu.send_asset(asset)
        except Exception as exc:
            raise HTTPException(500, f"飞书发送失败: {exc}"[:300])
        return {"ok": True, "target": config.FEISHU_TARGET}

    @app.delete("/api/assets/{asset_id}")
    def delete_asset(asset_id: str) -> dict:
        if not store.get_asset(asset_id):
            raise HTTPException(404, "asset not found")
        result = store.delete_asset(asset_id)
        return {"ok": result["deleted"],
                "origin_deleted": result["origin_deleted"],
                "origin": result["origin"]}

    return app


def _mime(asset: dict) -> str:
    if asset["kind"] == "video":
        return mimetypes.guess_type(asset["filename"])[0] or "video/mp4"
    return mimetypes.guess_type(asset["filename"])[0] or "application/octet-stream"


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _range_response(request: Request, path: Path, media_type: str,
                    chunk_size: int = 1024 * 512) -> Response:
    """File response with HTTP Range support (video seeking)."""
    size = path.stat().st_size
    range_header = request.headers.get("range", "")
    match = _RANGE_RE.match(range_header) if range_header else None
    if not match:
        return StreamingResponse(_file_iter(path, 0, size - 1, chunk_size),
                                 media_type=media_type,
                                 headers={"Content-Length": str(size),
                                          "Accept-Ranges": "bytes"})
    start = int(match.group(1)) if match.group(1) else 0
    end = int(match.group(2)) if match.group(2) else size - 1
    end = min(end, size - 1)
    if start > end or start >= size:
        return Response(status_code=416,
                        headers={"Content-Range": f"bytes */{size}"})
    length = end - start + 1
    return StreamingResponse(
        _file_iter(path, start, end, chunk_size), status_code=206,
        media_type=media_type,
        headers={"Content-Range": f"bytes {start}-{end}/{size}",
                 "Content-Length": str(length), "Accept-Ranges": "bytes"})


def _file_iter(path: Path, start: int, end: int, chunk_size: int):
    with open(path, "rb") as fh:
        fh.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = fh.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
