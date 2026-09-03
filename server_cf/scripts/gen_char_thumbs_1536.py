#!/usr/bin/env python3
"""字卡缩略图离线批量生成（PIL）：1536px WebP q85 → out/<原文件名>.webp（「显示原图」中间档）
比 640px JPEG 体积约省一半，且满足 3x 屏清晰度。
用法：python scripts/gen_char_thumbs_1536.py <src_dir> <index.json> <out_dir> [limit]
"""
import json
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

SIZE = 1536
QUALITY = 85
WORKERS = 4
lock = threading.Lock()


def make_one(name):
    out = os.path.join(out_dir, name + ".webp")
    if os.path.exists(out):
        return "skipped"
    src = os.path.join(src_dir, name)
    if not os.path.exists(src):
        return "missing"
    try:
        im = Image.open(src)
        if im.mode != "RGB":
            im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, SIZE / max(w, h))
        if scale < 1.0:
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        im.save(out, "WEBP", quality=QUALITY)
        return "ok"
    except Exception as e:  # noqa: BLE001
        print("SKIP", name, e)
        return "fail"


src_dir = sys.argv[1]
index_file = sys.argv[2]
out_dir = sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 0

idx = json.load(open(index_file, encoding="utf-8"))
names = sorted({it["image"] for it in idx["items"]})
if limit:
    names = names[:limit]
os.makedirs(out_dir, exist_ok=True)

counts = {"ok": 0, "fail": 0, "skipped": 0, "missing": 0}
start = time.time()

with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    futures = {ex.submit(make_one, n): n for n in names}
    for fut in as_completed(futures):
        counts[fut.result()] += 1
        done = sum(counts.values())
        if done % 200 == 0:
            print(f"progress {done}/{len(names)} {counts}", flush=True)

print(f"generate done: {counts} in {((time.time() - start) / 60):.1f} min")
