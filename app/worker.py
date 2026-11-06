# Background render worker: one job at a time (single local GPU).
from __future__ import annotations

import json
import logging
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from . import comfy, config, feishu, store

log = logging.getLogger("video-agent.worker")

_QUEUE: "queue.Queue[str]" = queue.Queue()
_STARTED = threading.Event()


def enqueue(job_id: str) -> None:
    _QUEUE.put(job_id)


def start_worker() -> None:
    if _STARTED.is_set():
        return
    _STARTED.set()
    threading.Thread(target=_loop, name="render-worker", daemon=True).start()


def _loop() -> None:
    for job_id in store.requeue_interrupted():
        _QUEUE.put(job_id)
    while True:
        job_id = _QUEUE.get()
        try:
            _process(job_id)
        except Exception:
            log.exception("job %s crashed", job_id)
        finally:
            _QUEUE.task_done()


def snap_frames(duration_s: int) -> int:
    """Snap seconds to H3's legal frame grid (17k+5), within trained range."""
    target = max(config.FRAMES_MIN, min(config.FRAMES_MAX, duration_s * config.FPS))
    k = round((target - 5) / 17)
    frames = 5 + 17 * k
    return max(config.FRAMES_MIN, min(config.FRAMES_MAX, frames))


def _patch_workflow(job: dict) -> tuple[dict, str]:
    workflow = json.loads(config.H3_T2V_WORKFLOW.read_text(encoding="utf-8"))
    width, height = config.ASPECTS.get(job["aspect"], config.ASPECTS["16:9"])
    seed = int(time.time() * 1000) % (2 ** 31)
    node = workflow["131"]["inputs"]
    node["prompt"] = job["prompt"]
    node["width"] = width
    node["height"] = height
    node["length"] = snap_frames(int(job["duration_s"]))
    workflow["129"]["inputs"]["noise_seed"] = seed
    workflow["92"]["inputs"]["filename_prefix"] = f"video/vagent_{job['id'][-6:]}"

    def wire_frame(asset_id: str, slot: str, node_no: str) -> None:
        asset = store.get_asset(asset_id) if asset_id else None
        if not asset or asset["kind"] != "image":
            return
        data = store.asset_file_path(asset).read_bytes()
        name = comfy.upload_image(data, Path(asset["filename"]).name)
        workflow[node_no] = {"class_type": "LoadImage",
                             "inputs": {"image": name}}
        node[slot] = [node_no, 0]

    wire_frame(job.get("first_frame_asset_id"), "first_frame", "901")
    wire_frame(job.get("last_frame_asset_id"), "last_frame", "902")
    frames = [slot for slot in ("first_frame", "last_frame") if slot in node]
    spec = f"{width}x{height}, {snap_frames(int(job['duration_s']))}帧"
    if frames:
        spec += f", {'+'.join(frames)}"
    return workflow, spec


def _progress_writer(job_id: str, base: float, span: float):
    def on_progress(value: int, maximum: int) -> None:
        pct = base + span * (value / maximum)
        store.update_job(job_id, progress=round(pct, 1),
                         stage=f"渲染中 {value}/{maximum} 步")
    return on_progress


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
        duration = (data.get("format") or {}).get("duration") \
            or stream.get("duration") or 0
        return {"width": int(stream.get("width") or 0),
                "height": int(stream.get("height") or 0),
                "duration_s": float(duration or 0)}
    except Exception:
        return {}


def _extract_poster(video: Path, out: Path) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    try:
        subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-ss", "0.4", "-i", str(video),
             "-frames:v", "1", "-vf", "scale=960:-2", str(out)],
            capture_output=True, timeout=120, check=True)
        return out.exists() and out.stat().st_size > 0
    except Exception:
        return False


def _slug(text: str, fallback: str = "video") -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", text or "").strip("-")
    return (cleaned[:40] or fallback).strip("-") or fallback


def _process(job_id: str) -> None:
    job = store.get_job(job_id)
    if not job or job["status"] != "queued":
        return
    if _cancel_requested(job_id):
        store.update_job(job_id, status="cancelled", stage="已取消",
                         finished_at=store.now())
        return
    kind = job.get("kind") or "video"
    if kind == "image":
        _process_image(job)
    elif kind == "edit":
        _process_edit(job)
    elif kind == "hypit":
        _process_hypit(job)
    elif kind == "post":
        _process_post(job)
    else:
        _process_video(job)


def _qc_asset(asset: dict) -> None:
    """Run the vision QC pass and store the verdict on the asset."""
    from . import qc as qc_mod
    if not qc_mod.enabled():
        return
    try:
        path = store.asset_file_path(asset)
        if not path.exists():
            return
        result = (qc_mod.check_video(path) if asset["kind"] == "video"
                  else qc_mod.check_image(path))
        store.update_asset(asset["id"], qc=json.dumps(result, ensure_ascii=False))
        log.info("qc %s -> %s (%s)", asset["id"], result["verdict"],
                 result.get("note", ""))
    except Exception:
        log.warning("qc failed for %s", asset.get("id"), exc_info=True)


def _job_params(job: dict) -> dict:
    try:
        return json.loads(job.get("params") or "{}")
    except ValueError:
        return {}


def _fail(job_id: str, exc: Exception) -> None:
    log.exception("job %s failed", job_id)
    store.update_job(job_id, status="failed", stage="生成失败",
                     error=str(exc)[:400], finished_at=store.now())
    feishu.notify_job(store.get_job(job_id))


def _process_edit(job: dict) -> None:
    """Qwen-Image image-edit: repair reference text / strip watermarks."""
    from . import image_model

    job_id = job["id"]
    source = store.get_asset(job.get("source_asset_id") or "")
    if not source or source["kind"] != "image":
        _fail(job_id, RuntimeError("源资产不是图片"))
        return
    params = _job_params(job)
    store.update_job(job_id, status="running", stage="修复参考图",
                     started_at=store.now(), progress=5)
    try:
        png, meta = image_model.edit(
            store.asset_file_path(source), job["prompt"],
            steps=params.get("steps"),
            seed=int(time.time() * 1000) % (2 ** 31),
            output_resolution=int(params.get("output_resolution") or 0))
        filename = f"{_slug(job['title'], 'edit')}-edit.png"
        asset = store.create_asset(
            kind="image", filename=filename,
            title=f"{source['title']} · 修复",
            prompt=job["prompt"], source="derived", job_id=job_id,
            width=meta["width"], height=meta["height"], data=png,
            conversation_id=job.get("conversation_id") or "")
        store.update_job(job_id, status="succeeded", stage="已完成",
                         progress=100, asset_id=asset["id"],
                         finished_at=store.now())
        log.info("edit job %s done -> %s", job_id, asset["id"])
        _qc_asset(asset)
        feishu.notify_job(store.get_job(job_id), [asset])
    except Exception as exc:
        _fail(job_id, exc)


def _hypit_env() -> dict:
    env = dict(os.environ)
    env["PATH"] = f"{config.NODE_BIN}:{config.HYPIT_PROJECT}/node_modules/.bin:" \
                  f"{env.get('PATH', '/usr/local/bin:/usr/bin:/bin')}"
    env.setdefault("HOME", "/root")
    return env


def _hypit_json(proc: subprocess.CompletedProcess) -> dict:
    raw = (proc.stdout or "").strip()
    start = raw.find("{")
    if start < 0:
        raise RuntimeError(f"hypit 输出无法解析: {(raw or proc.stderr or '')[:200]}")
    try:
        return json.loads(raw[start:])
    except ValueError:
        # tolerate trailing lines after the JSON object
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(raw[start:i + 1])
        raise


def _process_hypit(job: dict) -> None:
    """Long-form 讲解片: drive `hypit build` on an existing .svrun project."""
    job_id = job["id"]
    name = (job["prompt"] or "").strip()
    if not name.endswith(".svrun"):
        name += ".svrun"
    svrun = Path(config.HYPIT_PROJECT) / name
    if not svrun.exists():
        _fail(job_id, RuntimeError(f"找不到 run 文件: {name}"))
        return
    env = _hypit_env()
    store.update_job(job_id, status="running", stage="校验工程",
                     started_at=store.now(), progress=3)
    try:
        check = subprocess.run(
            [config.HYPIT_CLI, "check", str(svrun)],
            cwd=config.HYPIT_PROJECT, env=env,
            capture_output=True, text=True, timeout=300)
        if check.returncode != 0:
            raise RuntimeError(f"hypit check 失败: {(check.stdout or check.stderr)[:300]}")
        store.update_job(job_id, stage="提交构建", progress=6)
        build_proc = subprocess.run(
            [config.HYPIT_CLI, "build", str(svrun),
             "--title", job["title"] or name, "--json"],
            cwd=config.HYPIT_PROJECT, env=env,
            capture_output=True, text=True, timeout=600)
        data = _hypit_json(build_proc)
        build_id = ((data.get("data") or {}).get("build") or {}).get("id") \
            or (data.get("build") or {}).get("id") or data.get("buildId") \
            or data.get("id") or ""
        build_id = str(build_id)
        if not build_id.startswith("bld_"):
            raise RuntimeError(f"未取得 build id: {str(data)[:200]}")
        store.update_job(job_id, stage=f"构建 {build_id[-8:]}", progress=8)
        deadline = time.monotonic() + config.HYPIT_TIMEOUT_S
        started = time.monotonic()
        status_data: dict = {}
        while True:
            if _cancel_requested(job_id):
                subprocess.run([config.HYPIT_CLI, "cancel", build_id],
                               cwd=config.HYPIT_PROJECT, env=env,
                               capture_output=True, timeout=60)
                raise comfy.JobCancelled()
            status_proc = subprocess.run(
                [config.HYPIT_CLI, "status", build_id, "--json"],
                cwd=config.HYPIT_PROJECT, env=env,
                capture_output=True, text=True, timeout=120)
            status_data = _hypit_json(status_proc)
            build = status_data.get("build") or {}
            work = build.get("work") or {}
            elapsed = int(time.monotonic() - started)
            if work.get("state") == "done":
                break
            progress = min(88.0, 8 + elapsed / 30.0)
            store.update_job(job_id,
                             stage=f"构建中 {work.get('state') or 'running'} · {elapsed}s",
                             progress=round(progress, 1))
            if time.monotonic() > deadline:
                subprocess.run([config.HYPIT_CLI, "cancel", build_id],
                               cwd=config.HYPIT_PROJECT, env=env,
                               capture_output=True, timeout=60)
                raise RuntimeError(f"构建超时（>{config.HYPIT_TIMEOUT_S}s）")
            time.sleep(20)
        result = (status_data.get("build") or {}).get("result") or {}
        if result.get("state") != "complete":
            raise RuntimeError(f"构建未成功: {result.get('state')} "
                               f"{result.get('outcome') or ''}")
        store.update_job(job_id, stage="导出成片", progress=92)
        out_rel = f"output/vagent_{job_id[-6:]}.mp4"
        out_abs = Path(config.HYPIT_PROJECT) / out_rel
        get_proc = subprocess.run(
            [config.HYPIT_CLI, "get", build_id, "--output", "final.video",
             "--to", out_rel, "--workspace", config.HYPIT_PROJECT],
            cwd=config.HYPIT_PROJECT, env=env,
            capture_output=True, text=True, timeout=1800)
        if get_proc.returncode != 0 or not out_abs.exists():
            raise RuntimeError(f"导出失败: {(get_proc.stdout or get_proc.stderr)[:300]}")
        store.update_job(job_id, stage="入库", progress=96)
        filename = f"{_slug(job['title'], 'hypit')}-{job_id[-6:]}.mp4"
        probe = _ffprobe(out_abs)
        asset = store.create_asset(
            kind="video", filename=filename, title=job["title"] or name,
            prompt=f"hypit 讲解片 · {name}", source="generated", job_id=job_id,
            duration_s=probe.get("duration_s") or 0,
            width=probe.get("width", 0), height=probe.get("height", 0),
            src_path=out_abs,
            conversation_id=job.get("conversation_id") or "")
        poster_name = "poster.jpg"
        if _extract_poster(store.asset_path(asset),
                           config.ASSET_DIR / asset["id"] / poster_name):
            asset = store.update_asset(asset["id"], poster=poster_name)
        try:
            out_abs.unlink(missing_ok=True)
        except OSError:
            pass
        store.update_job(job_id, status="succeeded", stage="已完成",
                         progress=100, asset_id=asset["id"],
                         finished_at=store.now())
        log.info("hypit job %s done -> %s (%s)", job_id, asset["id"], build_id)
        _qc_asset(asset)
        feishu.notify_job(store.get_job(job_id), [asset])
    except comfy.JobCancelled:
        store.update_job(job_id, status="cancelled", stage="已取消",
                         finished_at=store.now())
    except Exception as exc:
        _fail(job_id, exc)


def _tts(narration: str, voice: str, td: Path) -> tuple[Path, Path]:
    """edge-tts -> (mp3, srt)."""
    media = td / "narration.mp3"
    srt = td / "narration.srt"
    cli = Path(config.TTS_PYTHON).parent / "edge-tts"
    if not cli.exists():
        cli = Path("edge-tts")
    subprocess.run(
        [str(cli), "--voice", voice, "--text", narration,
         "--write-media", str(media), "--write-subtitles", str(srt)],
        capture_output=True, timeout=300, check=True)
    return media, srt


def _has_audio(path: Path) -> bool:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return False
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60, check=True).stdout
        return "audio" in out
    except Exception:
        return False


def _process_post(job: dict) -> None:
    """Post-production: narration TTS + subtitle burn + BGM gain control."""
    job_id = job["id"]
    params = _job_params(job)
    video = store.get_asset(job.get("source_asset_id") or "")
    if not video or video["kind"] != "video":
        _fail(job_id, RuntimeError("源资产不是视频"))
        return
    narration = (job["prompt"] or "").strip()
    voice = params.get("voice") or config.TTS_VOICE
    if voice not in config.TTS_VOICES:
        voice = config.TTS_VOICE
    bgm_gain = max(0.0, min(1.0, float(params.get("bgm_gain", 0.15))))
    burn = bool(params.get("burn_subs", True))
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        _fail(job_id, RuntimeError("ffmpeg 不可用"))
        return
    store.update_job(job_id, status="running", stage="后期处理",
                     started_at=store.now(), progress=8)
    try:
        src = store.asset_file_path(video)
        with tempfile.TemporaryDirectory() as td_name:
            td = Path(td_name)
            out = td / f"post-{job_id[-6:]}.mp4"
            args = [ffmpeg, "-y", "-v", "error", "-i", str(src)]
            filters: list[str] = []
            maps: list[str] = []
            media = srt_path = None
            if narration:
                store.update_job(job_id, stage="生成旁白", progress=20)
                media, srt_path = _tts(narration, voice, td)
                args += ["-i", str(media)]
            reburn = bool(narration and burn and srt_path)
            if reburn:
                # white text, thin outline, fully transparent background box
                style = ("FontName=Noto Sans CJK SC,FontSize=15,"
                         "PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,"
                         "BackColour=&HFF000000,BorderStyle=1,Outline=2,Shadow=0,"
                         "MarginV=34")
                escaped = style.replace(",", "\\,").replace("&", "\\&")
                filters.append(
                    f"[0:v]subtitles={srt_path.name}:force_style={escaped}[vout]")
                maps += ["-map", "[vout]"]
            else:
                maps += ["-map", "0:v"]
            if narration:
                if _has_audio(src):
                    filters.append(f"[0:a]volume={bgm_gain:.3f}[bgm]")
                    filters.append("[1:a]volume=1.0[nar]")
                    filters.append(
                        "[bgm][nar]amix=inputs=2:duration=first:normalize=0[aout]")
                else:
                    filters.append("[1:a]volume=1.0[aout]")
                maps += ["-map", "[aout]"]
            elif bgm_gain < 1.0 and _has_audio(src):
                filters.append(f"[0:a]volume={bgm_gain:.3f}[aout]")
                maps += ["-map", "[aout]"]
            else:
                maps += ["-map", "0:a?"]
            if filters:
                args += ["-filter_complex", ";".join(filters)]
            args += maps
            if reburn:
                args += ["-c:v", "libx264", "-preset", "medium", "-crf", "20",
                         "-pix_fmt", "yuv420p"]
            else:
                args += ["-c:v", "copy"]
            args += ["-c:a", "aac", "-b:a", "160k", "-movflags",
                     "+faststart", str(out)]
            store.update_job(job_id, stage="合成音画", progress=55)
            # subtitles filter resolves the .srt relative to cwd
            subprocess.run(args, capture_output=True, timeout=1800, check=True,
                           cwd=str(td))
            if not out.exists():
                raise RuntimeError("ffmpeg 未产出文件")
            store.update_job(job_id, stage="入库", progress=92)
            filename = f"{_slug(job['title'], 'post')}-{job_id[-6:]}.mp4"
            probe = _ffprobe(out)
            asset = store.create_asset(
                kind="video", filename=filename,
                title=f"{video['title']} · 后期",
                prompt=narration or f"BGM 音量 {bgm_gain:.0%}",
                source="derived", job_id=job_id,
                duration_s=probe.get("duration_s") or 0,
                width=probe.get("width", 0), height=probe.get("height", 0),
                src_path=out,
                conversation_id=job.get("conversation_id") or "")
            poster_name = "poster.jpg"
            if _extract_poster(store.asset_path(asset),
                               config.ASSET_DIR / asset["id"] / poster_name):
                asset = store.update_asset(asset["id"], poster=poster_name)
        store.update_job(job_id, status="succeeded", stage="已完成",
                         progress=100, asset_id=asset["id"],
                         finished_at=store.now())
        log.info("post job %s done -> %s", job_id, asset["id"])
        _qc_asset(asset)
        feishu.notify_job(store.get_job(job_id), [asset])
    except comfy.JobCancelled:
        store.update_job(job_id, status="cancelled", stage="已取消",
                         finished_at=store.now())
    except Exception as exc:
        _fail(job_id, exc)


def _process_image(job: dict) -> None:
    """Qwen-Image 2.1 batch: generate `image_count` reference candidates."""
    from . import image_model

    job_id = job["id"]
    count = max(1, min(config.IMAGE_COUNT_MAX, int(job.get("image_count") or 1)))
    store.update_job(job_id, status="running", stage=f"生成参考图 0/{count}",
                     started_at=store.now(), progress=2)
    base_seed = int(time.time() * 1000) % (2 ** 31)
    made: list[dict] = []
    try:
        for i in range(count):
            if _cancel_requested(job_id):
                raise comfy.JobCancelled()
            store.update_job(job_id, stage=f"生成参考图 {i + 1}/{count}",
                             progress=round(i / count * 100, 1) + 2)
            png, meta = image_model.generate(job["prompt"], aspect=job["aspect"],
                                             seed=base_seed + i)
            filename = f"{_slug(job['title'], 'ref')}-ref{i + 1}.png"
            asset = store.create_asset(
                kind="image", filename=filename,
                title=f"{job['title']} · 参考图 {i + 1}",
                prompt=job["prompt"], source="generated", job_id=job_id,
                width=meta["width"], height=meta["height"], data=png,
                conversation_id=job.get("conversation_id") or "")
            made.append(asset)
            store.update_job(job_id, progress=round((i + 1) / count * 100, 1))
        store.update_job(job_id, status="succeeded", stage="已完成", progress=100,
                         asset_id=made[0]["id"] if made else "",
                         finished_at=store.now())
        log.info("image job %s done -> %d assets", job_id, len(made))
        for made_asset in made:
            _qc_asset(made_asset)
        feishu.notify_job(store.get_job(job_id), made)
    except comfy.JobCancelled:
        store.update_job(job_id, status="cancelled", stage="已取消",
                         finished_at=store.now())
    except Exception as exc:
        log.exception("image job %s failed", job_id)
        store.update_job(job_id, status="failed", stage="生成失败",
                         error=str(exc)[:400], finished_at=store.now())
        feishu.notify_job(store.get_job(job_id))


def _process_video(job: dict) -> None:
    job_id = job["id"]
    store.update_job(job_id, status="running", stage="准备模型",
                     started_at=store.now(), progress=2)

    try:
        workflow, spec = _patch_workflow(job)
        prompt_id = comfy.submit(workflow)
        store.update_job(job_id, comfy_prompt_id=prompt_id, stage="已排队待渲染",
                         progress=5)
        log.info("job %s submitted (%s) comfy=%s", job_id, spec, prompt_id)

        done = threading.Event()
        watcher = threading.Thread(
            target=comfy.watch_progress,
            args=(prompt_id, _progress_writer(job_id, 8, 78), done.is_set),
            daemon=True)
        watcher.start()

        def on_tick(elapsed: int, entry: Optional[dict]) -> None:
            if entry and entry.get("status", {}).get("completed"):
                return
            current = store.get_job(job_id) or {}
            if current.get("progress", 0) < 8:
                store.update_job(job_id, stage=f"排队/加载中 {elapsed}s",
                                 progress=6)

        try:
            entry = comfy.wait_for_prompt(prompt_id, lambda: _cancel_requested(job_id),
                                          config.RENDER_TIMEOUT_S, on_tick=on_tick)
        finally:
            done.set()
            watcher.join(timeout=8)

        item = comfy.find_video(entry)
        store.update_job(job_id, stage="下载成片", progress=90)
        data = comfy.download(item)

        store.update_job(job_id, stage="入库", progress=95)
        filename = f"{_slug(job['title'], 'video')}-{job_id[-6:]}.mp4"
        with tempfile.TemporaryDirectory() as td:
            tmp_video = Path(td) / filename
            tmp_video.write_bytes(data)
            probe = _ffprobe(tmp_video)
            asset = store.create_asset(
                kind="video", filename=filename, title=job["title"],
                prompt=job["prompt"], source="generated", job_id=job_id,
                duration_s=probe.get("duration_s") or 0,
                width=probe.get("width", 0), height=probe.get("height", 0),
                src_path=tmp_video,
                conversation_id=job.get("conversation_id") or "")
            poster_name = "poster.jpg"
            if _extract_poster(store.asset_path(asset),
                               config.ASSET_DIR / asset["id"] / poster_name):
                asset = store.update_asset(asset["id"], poster=poster_name)

        store.update_job(job_id, status="succeeded", stage="已完成",
                         progress=100, asset_id=asset["id"],
                         finished_at=store.now())
        log.info("job %s done -> asset %s", job_id, asset["id"])
        _qc_asset(asset)
        feishu.notify_job(store.get_job(job_id), [asset])
    except comfy.JobCancelled:
        store.update_job(job_id, status="cancelled", stage="已取消",
                         finished_at=store.now())
        log.info("job %s cancelled", job_id)
    except Exception as exc:
        log.exception("job %s failed", job_id)
        store.update_job(job_id, status="failed", stage="生成失败",
                         error=str(exc)[:400], finished_at=store.now())
        feishu.notify_job(store.get_job(job_id))


def _cancel_requested(job_id: str) -> bool:
    job = store.get_job(job_id)
    return bool(job and job.get("cancel_requested"))
