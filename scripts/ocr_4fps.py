"""纯 OCR 字幕提取 — 4fps 高帧率，捕捉短字幕"""
from paddleocr import PaddleOCR
import subprocess, re, tempfile, shutil
from pathlib import Path
import cv2, numpy as np

VIDEO = r"C:\Users\lhl20\Desktop\youtube_playlist\test_2min.mp4"
SRT_OUT = r"C:\Users\lhl20\Desktop\youtube_playlist\test_2min_ocr4.srt"
FPS = 4
CROP_BOTTOM = 0.35

def ms_to_srt(ms):
    h,m = int(ms)//3600000, (int(ms)%3600000)//60000
    s,rem = (int(ms)%60000)//1000, int(ms)%1000
    return f"{h:02d}:{m:02d}:{s:02d},{rem:03d}"

print("="*50)
print("纯OCR @ 4fps")
print("="*50)

ocr = PaddleOCR(lang="en", engine="onnxruntime",
    use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)

tmp = tempfile.mkdtemp(prefix="oc4_")
subprocess.run([
    "ffmpeg","-v","quiet","-y","-i",VIDEO,
    "-vf",f"fps={FPS},crop=iw:ih*{CROP_BOTTOM}:0:ih*(1-{CROP_BOTTOM})",
    f"{tmp}/f_%04d.png"
], check=True)

frames = sorted(Path(tmp).glob("f_*.png"))
print(f"🖼 {len(frames)} 帧 ({FPS}fps)")

# 帧差
prev = cv2.imread(str(frames[0]), cv2.IMREAD_GRAYSCALE).astype(float)
changes = [0]
for i in range(1, len(frames)):
    curr = cv2.imread(str(frames[i]), cv2.IMREAD_GRAYSCALE).astype(float)
    if abs(curr-prev).sum()/(prev.shape[0]*prev.shape[1]*255) > 0.03:
        changes.append(i)
    prev = curr
print(f"🔍 {len(changes)} 变化帧")

# OCR
print("OCR...")
entries = []
last_text = ""
for fi, ci in enumerate(changes):
    t = ci / FPS
    try:
        r = ocr.predict(str(frames[ci]))
        texts = []
        for res in r: texts.extend(res["rec_texts"])
        text = " ".join(texts).strip()
        for w in ["TamNgoaiNgu",".com","http"]:
            text = re.sub(r'\S*'+re.escape(w)+r'\S*','',text,flags=re.I)
        text = re.sub(r'\s+',' ',text).strip()
    except:
        text = ""
    
    if text and text != last_text and re.search(r'[a-zA-Z]{2,}', text) and len(text)>=3:
        entries.append((t, text))
        last_text = text
    
    if (fi+1) % 40 == 0:
        print(f"  [{fi+1}/{len(changes)}] t={t:.0f}s: {text[:60]}")

print(f"📋 {len(entries)} 条")

# 去重+合并
out, idx, i = [], 1, 0
while i < len(entries):
    t, text = entries[i]
    j = i+1
    while j < len(entries) and entries[j][1] == text:
        j += 1
    end_t = entries[j][0] if j < len(entries) else t + 3
    if j == i+1: end_t = max(end_t, t+1.0)
    if end_t-t >= 0.3:
        out.extend([str(idx), f"{ms_to_srt(int(t*1000))} --> {ms_to_srt(int(end_t*1000))}", text, ""])
        idx += 1
    i = j

with open(SRT_OUT,"w",encoding="utf-8") as f:
    f.write("\n".join(out))

print(f"✅ {SRT_OUT} ({idx-1}条)")
for l in out:
    if l and not re.match(r'^\d+$',l) and '-->' not in l:
        print(f"  ▶ [{ms_to_srt(int(entries[0][0]*1000))}] {l[:80]}")
        break
for l in out[-8:]:
    if l and not re.match(r'^\d+$',l) and '-->' not in l:
        print(f"     {l[:80]}")

shutil.rmtree(tmp)
