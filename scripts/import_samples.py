# Import existing local media as sample assets so the library starts populated.
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import store  # noqa: E402

ROOT = Path("/home/admin/xu/xfusion")

SAMPLES = [
    ("video", ROOT / "case/case_multica_intro.mp4", "Multica 产品讲解 · 参考图动效"),
    ("video", ROOT / "case2/case2_90s.mp4", "Case2 · 多镜头成片 90s"),
    ("video", ROOT / "case3/case3_zh_90s.mp4", "Case3 · 中文讲解成片 90s"),
    ("video", ROOT / "outputs/MiniMax_H3_00001_.mp4", "MiniMax H3 · 单段样例"),
    ("image", ROOT / "case3/overlays/s01.png", "Case3 字幕叠层 s01"),
    ("image", ROOT / "case3/overlays/s02.png", "Case3 字幕叠层 s02"),
    ("image", ROOT / "case3/overlays/s03.png", "Case3 字幕叠层 s03"),
    ("image", ROOT / "case3/overlays/s04.png", "Case3 字幕叠层 s04"),
]


def ffprobe(path: Path) -> dict:
    try:
        import json
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,duration",
             "-show_entries", "format=duration", "-of", "json", str(path)],
            capture_output=True, timeout=60, check=True).stdout
        data = json.loads(out)
        stream = (data.get("streams") or [{}])[0]
        return {"width": stream.get("width") or 0,
                "height": stream.get("height") or 0,
                "duration_s": float((data.get("format") or {}).get("duration") or 0)}
    except Exception:
        return {}


def poster(video: Path, target: Path) -> bool:
    if target.exists():
        return True
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", "1", "-i", str(video),
             "-frames:v", "1", "-vf", "scale=960:-2", str(target)],
            capture_output=True, timeout=120, check=True)
        return target.exists()
    except Exception:
        return False


def main() -> None:
    store.init_db()
    existing = {a["title"] for a in store.list_assets(limit=500)
                if a["source"] == "sample"}
    for kind, src, title in SAMPLES:
        if title in existing:
            print(f"skip (exists): {title}")
            continue
        if not src.exists():
            print(f"skip (missing): {src}")
            continue
        asset = store.create_asset(kind=kind, filename=src.name, title=title,
                                   prompt="", source="sample", src_path=src)
        if kind == "video":
            probe = ffprobe(store.asset_path(asset))
            asset = store.update_asset(asset["id"], **probe)
            if poster(store.asset_path(asset),
                      store.asset_path(asset).parent / "poster.jpg"):
                asset = store.update_asset(asset["id"], poster="poster.jpg")
        print(f"imported {kind}: {title} -> {asset['id']}")


if __name__ == "__main__":
    main()
