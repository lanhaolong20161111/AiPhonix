#!/usr/bin/env python3
"""
图片文字识别→复制到桌面指定文件夹
扫描指定目录下的图片，识别图片中的中文/英文文字，将图片复制到桌面 word_images/ 目录并重命名。

用法：
  python ocr_rename.py                              # 从 Downloads 扫图，输出到桌面 word_images/
  python ocr_rename.py D:/图片目录                    # 指定源目录
  python ocr_rename.py --output D:/out               # 指定输出目录
  python ocr_rename.py --dry-run                     # 仅预览，不复制
  python ocr_rename.py --ext .jpg,.png               # 只处理特定扩展名
"""

import os
import sys
import re
import shutil

try:
    from PIL import Image
    import easyocr
    import numpy as np
except ImportError as e:
    print(f"缺少依赖: {e}")
    print("请先安装: pip install pillow easyocr")
    sys.exit(1)

# ── 配置 ──
DEFAULT_SRC = os.path.expanduser("~/Downloads")
DEFAULT_DST = os.path.join(os.path.expanduser("~/Desktop"), "word_images")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"}
MIN_CONFIDENCE = 0.3

def find_images(directory: str, exts: set) -> list:
    images = []
    for root, _, files in os.walk(directory):
        for f in files:
            if os.path.splitext(f)[1].lower() in exts:
                images.append(os.path.join(root, f))
    return sorted(images)

def sanitize_filename(text: str) -> str:
    """清理文本，去掉不可用于文件名的字符。保留中英文、数字、下划线。"""
    # 允许中文（\u4e00-\u9fff）、英文字母、数字、下划线、连字符
    name = re.sub(r'[^\u4e00-\u9fff\w\-]', '', text.replace(' ', '_'))
    return name.strip('_') or "unknown"

def pick_best_text(results: list) -> str | None:
    """
    从 EasyOCR 结果中挑选最可能的文字。
    优先中文（多个字符拼接），其次英文单词。
    """
    chinese_parts = []   # (text, conf)
    english_words = []   # (conf, text)

    for bbox, text, conf in results:
        t = text.strip()
        if not t:
            continue

        # 判断是否含中文
        has_zh = bool(re.search(r'[\u4e00-\u9fff]', t))
        if has_zh:
            # 只保留中文字符（去掉标点空格等）
            zh_only = re.sub(r'[^\u4e00-\u9fff]', '', t)
            if zh_only:
                chinese_parts.append((zh_only, conf))
        else:
            # 纯英文
            if re.match(r'^[a-zA-Z\']+$', t):
                english_words.append((conf, t.lower()))

    # 优先：中文字 > 英文字（通常图片中的中文大字是主要信息）
    if chinese_parts:
        # 按置信度加权：拼接所有中文片段
        chinese_parts.sort(key=lambda x: -x[1])
        total_text = ''.join(part[0] for part in chinese_parts)
        avg_conf = sum(p[1] * len(p[0]) for p in chinese_parts) / max(len(total_text), 1)
        if avg_conf >= MIN_CONFIDENCE and total_text:
            return total_text

    # 次选：英文单词
    if english_words:
        english_words.sort(key=lambda x: (-x[0], -len(x[1])))
        best = english_words[0]
        if best[0] >= MIN_CONFIDENCE:
            return best[1]

    return None

def main():
    args = sys.argv[1:]

    dry_run = "--dry-run" in args
    if dry_run:
        args.remove("--dry-run")

    # 解析 --output
    dst_dir = DEFAULT_DST
    for arg in args:
        if arg.startswith("--output="):
            dst_dir = arg.split("=", 1)[1]
            args.remove(arg)
            break

    # 解析 --ext
    custom_exts = None
    for arg in args:
        if arg.startswith("--ext="):
            parts = arg.split("=", 1)[1].split(",")
            custom_exts = {e.strip().lower() if e.startswith(".") else f".{e.strip().lower()}" for e in parts}
            args.remove(arg)
            break

    src_dir = args[0] if args else DEFAULT_SRC
    exts = custom_exts or IMAGE_EXTS

    if not os.path.isdir(src_dir):
        print(f"❌ 源目录不存在: {src_dir}")
        sys.exit(1)

    # 确保输出目录存在
    os.makedirs(dst_dir, exist_ok=True)

    # 扫描图片
    images = find_images(src_dir, exts)
    if not images:
        print(f"📭 在 {src_dir} 中未找到图片")
        return

    print(f"🔍 找到 {len(images)} 张图片，初始化 OCR（含中文模型）…")
    reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
    print()

    copied = 0
    skipped = 0

    for img_path in images:
        old_name = os.path.basename(img_path)
        _, ext = os.path.splitext(old_name)

        try:
            # 用 PIL 读取（支持中文路径），转 numpy array 传给 EasyOCR
            with Image.open(img_path) as pil_img:
                # 缩小大图加速 OCR（最大边长 800px）
                w, h = pil_img.size
                if max(w, h) > 800:
                    scale = 800 / max(w, h)
                    pil_img = pil_img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
                img_array = np.array(pil_img.convert("RGB"))
            results = reader.readtext(img_array)
        except Exception as e:
            print(f"  ⚠  OCR 失败 [{old_name}]: {e}")
            skipped += 1
            continue

        text = pick_best_text(results)
        if not text:
            print(f"  ⏭  未识别到文字 [{old_name}]")
            skipped += 1
            continue

        safe_text = sanitize_filename(text)
        new_name = f"{safe_text}{ext}"
        new_path = os.path.join(dst_dir, new_name)

        # 确保不覆盖
        counter = 1
        while os.path.exists(new_path):
            new_name = f"{safe_text}_{counter}{ext}"
            new_path = os.path.join(dst_dir, new_name)
            counter += 1

        if dry_run:
            print(f"  🔄  [{old_name}] → {new_name}  (识别为: '{text}')")
        else:
            try:
                shutil.copy2(img_path, new_path)
                print(f"  ✅  [{old_name}] → {new_name}")
                copied += 1
            except OSError as e:
                print(f"  ❌  复制失败 [{old_name}]: {e}")
                skipped += 1

    print()
    print(f"{'='*50}")
    print(f"📊  完成")
    if dry_run:
        print("  (模拟运行，未实际复制)")
    print(f"  ✅ 已复制: {copied}")
    print(f"  ⏭  跳过: {skipped}")
    print(f"  📂 输出目录: {dst_dir}")
    print(f"  📂 源目录: {src_dir}")

if __name__ == "__main__":
    main()
