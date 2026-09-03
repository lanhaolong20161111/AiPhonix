#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
PaddleOCR 任务诊断：打印提交响应 + 每次轮询的完整返回，定位「卡在哪一态」。

用法：
  set PADDLE_OCR_TOKEN=xxx
  python _paddle_diag.py <image> [--model PaddleOCR-VL-1.6] [--max 60]
"""
import json
import os
import sys
import time
import argparse
import requests

JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
TOKEN = os.environ.get("PADDLE_OCR_TOKEN", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--model", default="PaddleOCR-VL-1.6")
    ap.add_argument("--max", type=int, default=60, help="轮询最长秒数")
    ap.add_argument("--payload", default="", help="optionalPayload JSON（默认服务端缺省）")
    args = ap.parse_args()

    if not TOKEN:
        print("未设置 PADDLE_OCR_TOKEN")
        sys.exit(1)

    headers = {"Authorization": f"bearer {TOKEN}"}
    data = {"model": args.model}
    if args.payload:
        data["optionalPayload"] = args.payload

    print(f"模型={args.model}  图={args.image} ({os.path.getsize(args.image)/1024:.0f}KB)")
    t0 = time.time()
    with open(args.image, "rb") as f:
        files = {"file": (os.path.basename(args.image), f)}
        r = requests.post(JOB_URL, headers=headers, data=data, files=files, timeout=60)
    print(f"提交 HTTP {r.status_code}  ({int((time.time()-t0)*1000)}ms)")
    body = r.text
    print(f"提交响应: {body[:600]}")
    if r.status_code != 200:
        return
    try:
        job_id = r.json()["data"]["jobId"]
    except Exception as e:
        print(f"解析 jobId 失败: {e}")
        return

    print(f"\njobId={job_id}  开始轮询（上限 {args.max}s）")
    last = ""
    while time.time() - t0 < args.max:
        rr = requests.get(f"{JOB_URL}/{job_id}", headers=headers, timeout=30)
        try:
            d = rr.json()
        except Exception:
            print(f"  poll HTTP {rr.status_code} 非JSON: {rr.text[:300]}")
            time.sleep(2)
            continue
        data_node = d.get("data", {})
        state = data_node.get("state")
        elapsed = int(time.time() - t0)
        if state != last:
            print(f"  [{elapsed}s] state={state}  data={json.dumps(data_node, ensure_ascii=False)[:500]}")
            last = state
        else:
            print(f"  [{elapsed}s] state={state}")
        if state == "done":
            print(f"\n完成！jsonUrl={data_node.get('resultUrl', {}).get('jsonUrl', '')}")
            return
        if state == "failed":
            print(f"\n失败：{data_node.get('errorMsg')}")
            return
        time.sleep(2)
    print(f"\n轮询 {args.max}s 仍为 state={last}")


if __name__ == "__main__":
    main()
