"""
PaddleOCR 字幕提取 v3 —— 智能策略
1. 读 whisper SRT → 知道对白时间区间
2. 只在有对白的区间抽帧（节省 >50%）
3. 帧差法找到文字变化的精确帧 → OCR
4. 输出 OCR 文字（与画面100%一致）+ CV精确时间戳
"""

import subprocess, json, os, sys, re, tempfile, shutil
from pathlib import Path
from paddleocr import PaddleOCR
import cv2
import numpy as np

VIDEO = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.mp4"
SRT_WHISPER = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.en.srt"
SRT_OUT = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01_paddle.srt"

CROP_BOTTOM = 0.35
FPS = 2
DIFF_THRESHOLD = 0.03
MARGIN_SEC = 1.5      # 时间窗口前后各留 1.5s
MIN_DURATION_SEC = 0.5
SKIP_WORDS = ["TamNgoaiNgu", ".com", "http"]


def ms_to_srt(ms):
    h = int(ms) // 3600000
    m = (int(ms) % 3600000) // 60000
    s = (int(ms) % 60000) // 1000
    rem = int(ms) % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{rem:03d}"


def parse_srt_time_ranges(path):
    """只提取时间戳（不管文字）"""
    with open(path, "r", encoding="utf-8") as f:
        blocks = f.read().strip().split("\n\n")
    ranges = []
    for b in blocks:
        lines = b.split("\n")
        if len(lines) < 3: continue
        m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", lines[1])
        if not m: continue
        start = int(m[1])*3600+int(m[2])*60+int(m[3])+int(m[4])/1000
        end   = int(m[5])*3600+int(m[6])*60+int(m[7])+int(m[8])/1000
        text  = " ".join(lines[2:]).strip().lower()
        # 跳过音乐标签
        if any(s in text for s in ["(upbeat music)","(cheering)","(groaning)","[music]","♪"]):
            continue
        ranges.append((start, end))
    return ranges


def merge_ranges(ranges):
    """合并重叠的时间区间"""
    if not ranges: return []
    sorted_r = sorted(ranges, key=lambda x: x[0])
    merged = [list(sorted_r[0])]
    for s, e in sorted_r[1:]:
        if s <= merged[-1][1] + 1:  # 间隔 ≤1s 就合并
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return merged


def main():
    print("="*55)
    print("PaddleOCR 字幕提取 v3 (智能区间)")

    # 1. 读 whisper 时间区间
    ranges = parse_srt_time_ranges(SRT_WHISPER)
    print(f"📋 whisper 对白区间: {len(ranges)} 条")
    
    merged = merge_ranges(ranges)
    print(f"📐 合并后: {len(merged)} 个区间")
    
    total_dialogue = sum(e-s for s,e in merged)
    print(f"⏱  对白总时长: {total_dialogue:.0f}s (~{100*total_dialogue/903:.0f}%)")
    
    # 2. 初始化 OCR
    print("🔧 加载 PaddleOCR ...")
    ocr = PaddleOCR(lang="en", engine="onnxruntime",
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False)
    print("   ✅ 就绪")
    
    # 3. 对每个区间抽帧 + 帧差 + OCR
    all_frames = []  # [(abs_time, frame_path)]
    tmp = tempfile.mkdtemp(prefix="pdl3_")
    
    for ri, (s, e) in enumerate(merged):
        s_margin = max(0, s - MARGIN_SEC)
        e_margin = min(903.3, e + MARGIN_SEC)
        
        subprocess.run([
            "ffmpeg", "-v", "quiet", "-y",
            "-ss", str(s_margin), "-to", str(e_margin),
            "-i", VIDEO,
            "-vf", f"fps={FPS},crop=iw:ih*{CROP_BOTTOM}:0:ih*(1-{CROP_BOTTOM})",
            f"{tmp}/r{ri:03d}_%04d.png"
        ], check=True)
        
        seg_frames = sorted(Path(tmp).glob(f"r{ri:03d}_*.png"))
        for fi, fp in enumerate(seg_frames):
            abs_t = s_margin + fi / FPS
            all_frames.append((abs_t, str(fp)))
    
    all_frames.sort(key=lambda x: x[0])
    print(f"🖼  共提取 {len(all_frames)} 帧 (有对白区域)")
    
    # 4. 帧差法找变化帧
    print("📊 帧差检测...")
    prev_path = all_frames[0][1]
    prev = cv2.imread(prev_path, cv2.IMREAD_GRAYSCALE).astype(float)
    change_idxs = [0]
    
    for i in range(1, len(all_frames)):
        curr = cv2.imread(all_frames[i][1], cv2.IMREAD_GRAYSCALE).astype(float)
        diff = abs(curr - prev).sum() / (prev.shape[0]*prev.shape[1]*255)
        if diff > DIFF_THRESHOLD:
            change_idxs.append(i)
        prev = curr
    
    print(f"🔍 {len(change_idxs)} 帧需要 OCR")
    
    # 5. OCR（带缓存）
    cache_path = tmp + "/ocr_cache.json"
    cache = {}
    if os.path.exists(cache_path):
        import json as jmod
        cache = jmod.load(open(cache_path))
        print(f"📦 加载缓存: {len(cache)} 条")
    
    print("🔤 OCR...")
    entries = []
    last_text = ""
    new_ocr = 0
    
    for fi, ci in enumerate(change_idxs):
        t, path = all_frames[ci]
        
        if path in cache:
            text = cache[path]
        else:
            try:
                result = ocr.predict(path)
                texts = []
                for res in result:
                    texts.extend(res["rec_texts"])
                text = " ".join(texts).strip()
                for sw in SKIP_WORDS:
                    text = re.sub(r'\S*' + re.escape(sw) + r'\S*', '', text, flags=re.IGNORECASE)
                text = re.sub(r'\s+', ' ', text).strip()
                cache[path] = text
                new_ocr += 1
            except:
                text = ""
                cache[path] = ""
        
        if text and text != last_text:
            entries.append((t, text))
            last_text = text
        
        if (fi+1) % 50 == 0:
            print(f"  [{fi+1}/{len(change_idxs)}] t={t:.0f}s: {text[:60]}")
            # 定期保存缓存
            import json as jmod
            jmod.dump(cache, open(cache_path, "w"))
    
    print(f"📋 {len(entries)} 条文字变化")
    
    if not entries:
        print("❌ 未检测到字幕！")
        shutil.rmtree(tmp)
        return
    
    # 6. 去重 → SRT
    out = []; idx = 1; i = 0
    while i < len(entries):
        t, text = entries[i]
        j = i + 1
        while j < len(entries) and entries[j][1] == text:
            j += 1
        # 取下一个不同文字的时间作为结束；单条最少给3秒
        end_t = entries[j][0] if j < len(entries) else t + 3.0
        if j == i + 1 and end_t - t < 2.0:
            end_t = t + 2.0   # 最少显示2秒
        
        # 过滤垃圾文字：单字符、纯中文、纯符号、太短
        has_english = bool(re.search(r'[a-zA-Z]{2,}', text))
        has_chinese = bool(re.search(r'[\u4e00-\u9fff]', text))
        is_valid = has_english and not has_chinese and len(text) >= 3
        if end_t - t >= MIN_DURATION_SEC and is_valid:
            out.extend([f"{idx}", f"{ms_to_srt(int(t*1000))} --> {ms_to_srt(int(end_t*1000))}", text, ""])
            idx += 1
        i = j
    
    with open(SRT_OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    
    print(f"\n✅ {SRT_OUT} — {idx-1} 条")
    print(f"\n前15条:")
    count = 0
    for line in out:
        if line and not re.match(r'^\d+$', line) and '-->' not in line:
            print(f"  {line[:80]}")
            count += 1
            if count >= 15: break
    
    shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
