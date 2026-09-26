#!/usr/bin/env python3
"""End-to-end smoke test for the generation backend using a fake ComfyUI.

Runs without a GPU or ComfyUI install:
    python3 apps/api/test_server.py

Covers image/video jobs, artifact proxying, capabilities, the SSE event
stream, bearer auth and the compose endpoint's graceful ffmpeg handling.
"""
from __future__ import annotations

import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

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
            return self._send({
                "prompt_1": {
                    "status": {"status_str": "success", "completed": True},
                    "outputs": {
                        "9": {
                            "images": [{"filename": "keyframe_00001_.png", "subfolder": "xpark", "type": "output"}],
                            "videos": [{"filename": "agent_00001_.mp4", "subfolder": "xpark", "type": "output"}],
                        }
                    },
                }
            })
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
            payload["prompt_id"] = "prompt_1"
            FakeComfy.submissions.append(payload)
            return self._send({"prompt_id": "prompt_1"})
        return self._send({})


def start(handler_cls, port=0):
    srv = server.Server(("127.0.0.1", port), handler_cls)
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
        server.Handler.api_token = ""
        cls.api.shutdown()
        cls.comfy.shutdown()

    def test_health(self):
        data = get_json(f"{self.api_url}/api/health")
        self.assertTrue(data["ok"])
        self.assertTrue(data["comfy"]["reachable"])

    def test_capabilities(self):
        caps = get_json(f"{self.api_url}/api/capabilities")
        self.assertIn("image", caps)
        self.assertIn("video", caps)
        self.assertIn("compose", caps)
        self.assertIn("reference_images", caps["video"]["inputs"])

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
                "project_id": "p_test",
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
                "project_id": "p_test",
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

    def test_sse_event_stream(self):
        # A completed job publishes events; the stream must replay them by seq.
        post_json(f"{self.api_url}/api/videos/jobs", {"prompt": "x", "project_id": "p_sse"})
        url = f"{self.api_url}/api/events?project_id=p_sse&since=0"
        resp = urllib.request.urlopen(url, timeout=10)
        try:
            found = None
            for _ in range(30):
                line = resp.readline().decode("utf-8", "ignore")
                if line.startswith("data:"):
                    found = json.loads(line[5:].strip())
                    break
            self.assertIsNotNone(found)
            self.assertIn("type", found)
            self.assertEqual(found["project_id"], "p_sse")
        finally:
            resp.close()

    def test_compose_requires_clips(self):
        try:
            post_json(f"{self.api_url}/api/productions/compose", {"clips": []})
            self.fail("expected 400 for empty clips")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)

    def test_compose_graceful_without_ffmpeg(self):
        try:
            result = post_json(
                f"{self.api_url}/api/productions/compose",
                {"clips": ["/api/comfy/view?filename=agent_00001_.mp4&subfolder=xpark"]},
            )
            # ffmpeg is available in this environment: expect a served export URL.
            self.assertTrue(result["url"].startswith("/api/exports/"))
        except urllib.error.HTTPError as exc:
            # No ffmpeg: the endpoint must degrade with a clear error, not crash.
            self.assertEqual(exc.code, 503)
            self.assertIn("ffmpeg_unavailable", exc.read().decode())

    def test_auth(self):
        server.Handler.api_token = "secret"
        try:
            try:
                get_json(f"{self.api_url}/api/capabilities")
                self.fail("expected 401 without token")
            except urllib.error.HTTPError as exc:
                self.assertEqual(exc.code, 401)
            req = urllib.request.Request(
                f"{self.api_url}/api/capabilities",
                headers={"Authorization": "Bearer secret"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                self.assertEqual(resp.status, 200)
            # health stays public even with auth enabled
            self.assertTrue(get_json(f"{self.api_url}/api/health")["ok"])
        finally:
            server.Handler.api_token = ""


if __name__ == "__main__":
    unittest.main(verbosity=2)
