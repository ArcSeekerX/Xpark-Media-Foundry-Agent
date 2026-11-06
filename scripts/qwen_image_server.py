# Qwen-Image 2.1 text-to-image HTTP service (host-side, port 8601).
#
# Loads the local diffusers bundle once and serves POST /generate:
#   {"prompt": str, "negative_prompt": str, "width": int, "height": int,
#    "steps": int, "cfg": float, "seed": int|None}
#   -> {"image_b64": png, "seconds": float}
# Model CPU offload keeps it co-resident with the ComfyUI H3 renderer on GB10.
from __future__ import annotations

import base64
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_DIR = os.environ.get("QWEN_IMAGE_DIR", "/home/admin/xu/comfyui/qwen-image-2.1")
PORT = int(os.environ.get("QWEN_IMAGE_PORT", "8601"))
MAX_SIDE = 2048
MIN_SIDE = 256

_pipe = None
_load_lock = threading.Lock()
_gen_lock = threading.Lock()


def get_pipe():
    global _pipe
    if _pipe is None:
        with _load_lock:
            if _pipe is None:
                import torch
                from diffusers import QwenImage21Pipeline
                started = time.time()
                pipe = QwenImage21Pipeline.from_pretrained(
                    MODEL_DIR, torch_dtype=torch.bfloat16)
                pipe.enable_model_cpu_offload()
                _pipe = pipe
                print(f"[qwen-image] loaded in {time.time() - started:.0f}s",
                      flush=True)
    return _pipe


def _snap(value: int) -> int:
    value = max(MIN_SIDE, min(MAX_SIDE, int(value)))
    return value - (value % 32)


def generate(body: dict) -> dict:
    """Text-to-image, or image-edit when image_b64 is provided."""
    import torch
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    width = _snap(body.get("width", 1344))
    height = _snap(body.get("height", 768))
    steps = max(4, min(60, int(body.get("steps", 28))))
    cfg = float(body.get("cfg", 4.0))
    seed = body.get("seed")
    generator = None
    if seed is not None:
        generator = torch.Generator().manual_seed(int(seed))
    kwargs: dict = {
        "prompt": prompt,
        "negative_prompt": str(body.get("negative_prompt") or ""),
        "num_inference_steps": steps,
        "true_cfg_scale": cfg,
        "generator": generator,
    }
    image_b64 = body.get("image_b64")
    if image_b64:
        from PIL import Image
        source = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
        kwargs["image"] = source
        output_resolution = body.get("output_resolution")
        if output_resolution:
            kwargs["output_resolution"] = _snap(output_resolution)
        width, height = source.size
    else:
        kwargs["width"] = width
        kwargs["height"] = height
    with _gen_lock:
        pipe = get_pipe()
        started = time.time()
        image = pipe(**kwargs).images[0]
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return {"image_b64": base64.b64encode(buf.getvalue()).decode(),
            "seconds": round(time.time() - started, 1),
            "width": image.width, "height": image.height}


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._json(200, {"status": "ok", "loaded": _pipe is not None,
                         "model_dir": MODEL_DIR})

    def do_POST(self):
        if self.path.rstrip("/") != "/generate":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            self._json(200, generate(body))
        except Exception as exc:
            self._json(500, {"error": f"{type(exc).__name__}: {exc}"[:400]})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"[qwen-image] serving on :{PORT}, model={MODEL_DIR}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
