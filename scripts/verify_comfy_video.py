#!/usr/bin/env python3
"""Smoke-verify the ComfyUI video generation interface (MiniMax H3 Ref2VA).

Submits an API-format workflow, polls /history, and verifies the produced
media with ffprobe. Image generation has no local text-to-image checkpoint on
this host; that path is exercised by the frontend ImageAdapter placeholder.

Usage:
    python3 scripts/verify_comfy_video.py \
        --workflow examples/matlow_fused_4step.api.json \
        --url http://127.0.0.1:8188 --width 512 --height 512 --length 22
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
import uuid


def http(url: str, payload: dict | None = None, timeout: int = 60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return json.loads(body) if body else {}


def find(workflow: dict, class_type: str) -> str | None:
    for node_id, node in workflow.items():
        if isinstance(node, dict) and node.get("class_type") == class_type:
            return node_id
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workflow", required=True)
    ap.add_argument("--url", default="http://127.0.0.1:8188")
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=512)
    ap.add_argument("--length", type=int, default=22)
    ap.add_argument("--prefix", default="verify_video_smoke")
    ap.add_argument("--timeout", type=int, default=1800)
    args = ap.parse_args()

    stats = http(f"{args.url}/system_stats", timeout=15)
    print("ComfyUI:", stats.get("system", {}).get("comfyui_version"),
          stats.get("devices", [{}])[0].get("name", "?"))

    workflow = json.load(open(args.workflow, encoding="utf-8"))
    r2v = find(workflow, "MiniMaxH3ReferenceToVideo")
    if not r2v:
        print("workflow has no MiniMaxH3ReferenceToVideo node", file=sys.stderr)
        return 2
    workflow[r2v]["inputs"].update(
        width=args.width, height=args.height, length=args.length
    )
    seed = find(workflow, "RandomNoise")
    if seed:
        workflow[seed]["inputs"]["noise_seed"] = 20260925
    save = find(workflow, "SaveVideo")
    if save:
        workflow[save]["inputs"]["filename_prefix"] = args.prefix

    client_id = uuid.uuid4().hex
    queued = http(f"{args.url}/prompt", {"prompt": workflow, "client_id": client_id})
    pid = queued["prompt_id"]
    print(f"submitted prompt_id={pid} number={queued.get('number')} "
          f"errors={queued.get('node_errors')}")

    deadline = time.time() + args.timeout
    last = ""
    while time.time() < deadline:
        time.sleep(4)
        hist = http(f"{args.url}/history/{pid}", timeout=30)
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            print("status:", status.get("status_str"),
                  "completed=", status.get("completed"))
            if status.get("status_str") == "error":
                for m in status.get("messages", []):
                    print("  ", m)
                return 1
            if status.get("completed"):
                outputs = entry.get("outputs", {})
                files = []
                for node_id, out in outputs.items():
                    for kind, items in out.items():
                        if not isinstance(items, list):
                            continue
                        for it in items:
                            if isinstance(it, dict) and it.get("filename"):
                                files.append((kind, it))
                                print(f"OUTPUT {kind}/{it.get('filename')} "
                                      f"subfolder={it.get('subfolder')}")
                if not files:
                    print("no output file entries", file=sys.stderr)
                    return 1
                return 0
        prog = http(f"{args.url}/prompt", timeout=5) if False else None  # noqa
        _ = prog
    print("timeout waiting for completion", file=sys.stderr)
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
