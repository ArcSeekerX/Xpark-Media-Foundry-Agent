#!/usr/bin/env python3
"""Xpark Media Foundry generation backend.

A dependency-free business API used by the Agent console/web front ends. It
owns the ComfyUI templates for text-to-image keyframes and reference-to-video
renders, uploads browser-side reference images, and exposes a small job API so
the front end never talks to ComfyUI directly.

Endpoints (all under /api):
    GET  /api/health
    GET  /api/comfy/view?filename=&subfolder=&type=
    POST /api/images/jobs          {prompt, negative_prompt, width, height, seed,
                                    steps, sampler, reference_images:[{name,data_url}]}
    GET  /api/images/jobs/{id}
    POST /api/videos/jobs          {prompt, negative_prompt, width, height, length,
                                    seed, steps, sampler, reference_images:[...]}
    GET  /api/videos/jobs/{id}

Run:
    python3 apps/api/server.py --port 8080
Environment:
    COMFY_URL (default http://127.0.0.1:8188)
    IMAGE_WORKFLOW / VIDEO_WORKFLOW (API-format JSON paths)
"""
from __future__ import annotations

import argparse
import base64
import itertools
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IMAGE_WORKFLOW = REPO_ROOT / "apps/console/public/workflows/qwen_image_t2i.api.json"
DEFAULT_VIDEO_WORKFLOW = REPO_ROOT / "apps/web/public/workflows/h3_ref2va.api.json"

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
JOB_COUNTER = itertools.count(1)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def http_json(url: str, payload: dict | None = None, timeout: int = 60):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        return json.loads(body) if body else {}


def http_bytes(url: str, timeout: int = 120):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read(), resp.headers.get("Content-Type", "application/octet-stream")


def comfy_upload(comfy_url: str, name: str, content: bytes, content_type: str) -> str:
    boundary = "----xpark" + uuid.uuid4().hex
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'.encode()
    body += f"Content-Type: {content_type}\r\n\r\n".encode()
    body += content + b"\r\n"
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="overwrite"\r\n\r\n'
    body += b"true\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{comfy_url}/upload/image",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read() or b"{}")
    subfolder = data.get("subfolder") or ""
    return f"{subfolder}/{data.get('name', name)}" if subfolder else data.get("name", name)


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
        mime = header.split(";")[0].removeprefix("data:") or "image/png"
    else:
        b64, mime = data_url, "image/png"
    return base64.b64decode(b64), mime


# ---------------------------------------------------------------------------
# ComfyUI graph helpers
# ---------------------------------------------------------------------------
def node_ids(graph: dict, class_types: list[str]) -> list[str]:
    ids = [k for k, v in graph.items() if isinstance(v, dict) and v.get("class_type") in class_types]
    return sorted(ids, key=lambda k: (len(k), k))


def find_node(graph: dict, class_types: list[str]) -> str | None:
    ids = node_ids(graph, class_types)
    return ids[0] if ids else None


def load_template(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        template = json.load(fh)
    if not template:
        raise RuntimeError(f"workflow is empty: {path}")
    return template


def upload_references(comfy_url: str, graph: dict, references: list[dict], loader_types: list[str]) -> None:
    if not references:
        return
    loaders = node_ids(graph, loader_types)
    for loader, ref in zip(loaders, references):
        data_url = ref.get("data_url")
        if not data_url:
            continue
        try:
            content, mime = decode_data_url(data_url)
            server_name = comfy_upload(comfy_url, ref.get("name", "reference.png"), content, mime)
            graph[loader]["inputs"]["image"] = server_name
        except Exception:  # noqa: BLE001 - never abort a job for a bad reference
            continue


def build_image_graph(comfy_url: str, workflow_path: Path, req: dict) -> dict:
    graph = json.loads(json.dumps(load_template(workflow_path)))
    text_ids = node_ids(graph, ["CLIPTextEncode", "TextEncodeQwenImageEdit"])

    def title(i: str) -> str:
        return (graph[i].get("_meta") or {}).get("title", "")

    positive = next((i for i in text_ids if "pos" in title(i).lower() or "正" in title(i)), None)
    negative = next((i for i in text_ids if "neg" in title(i).lower() or "负" in title(i)), None)
    if positive is None and text_ids:
        positive = text_ids[0]
    if negative is None:
        negative = next((i for i in text_ids if i != positive), None)
    if positive:
        graph[positive]["inputs"]["text"] = req.get("prompt", "")
    if negative:
        graph[negative]["inputs"]["text"] = req.get("negative_prompt", "")

    latent = find_node(graph, ["EmptyLatentImage", "EmptySD3LatentImage"])
    if latent:
        graph[latent]["inputs"]["width"] = int(req.get("width") or 768)
        graph[latent]["inputs"]["height"] = int(req.get("height") or 1024)
    sampler = find_node(graph, ["KSampler", "KSamplerAdvanced"])
    if sampler:
        graph[sampler]["inputs"]["seed"] = int(req.get("seed") or 0)
        graph[sampler]["inputs"]["steps"] = int(req.get("steps") or 20)
        graph[sampler]["inputs"]["sampler_name"] = req.get("sampler") or "euler"
    noise = find_node(graph, ["RandomNoise"])
    if noise:
        graph[noise]["inputs"]["noise_seed"] = int(req.get("seed") or 0)
    save = find_node(graph, ["SaveImage"])
    if save:
        graph[save]["inputs"]["filename_prefix"] = "xpark/keyframe"
    upload_references(comfy_url, graph, req.get("reference_images", []), ["LoadImage"])
    return graph


def build_video_graph(comfy_url: str, workflow_path: Path, req: dict) -> dict:
    graph = json.loads(json.dumps(load_template(workflow_path)))
    node = find_node(graph, ["MiniMaxH3ReferenceToVideo"])
    if node:
        graph[node]["inputs"]["prompt"] = req.get("prompt", "")
        graph[node]["inputs"]["width"] = int(req.get("width") or 512)
        graph[node]["inputs"]["height"] = int(req.get("height") or 512)
        graph[node]["inputs"]["length"] = int(req.get("length") or 22)
    noise = find_node(graph, ["RandomNoise"])
    if noise:
        graph[noise]["inputs"]["noise_seed"] = int(req.get("seed") or 0)
    sched = find_node(graph, ["BasicScheduler"])
    if sched:
        graph[sched]["inputs"]["steps"] = int(req.get("steps") or 4)
    sampler = find_node(graph, ["KSamplerSelect"])
    if sampler:
        graph[sampler]["inputs"]["sampler_name"] = req.get("sampler") or "res_multistep"
    save = find_node(graph, ["SaveVideo"])
    if save:
        graph[save]["inputs"]["filename_prefix"] = "xpark/agent"
    upload_references(comfy_url, graph, req.get("reference_images", []), ["LoadImage"])
    return graph


def submit_graph(comfy_url: str, graph: dict) -> str:
    client_id = uuid.uuid4().hex
    res = http_json(f"{comfy_url}/prompt", {"prompt": graph, "client_id": client_id})
    prompt_id = res.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI rejected prompt: {res.get('node_errors')}")
    return prompt_id


def extract_outputs(entry: dict, pattern) -> list[dict]:
    files: list[dict] = []
    for node in (entry.get("outputs") or {}).values():
        for value in node.values():
            if not isinstance(value, list):
                continue
            for item in value:
                if isinstance(item, dict) and "filename" in item and pattern(item["filename"]):
                    files.append(item)
    return files


def artifact_from_file(filename: str, subfolder: str, req: dict) -> dict:
    query = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder or "", "type": "output"}
    )
    return {
        "asset_id": "art_" + uuid.uuid4().hex[:12],
        "url": f"/api/comfy/view?{query}",
        "storage_key": f"comfy/{subfolder + '/' if subfolder else ''}{filename}",
        "width": int(req.get("width") or 0),
        "height": int(req.get("height") or 0),
        "duration_s": 0,
        "seed": int(req.get("seed") or 0),
    }


def poll_job(comfy_url: str, job: dict) -> None:
    history = http_json(f"{comfy_url}/history/{job['prompt_id']}", timeout=60)
    entry = history.get(job["prompt_id"])
    if not entry:
        return
    status = (entry.get("status") or {})
    state = status.get("status_str")
    if state == "error":
        job["state"] = "failed"
        job["error"] = "ComfyUI execution error"
        return
    if state == "success" and status.get("completed"):
        pattern = (lambda f: f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))) \
            if job["kind"] == "image" else (lambda f: f.lower().endswith((".mp4", ".webm", ".mov")))
        files = extract_outputs(entry, pattern)
        if not files:
            job["state"] = "failed"
            job["error"] = "no output file"
            return
        file = files[0]
        job["artifact"] = artifact_from_file(
            file["filename"], file.get("subfolder", ""), job["request"]
        )
        job["state"] = "succeeded"


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    comfy_url = os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
    image_workflow = Path(os.environ.get("IMAGE_WORKFLOW", str(DEFAULT_IMAGE_WORKFLOW)))
    video_workflow = Path(os.environ.get("VIDEO_WORKFLOW", str(DEFAULT_VIDEO_WORKFLOW)))

    def log_message(self, fmt, *args):  # quieter default logging
        print(f"[api] {self.address_string()} {fmt % args}")

    # -- low level helpers ---------------------------------------------------
    def _send(self, code: int, payload, content_type="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw.decode() or "{}") if raw else {}

    def do_OPTIONS(self):  # noqa: N802
        self._send(204, b"", "text/plain")

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if path == "/api/health":
                comfy = {"reachable": False}
                try:
                    stats = http_json(f"{self.comfy_url}/system_stats", timeout=8)
                    comfy = {
                        "reachable": True,
                        "version": (stats.get("system") or {}).get("comfyui_version"),
                        "device": ((stats.get("devices") or [{}])[0]).get("name"),
                    }
                except Exception:  # noqa: BLE001
                    pass
                return self._send(200, {"ok": True, "comfy": comfy,
                                        "image_workflow": str(self.image_workflow),
                                        "video_workflow": str(self.video_workflow)})
            if path == "/api/comfy/view":
                query_string = urllib.parse.urlencode(
                    {
                        "filename": (query.get("filename") or [""])[0],
                        "subfolder": (query.get("subfolder") or [""])[0],
                        "type": (query.get("type") or ["output"])[0],
                    }
                )
                data, ctype = http_bytes(f"{self.comfy_url}/view?{query_string}")
                return self._send(200, data, ctype)
            if path.startswith("/api/images/jobs/"):
                return self._job_status(path.rsplit("/", 1)[-1])
            if path.startswith("/api/videos/jobs/"):
                return self._job_status(path.rsplit("/", 1)[-1])
            return self._send(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"error": str(exc)})

    def do_POST(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/images/jobs":
                return self._create_job("image", self._json_body())
            if parsed.path == "/api/videos/jobs":
                return self._create_job("video", self._json_body())
            return self._send(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"error": str(exc)})

    # -- job handlers --------------------------------------------------------
    def _create_job(self, kind: str, req: dict):
        workflow = self.image_workflow if kind == "image" else self.video_workflow
        if not workflow.exists():
            return self._send(400, {"error": f"workflow missing: {workflow}"})
        builder = build_image_graph if kind == "image" else build_video_graph
        graph = builder(self.comfy_url, workflow, req)
        prompt_id = submit_graph(self.comfy_url, graph)
        job_id = f"job_{next(JOB_COUNTER):04d}_{uuid.uuid4().hex[:8]}"
        with JOBS_LOCK:
            JOBS[job_id] = {
                "job_id": job_id,
                "kind": kind,
                "prompt_id": prompt_id,
                "state": "running",
                "request": req,
                "created_at": time.time(),
            }
        print(f"[api] created {kind} job {job_id} -> comfy {prompt_id}")
        return self._send(202, {"job_id": job_id, "prompt_id": prompt_id, "state": "running"})

    def _job_status(self, job_id: str):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
        if not job:
            return self._send(404, {"error": "unknown job"})
        if job["state"] == "running":
            try:
                poll_job(self.comfy_url, job)
            except Exception as exc:  # noqa: BLE001
                job["last_error"] = str(exc)
        payload = {"state": job["state"]}
        if job.get("artifact"):
            payload["artifact"] = job["artifact"]
        if job.get("error"):
            payload["error"] = job["error"]
        return self._send(200, payload)


def main() -> int:
    ap = argparse.ArgumentParser(description="Xpark Media Foundry generation backend")
    ap.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    ap.add_argument("--comfy-url", default=Handler.comfy_url)
    ap.add_argument("--image-workflow", default=str(Handler.image_workflow))
    ap.add_argument("--video-workflow", default=str(Handler.video_workflow))
    args = ap.parse_args()

    Handler.comfy_url = args.comfy_url.rstrip("/")
    Handler.image_workflow = Path(args.image_workflow)
    Handler.video_workflow = Path(args.video_workflow)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[api] listening on http://{args.host}:{args.port}")
    print(f"[api] comfy={Handler.comfy_url} image={Handler.image_workflow} video={Handler.video_workflow}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
