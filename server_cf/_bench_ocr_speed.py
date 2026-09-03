#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
三个 OCR/多模态引擎识别速度对比基准

测试引擎：
  1. PP-OCRv6           （PaddleOCR aistudio，纯检测 + 文本行）
  2. PaddleOCR-VL-1.6   （PaddleOCR aistudio，文档 OCR，markdown 排版）
  3. Doubao doubao-seed-2-1-turbo-260628（火山方舟 ARK，多模态识图）

用法：
  # 跑全部三个
  python _bench_ocr_speed.py <image1> [image2 ...]

  # 只跑 Paddle 两个模型（无需 ARK key）
  python _bench_ocr_speed.py --no-doubao <image1> [image2 ...]

  # 跑豆包（需 ARK_API_KEY 环境变量）
  set ARK_API_KEY=xxx-xxx    (Windows)
  export ARK_API_KEY=xxx-xxx  (bash)
  python _bench_ocr_speed.py <image1>

输出：每个引擎每张图 → 提交耗时、轮询耗时、下载 JSONL 耗时、总耗时、产物大小/字符数。

依赖：pip install requests
"""
import json
import os
import sys
import time
import argparse
import requests
from typing import Tuple

JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
# Token 从环境变量读，避免明文硬编码到仓库
# 设置方式：export PADDLE_OCR_TOKEN=xxx (bash) 或 set PADDLE_OCR_TOKEN=xxx (Windows)
PADDLE_TOKEN = os.environ.get("PADDLE_OCR_TOKEN", "")

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DOUBAO_MODEL = "doubao-seed-2-1-turbo-260628"
# 简单的识图提示词：把图中所有文字逐行保真转录（与生产 DOUBAO_OCR_PROMPT 等效）
DOUBAO_PROMPT = "请把图中所有文字按行逐字转录，不要总结、不要遗漏、不要改字。如果是语文课本/识字卡，每行一行，保留所有标点和拼音。"
# 也可换成结构化 JSON 提示词测试，但 JSON 解析会引入误差，这里只测纯文本耗时


def _hr() -> str:
    return "-" * 72


def _fmt_ms(t: int) -> str:
    return f"{t}ms" if t < 60_000 else f"{t/1000:.2f}s"


def run_paddle_model(image_path: str, model: str, optional_payload: dict, label: str) -> dict:
    """PaddleOCR aistudio：提交任务 → 轮询 → 下载 jsonl。返回每阶段耗时。"""
    headers = {"Authorization": f"bearer {PADDLE_TOKEN}"}
    data = {"model": model, "optionalPayload": json.dumps(optional_payload)}
    overall_t0 = time.time()
    with open(image_path, "rb") as f:
        files = {"file": f}
        submit = requests.post(JOB_URL, headers=headers, data=data, files=files)
    submit_ms = int((time.time() - overall_t0) * 1000)
    if submit.status_code != 200:
        return {"engine": label, "ok": False, "submit_ms": submit_ms, "poll_ms": 0, "download_ms": 0, "total_ms": submit_ms,
                "error": f"submit HTTP {submit.status_code}: {submit.text[:200]}"}
    job_id = submit.json()["data"]["jobId"]
    print(f"  [{label}] 提交 jobId={job_id} ({submit_ms}ms)，开始轮询…")

    poll_t0 = time.time()
    jsonl_url = ""
    polls = 0
    while True:
        rr = requests.get(f"{JOB_URL}/{job_id}", headers=headers)
        polls += 1
        if rr.status_code != 200:
            return {"engine": label, "ok": False, "submit_ms": submit_ms, "poll_ms": int((time.time() - poll_t0) * 1000),
                    "download_ms": 0, "total_ms": int((time.time() - overall_t0) * 1000),
                    "error": f"poll HTTP {rr.status_code}", "polls": polls}
        d = rr.json()["data"]
        state = d.get("state")
        if state == "done":
            jsonl_url = d.get("resultUrl", {}).get("jsonUrl", "")
            break
        if state == "failed":
            return {"engine": label, "ok": False, "submit_ms": submit_ms, "poll_ms": int((time.time() - poll_t0) * 1000),
                    "download_ms": 0, "total_ms": int((time.time() - overall_t0) * 1000),
                    "error": f"任务失败: {d.get('errorMsg')}", "polls": polls}
        time.sleep(2)
    poll_ms = int((time.time() - poll_t0) * 1000)
    if not jsonl_url:
        return {"engine": label, "ok": False, "submit_ms": submit_ms, "poll_ms": poll_ms,
                "download_ms": 0, "total_ms": int((time.time() - overall_t0) * 1000),
                "error": "无 jsonlUrl", "polls": polls}

    # 下载 jsonl（**不要带 Authorization header**，记忆坑点）
    dl_t0 = time.time()
    jr = requests.get(jsonl_url)
    download_ms = int((time.time() - dl_t0) * 1000)
    if jr.status_code != 200:
        return {"engine": label, "ok": False, "submit_ms": submit_ms, "poll_ms": poll_ms, "download_ms": download_ms,
                "total_ms": int((time.time() - overall_t0) * 1000),
                "error": f"jsonl HTTP {jr.status_code}", "polls": polls}

    # 统计
    payload = jr.text.strip()
    text_chars = 0
    block_count = 0
    for line in payload.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line).get("result", {})
            if "layoutParsingResults" in r:  # PaddleOCR-VL-1.6
                for lpr in r["layoutParsingResults"]:
                    text_chars += len(lpr.get("markdown", {}).get("text", ""))
                    block_count += 1
            elif "ocrResults" in r:  # PP-OCRv6
                for oc in r["ocrResults"]:
                    pr = oc.get("prunedResult", {})
                    text_chars += sum(len(s) for s in pr.get("rec_texts", []))
                    block_count += len(pr.get("rec_boxes", []))
        except json.JSONDecodeError:
            pass

    total_ms = int((time.time() - overall_t0) * 1000)
    return {
        "engine": label, "ok": True,
        "submit_ms": submit_ms, "poll_ms": poll_ms, "download_ms": download_ms, "total_ms": total_ms,
        "polls": polls, "text_chars": text_chars, "blocks": block_count, "jsonl_bytes": len(payload),
    }


def run_doubao(image_path: str, api_key: str) -> dict:
    """豆包 doubao-seed-2-1-turbo-260628 多模态识图（OpenAI 兼容 chat completions）。"""
    if not api_key:
        return {"engine": "doubao", "ok": False, "total_ms": 0, "error": "未提供 ARK_API_KEY"}
    overall_t0 = time.time()
    # 读图 → base64
    with open(image_path, "rb") as f:
        b64 = __import__("base64").b64encode(f.read()).decode("ascii")
    suffix = image_path.lower().split(".")[-1]
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(suffix, "image/jpeg")
    body = {
        "model": DOUBAO_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {"type": "text", "text": DOUBAO_PROMPT},
            ],
        }],
        "max_tokens": 1024,
    }
    try:
        r = requests.post(
            f"{ARK_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body, timeout=180,
        )
    except requests.Timeout:
        return {"engine": "doubao", "ok": False, "total_ms": int((time.time() - overall_t0) * 1000), "error": "180s 超时"}
    total_ms = int((time.time() - overall_t0) * 1000)
    if r.status_code != 200:
        return {"engine": "doubao", "ok": False, "total_ms": total_ms,
                "error": f"HTTP {r.status_code}: {r.text[:200]}"}
    j = r.json()
    text = j.get("choices", [{}])[0].get("message", {}).get("content", "")
    usage = j.get("usage", {})
    return {
        "engine": "doubao", "ok": True, "total_ms": total_ms,
        "text_chars": len(text), "blocks": text.count("\n") + (1 if text else 0),
        "tokens_in": usage.get("prompt_tokens", 0), "tokens_out": usage.get("completion_tokens", 0),
        "preview": text[:200].replace("\n", "⏎"),
    }


def main():
    ap = argparse.ArgumentParser(description="三个 OCR/多模态引擎识别速度对比")
    ap.add_argument("images", nargs="+", help="测试图片绝对路径列表")
    ap.add_argument("--no-doubao", action="store_true", help="只跑 PaddleOCR 两个模型")
    ap.add_argument("--ark-key", default=os.environ.get("ARK_API_KEY", ""), help="ARK_API_KEY（也可走环境变量）")
    args = ap.parse_args()

    # 检查 PaddleOCR token（--no-doubao 也需要它来跑 PaddleOCR）
    if not PADDLE_TOKEN:
        print("⚠️  未设置 PADDLE_OCR_TOKEN 环境变量，PaddleOCR 两个模型会全部跳过。")
        print("   设置方式: set PADDLE_OCR_TOKEN=xxx (Windows) / export PADDLE_OCR_TOKEN=xxx (bash)")
        if args.no_doubao:
            sys.exit(1)

    for img in args.images:
        if not os.path.isfile(img):
            print(f"[!] 跳过不存在的文件: {img}")
            continue
        size_kb = os.path.getsize(img) / 1024
        print(_hr())
        print(f"图片: {img}  ({size_kb:.1f} KB)")
        print(_hr())

        results = []
        # 1) PP-OCRv6（轻量检测 + 行文本）
        r = run_paddle_model(
            img, "PP-OCRv6",
            {"useDocOrientationClassify": False, "useDocUnwarping": False, "useTextlineOrientation": False},
            "PP-OCRv6",
        )
        results.append(r)
        _print_result(r)

        # 2) PaddleOCR-VL-1.6（重模型，文档 OCR + markdown）
        r = run_paddle_model(
            img, "PaddleOCR-VL-1.6",
            {"useDocOrientationClassify": False, "useDocUnwarping": False, "useChartRecognition": False},
            "PaddleOCR-VL-1.6",
        )
        results.append(r)
        _print_result(r)

        # 3) 豆包
        if not args.no_doubao:
            if not args.ark_key:
                print("\n[3/3] 豆包 doubao-seed-2-1-turbo-260628 — 跳过（未提供 ARK_API_KEY，可设环境变量后重跑）")
            else:
                r = run_doubao(img, args.ark_key)
                _print_result(r)
                results.append(r)

        # 总结对比
        print(_hr())
        print("本张图汇总（按总耗时排序）：")
        results.sort(key=lambda x: x.get("total_ms", 1_000_000))
        for r in results:
            if r.get("ok"):
                print(f"  {r['engine']:<22}  {r['total_ms']:>6}ms  (字符={r.get('text_chars', '?')}, 块={r.get('blocks', '?')})")
            else:
                print(f"  {r['engine']:<22}  FAIL   ({r.get('error', '?')})")


def _print_result(r: dict):
    name = r["engine"]
    if r.get("ok"):
        # 拆解每阶段
        parts = [f"总={r['total_ms']}ms"]
        if "submit_ms" in r and "poll_ms" in r and "download_ms" in r:
            parts.append(f"submit={r['submit_ms']}ms")
            parts.append(f"poll={r['poll_ms']}ms({r.get('polls', '?')}次)")
            parts.append(f"download={r['download_ms']}ms")
        if "text_chars" in r:
            parts.append(f"字符={r['text_chars']}")
        if "blocks" in r and r["blocks"] is not None:
            parts.append(f"块/行={r['blocks']}")
        if "tokens_in" in r:
            parts.append(f"in={r['tokens_in']}tok out={r['tokens_out']}tok")
        print(f"  [{name}] {' | '.join(parts)}")
        if "preview" in r and r["preview"]:
            print(f"      预览: {r['preview']}")
    else:
        print(f"  [{name}] FAIL: {r.get('error', '?')} (总 {r.get('total_ms', '?')}ms)")


if __name__ == "__main__":
    main()
