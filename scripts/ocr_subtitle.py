"""
用 Windows 内置 OCR 识别视频底部字幕
算法：
1. ffmpeg 抽帧 (2fps)
2. 帧差法跳过重复帧
3. 仅在文字变化时 OCR
4. 输出 SRT
"""

import subprocess, json, os, sys, re, tempfile, shutil
from pathlib import Path
import asyncio
from winrt.windows.media.ocr import OcrEngine
from winrt.windows.graphics.imaging import BitmapDecoder, SoftwareBitmap
from winrt.windows.storage.streams import DataWriter
from winrt.windows.globalization import Language

VIDEO = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.mp4"
SRT_OUT = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01_ocr.srt"

CROP_BOTTOM = 0.25
FPS = 2                  # 每秒2帧（文字停留时间长，2fps够用）
DIFF_THRESHOLD = 0.05
MIN_STABLE_SEC = 0.8     # 文字稳定N秒后才算一条


async def ocr_file(path):
    """Windows OCR 识别 PNG 文件"""
    stream = await BitmapDecoder.create_with_file_async(path).get_software_bitmap_async()
    engine = OcrEngine.try_create_from_user_profile_languages()
    if not engine:
        engine = OcrEngine.try_create_from_language(Language("en"))
    result = await engine.recognize_async(stream)
    return result.text.strip()


def ms_to_srt(ms):
    h,m,s = int(ms)//3600000, (int(ms)%3600000)//60000, (int(ms)%60000)//1000
    r = int(ms)%1000
    return f"{h:02d}:{m:02d}:{s:02d},{r:03d}"


def main():
    print("="*55)
    print("Windows OCR 字幕提取")
    print("="*55)
    
    result = subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",VIDEO],
                          capture_output=True, text=True)
    duration = float(json.loads(result.stdout)["format"]["duration"])
    print(f"⏱  时长: {duration:.1f}s")
    
    # 抽帧
    tmp = tempfile.mkdtemp(prefix="ocr_frames_")
    print(f"🎞  抽帧 {FPS}fps ...")
    subprocess.run([
        "ffmpeg", "-v", "quiet", "-y",
        "-i", VIDEO,
        "-vf", f"fps={FPS},crop=iw:ih*{CROP_BOTTOM}:0:ih*(1-{CROP_BOTTOM})",
        f"{tmp}/f_%06d.png"
    ], check=True, timeout=300)
    
    frames = sorted(Path(tmp).glob("f_*.png"))
    n_frames = len(frames)
    print(f"🖼  {n_frames} 帧")
    
    # 计算帧间差异（跳过重复 OCR）
    import cv2
    print("📊 检测变化帧...")
    change_frames = [0]  # 第一帧肯定要 OCR
    prev = cv2.imread(str(frames[0]), cv2.IMREAD_GRAYSCALE).astype(float)
    for i in range(1, n_frames):
        curr = cv2.imread(str(frames[i]), cv2.IMREAD_GRAYSCALE).astype(float)
        diff = abs(curr - prev).sum() / (prev.shape[0]*prev.shape[1]*255)
        if diff > DIFF_THRESHOLD:
            change_frames.append(i)
        prev = curr
    
    print(f"🔍 {len(change_frames)} 个变化帧需要 OCR")
    
    # OCR 每个变化帧
    print("🔤 OCR 识别中...")
    entries = []  # [(frame_idx, time_sec, text)]
    last_text = ""
    
    for fi, fidx in enumerate(change_frames):
        t = fidx / FPS
        path = str(frames[fidx])
        try:
            text = asyncio.run(ocr_file(path))
        except Exception as e:
            print(f"  ⚠ 帧{fidx} OCR失败: {e}")
            text = ""
        
        text = text.strip()
        # 清理
        text = re.sub(r'\s+', ' ', text)
        
        if text and text != last_text:
            entries.append((fidx, t, text))
            last_text = text
        
        if (fi+1) % 20 == 0:
            print(f"  ... {fi+1}/{len(change_frames)} [{text[:50] if text else '(空)'}]")
    
    print(f"📋 {len(entries)} 条文字变化")
    
    # 去重 + 合并相近的 → SRT
    out = []
    idx = 1
    i = 0
    while i < len(entries):
        fi, t, text = entries[i]
        # 找同一文字持续到哪帧
        j = i + 1
        while j < len(entries) and entries[j][2] == text:
            j += 1
        end_t = entries[j-1][1] if j < len(entries) else duration
        
        # 至少显示0.5秒
        if end_t - t >= 0.5 and len(text) >= 2:
            out.append(f"{idx}")
            out.append(f"{ms_to_srt(int(t*1000))} --> {ms_to_srt(int(end_t*1000))}")
            out.append(text)
            out.append("")
            idx += 1
        
        i = j
    
    with open(SRT_OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    
    print(f"✅ 输出: {SRT_OUT} ({idx-1} 条)")
    print(f"\n前10条:")
    lines = [l for l in out if l and not re.match(r'^\d+$', l) and '-->' not in l]
    for l in lines[:10]:
        print(f"  {l[:80]}")
    
    shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
