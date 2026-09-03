#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
PaddleOCR-VL-1.6「优化版 optionalPayload」实测对比

背景：用户给了一份 TS 优化版代码，核心提速点是 optionalPayload 服务端功能裁剪。
但其中部分优化（axios keepAlive agent / sharp / fs）在 Cloudflare Workers 上不可移植，
只有「optionalPayload 裁剪 + 图片预处理 + 自适应轮询」可落地。

本脚本实测 4 种配置，回答两个问题：
  Q1. 裁剪 optionalPayload 到底快多少？
  Q2. 关掉 layoutParsing 后，返回 JSONL 里还有没有 layoutParsingResults？
      —— 生产 paddleOcrExtract 依赖该字段解析 markdown，结构没了配置再快也不能用。

配置：
  A 现状(生产)   : orientation=T unwarping=T chart=T             （paddleOcrExtract 当前值）
  B 全关(用户版) : 全部 False 含 layoutParsing=False
  C 全关+压缩1600: B + 本地 resize 长边1600 JPEG q80
  D 折中         : orientation=T unwarping=T chart=F table=F formula=F（保留防倾斜，关重功能）

用法：
  set PADDLE_OCR_TOKEN=xxx
  python _bench_paddle_vl_opts.py <image1> [image2 ...]

依赖：pip install requests pillow
"""
import io
import json
import os
import sys
import time
import argparse
import requests
from typing import Optional

try:
    from PIL import Image
except ImportError:
    Image = None  # type: ignore

JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
MODEL = "PaddleOCR-VL-1.6"
PADDLE_TOKEN = os.environ.get("PADDLE_OCR_TOKEN", "")

# 四种被测配置：(标签, optionalPayload dict, 是否压缩图片)
CONFIGS = [
    ("A 现状(生产)", {"useDocOrientationClassify": True, "useDocUnwarping": True, "useChartRecognition": True}, False),
    ("B 全关(用户版)", {
        "useDocOrientationClassify": False, "useDocUnwarping": False, "useChartRecognition": False,
        "useFormulaRecognition": False, "useTableRecognition": False, "layoutParsing": False,
    }, False),
    ("C 全关+压缩1600", {
        "useDocOrientationClassify": False, "useDocUnwarping": False, "useChartRecognition": False,
        "useFormulaRecognition": False, "useTableRecognition": False, "layoutParsing": False,
    }, True),
    ("D 折中(留防倾斜)", {
        "useDocOrientationClassify": True, "useDocUnwarping": True, "useChartRecognition": False,
        "useFormulaRecognition": False, "useTableRecognition": False,
    }, False),
]


def _hr(ch: str = "-") -> str:
    return ch * 78


def preprocess(path: str, max_side: int = 1600, quality: int = 80) -> bytes:
    """本地图片预处理：长边压到 max_side、转 JPEG q80（对应 TS 版 sharp 处理）。"""
    if Image is None:
        raise RuntimeError("未安装 Pillow，无法做图片预处理")
    im = Image.open(path)
    if im.mode in ("RGBA", "P", "LA"):
        im = im.convert("RGB")
    elif im.mode != "RGB":
        im = im.convert("RGB")
    w, h = im.size
    if max(w, h) > max_side:
        ratio = max_side / max(w, h)
        im = im.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def run_one(image_path: str, payload: dict, label: str, do_compress: bool) -> dict:
    """跑一次完整流程：提交 → 轮询 → 下载 → 解析。记录各阶段耗时与返回结构。"""
    headers = {"Authorization": f"bearer {PADDLE_TOKEN}"}

    # 准备上传字节
    if do_compress:
        body_bytes = preprocess(image_path)
        fname = "page.jpg"
    else:
        with open(image_path, "rb") as f:
            body_bytes = f.read()
        fname = os.path.basename(image_path)

    data = {"model": MODEL, "optionalPayload": json.dumps(payload)}
    files = {"file": (fname, body_bytes)}

    t0 = time.time()
    submit = requests.post(JOB_URL, headers=headers, data=data, files=files)
    submit_ms = int((time.time() - t0) * 1000)
    if submit.status_code != 200:
        return {"label": label, "ok": False, "error": f"submit HTTP {submit.status_code}: {submit.text[:160]}",
                "submit_ms": submit_ms, "total_ms": submit_ms}
    job_id = submit.json()["data"]["jobId"]
    print(f"    jobId={job_id}  上传={len(body_bytes)/1024:.0f}KB  submit={submit_ms}ms")

    # 轮询：记录首次 running / 首次 done 的绝对耗时（服务端真实处理时间）
    jsonl_url = ""
    polls = 0
    t_running: Optional[float] = None
    while time.time() - t0 < 300:
        rr = requests.get(f"{JOB_URL}/{job_id}", headers=headers)
        polls += 1
        if rr.status_code != 200:
            return {"label": label, "ok": False, "error": f"poll HTTP {rr.status_code}",
                    "submit_ms": submit_ms, "total_ms": int((time.time() - t0) * 1000)}
        d = rr.json()["data"]
        state = d.get("state")
        now = time.time()
        if state == "running" and t_running is None:
            t_running = now
        if state == "done":
            jsonl_url = d.get("resultUrl", {}).get("jsonUrl", "")
            break
        if state == "failed":
            return {"label": label, "ok": False, "error": f"任务失败: {d.get('errorMsg')}",
                    "submit_ms": submit_ms, "total_ms": int((time.time() - t0) * 1000)}
        time.sleep(1)  # 1s 粒度，尽量精确测出 done 时刻
    if not jsonl_url:
        return {"label": label, "ok": False, "error": "轮询超时/无 jsonlUrl",
                "submit_ms": submit_ms, "total_ms": int((time.time() - t0) * 1000)}

    t_done = time.time()
    dl_t0 = time.time()
    jr = requests.get(jsonl_url)  # 预签名 URL，不能带 Authorization（记忆坑点）
    download_ms = int((time.time() - dl_t0) * 1000)
    total_ms = int((time.time() - t0) * 1000)

    if jr.status_code != 200:
        return {"label": label, "ok": False, "error": f"jsonl HTTP {jr.status_code}",
                "submit_ms": submit_ms, "total_ms": total_ms}

    # ── 解析：统计文本量 + 检查结构（关键！验证 layoutParsingResults 是否存在）──
    payload_text = jr.text.strip()
    md_chars = 0
    layout_parsing_hits = 0
    top_keys: set = set()
    result_keys: set = set()
    preview_lines: list = []
    for line in payload_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            top_keys.update(obj.keys())
            r = obj.get("result", {}) or {}
            result_keys.update(r.keys())
            lprs = r.get("layoutParsingResults") or []
            layout_parsing_hits += len(lprs)
            for lpr in lprs:
                md = (lpr.get("markdown") or {}).get("text", "")
                md_chars += len(md)
                for ln in md.split("\n"):
                    s = ln.strip()
                    if s and len(preview_lines) < 6:
                        preview_lines.append(s)
        except json.JSONDecodeError:
            pass

    return {
        "label": label, "ok": True,
        "submit_ms": submit_ms,
        "server_ms": int((t_done - (t_running or t0)) * 1000),  # running→done 服务端处理
        "queue_ms": int(((t_running or t_done) - t0) * 1000),   # 提交→running 排队
        "download_ms": download_ms,
        "total_ms": total_ms,
        "polls": polls,
        "upload_kb": len(body_bytes) / 1024,
        "md_chars": md_chars,
        "layout_hits": layout_parsing_hits,
        "result_keys": sorted(result_keys),
        "preview": preview_lines,
    }


def _print(r: dict):
    if not r.get("ok"):
        print(f"  [{r['label']}] FAIL: {r.get('error')} (总 {r.get('total_ms', '?')}ms)")
        return
    flag = "✅" if r["layout_hits"] > 0 else "❌ 无 layoutParsingResults"
    print(f"  [{r['label']}]")
    print(f"      总={r['total_ms']}ms  (排队={r['queue_ms']}ms 服务端={r['server_ms']}ms "
          f"下载={r['download_ms']}ms 提交={r['submit_ms']}ms, 轮询{r['polls']}次)")
    print(f"      上传={r['upload_kb']:.0f}KB  markdown字符={r['md_chars']}  layoutParsingResults×{r['layout_hits']} {flag}")
    print(f"      result字段={r['result_keys']}")
    if r["preview"]:
        print(f"      预览: {' ⏎ '.join(r['preview'][:4])[:120]}")


def main():
    ap = argparse.ArgumentParser(description="PaddleOCR-VL-1.6 optionalPayload 优化实测")
    ap.add_argument("images", nargs="+", help="测试图片绝对路径")
    ap.add_argument("--configs", default="ABCD", help="要跑的配置字母组合，默认 ABCD")
    args = ap.parse_args()

    if not PADDLE_TOKEN:
        print("⚠️  请先设置环境变量 PADDLE_OCR_TOKEN")
        sys.exit(1)

    want = args.configs.upper()
    selected = [c for c in CONFIGS if c[0][0] in want]
    if not selected:
        print(f"[!] --configs={want} 未匹配到任何配置")
        sys.exit(1)

    for img in args.images:
        if not os.path.isfile(img):
            print(f"[!] 跳过不存在的文件: {img}")
            continue
        print(_hr("="))
        print(f"图片: {img}  ({os.path.getsize(img)/1024:.1f} KB)")
        print(_hr("="))
        results = []
        for label, payload, do_compress in selected:
            print(f"\n[{label}] optionalPayload={json.dumps(payload, ensure_ascii=False)}"
                  + ("  + 压缩1600/q80" if do_compress else ""))
            try:
                r = run_one(img, payload, label, do_compress)
            except Exception as e:
                r = {"label": label, "ok": False, "error": f"异常: {e}", "total_ms": 0}
            results.append(r)
            _print(r)

        # 汇总
        print("\n" + _hr())
        print("汇总（按总耗时排序）：")
        ok = [r for r in results if r.get("ok")]
        ok.sort(key=lambda x: x["total_ms"])
        base = next((r for r in results if r["label"].startswith("A") and r.get("ok")), None)
        for r in ok:
            extra = ""
            if base and r["label"].startswith("A") is False:
                delta = r["total_ms"] - base["total_ms"]
                pct = (delta / base["total_ms"] * 100) if base["total_ms"] else 0
                extra = f"  vs现状 {delta:+d}ms ({pct:+.0f}%)"
            safe = "" if r["layout_hits"] > 0 else "  ⚠️结构缺失"
            print(f"  {r['label']:<16} 总={r['total_ms']:>6}ms  字符={r['md_chars']:>5}{extra}{safe}")
        for r in results:
            if not r.get("ok"):
                print(f"  {r['label']:<16} FAIL  {r.get('error')}")


if __name__ == "__main__":
    main()
