#!/usr/bin/env python3
"""End-to-end smoke test for the generation backend using a fake ComfyUI.

Runs without a GPU or ComfyUI install:
    python3 apps/api/test_server.py

It starts a stub ComfyUI, then the generation backend, and exercises the image
and video job APIs plus artifact proxying.
"""
from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import server


class FakeComfy(BaseHTTPRequestHandler):
    submissions: list[dict] = []

    def log_message(self, *args):  # silence
        pass

    def _send(self, payload, content_type="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/system_stats"):
            return self._send({"system": {"comfyui_version": "fake-0.0"}, "devices": [{"name": "FakeGPU"}]})
        if self.path.startswith("/history/"):
            return self._send(
                {
                    "prompt_1": {
                        "status": {"status_str": "success", "completed": True},
                        "outputs": {
                            "9": {
                                "images": [
                                    {"filename": "keyframe_00001_.png", "subfolder": "xpark", "type": "output"}
                                ],
                                "videos": [
                                    {"filename": "agent_00001_.mp4", "subfolder": "xpark", "type": "output"}
                                ],
                            }
                        },
                    }
                }
            )
        if self.path.startswith("/view"):
            return self._send(b"FAKEBYTES", "video/mp4")
        return self._send({})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if self.path.startswith("/upload/image"):
            return self._send({"name": "reference.png", "subfolder": ""})
        if self.path.startswith("/prompt"):
            payload = json.loads(raw.decode())
            # Force deterministic prompt_id used by the fake history.
            payload["prompt_id"] = "prompt_1"
            FakeComfy.submissions.append(payload)
            return self._send({"prompt_id": "prompt_1"})
        return self._send({})


def start(handler_cls, port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler_cls)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    return srv, thread


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read() or b"{}")


def post_json(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read() or b"{}")


class BackendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.comfy, _ = start(FakeComfy)
        cls.comfy_url = f"http://127.0.0.1:{cls.comfy.server_address[1]}"
        server.Handler.comfy_url = cls.comfy_url
        cls.api, _ = start(server.Handler)
        cls.api_url = f"http://127.0.0.1:{cls.api.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.api.shutdown()
        cls.comfy.shutdown()

    def test_health(self):
        data = get_json(f"{self.api_url}/api/health")
        self.assertTrue(data["ok"])
        self.assertTrue(data["comfy"]["reachable"])

    def test_image_job(self):
        created = post_json(
            f"{self.api_url}/api/images/jobs",
            {
                "prompt": "a rainy rooftop keyframe",
                "negative_prompt": "watermark",
                "width": 768,
                "height": 1024,
                "seed": 7,
                "steps": 20,
                "sampler": "euler",
                "reference_images": [
                    {"name": "hero.png", "data_url": "data:image/png;base64,aGVsbG8="}
                ],
            },
        )
        self.assertIn("job_id", created)
        status = get_json(f"{self.api_url}/api/images/jobs/{created['job_id']}")
        self.assertEqual(status["state"], "succeeded")
        self.assertTrue(status["artifact"]["url"].startswith("/api/comfy/view"))

    def test_video_job(self):
        created = post_json(
            f"{self.api_url}/api/videos/jobs",
            {
                "prompt": "subject_definitions: hero",
                "negative_prompt": "",
                "width": 512,
                "height": 512,
                "length": 22,
                "seed": 43,
                "steps": 4,
                "sampler": "res_multistep",
            },
        )
        self.assertIn("job_id", created)
        status = get_json(f"{self.api_url}/api/videos/jobs/{created['job_id']}")
        self.assertEqual(status["state"], "succeeded")
        self.assertTrue(status["artifact"]["url"].startswith("/api/comfy/view"))

    def test_artifact_proxy(self):
        with urllib.request.urlopen(
            f"{self.api_url}/api/comfy/view?filename=agent_00001_.mp4", timeout=10
        ) as resp:
            self.assertEqual(resp.read(), b"FAKEBYTES")


if __name__ == "__main__":
    unittest.main(verbosity=2)
