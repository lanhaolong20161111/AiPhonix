"""
快速测试：只处理前2分钟视频，验证 PaddleOCR 字幕质量
"""
from paddleocr import PaddleOCR
import subprocess, json, re, tempfile, shutil
from pathlib import Path
import cv2, numpy as np

VIDEO = r"C:\Users\lhl20\Desktop\youtube_playlist\test_2min.mp4"
SRT_OUT = r"C:\Users\lhl20\Desktop\youtube_playlist\test_2min_ocr.srt"
FPS = 2

def ms_to_srt(ms):
    h, m = int(ms)//3600000, (int(ms)%3600000)//60000
    s, rem = (int(ms)%60000)//1000, int(ms)%1000
    return f"{h:02d}:{m:02d}:{s:02d},{rem:03d}"

print("="*50)
print("PaddleOCR 2分钟快速测试")
print("="*50)

# 时长
r = subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",VIDEO],
                  capture_output=True, text=True)
dur = float(json.loads(r.stdout)["format"]["duration"])
print(f"时长: {dur:.0f}s")

# OCR 引擎
ocr = PaddleOCR(lang="en", engine="onnxruntime",
    use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)

# 抽帧
tmp = tempfile.mkdtemp(prefix="t2m_")
print(f"抽帧 {FPS}fps ...")
subprocess.run([
    "ffmpeg", "-v", "quiet", "-y", "-i", VIDEO,
    "-vf", "fps={0},crop=iw:ih*0.35:0:ih*0.65".format(FPS), f"{tmp}/f_%04d.png"
], check=True)

frames = sorted(Path(tmp).glob("f_*.png"))
print(f"{len(frames)} 帧")

# 帧差
change_idxs = [0]
prev = cv2.imread(str(frames[0]), cv2.IMREAD_GRAYSCALE).astype(float)
for i in range(1, len(frames)):
    curr = cv2.imread(str(frames[i]), cv2.IMREAD_GRAYSCALE).astype(float)
    if abs(curr - prev).sum() / (prev.shape[0]*prev.shape[1]*255) > 0.03:
        change_idxs.append(i)
    prev = curr

print(f"变化帧: {len(change_idxs)}")

# OCR
print("OCR...")
entries = []
last = ""
for fi, ci in enumerate(change_idxs):
    t = ci / FPS
    try:
        r = ocr.predict(str(frames[ci]))
        texts = []
        for res in r:
            texts.extend(res["rec_texts"])
        text = " ".join(texts).strip()
        # 去水印
        for w in ["TamNgoaiNgu",".com"]:
            text = re.sub(r'\S*'+re.escape(w)+r'\S*', '', text, flags=re.I).strip()
        text = re.sub(r'\s+',' ',text)
    except:
        text = ""
    
    if text and text != last and re.search(r'[a-zA-Z]{2,}', text) and len(text) >= 2:
        entries.append((t, text))
        last = text
    
    if (fi+1) % 10 == 0:
        print(f"  [{fi+1}] t={t:.0f}s: {text[:60]}")

print(f"\nOCR结果: {len(entries)} 条")

# 去重 → SRT
out, idx, i = [], 1, 0
while i < len(entries):
    t, text = entries[i]
    j = i + 1
    while j < len(entries) and entries[j][1] == text:
        j += 1
    end_t = entries[j][0] if j < len(entries) else t + 3
    if j == i + 1:
        end_t = max(end_t, t + 2)
    
    if end_t - t >= 0.5:
        out.extend([str(idx), f"{ms_to_srt(int(t*1000))} --> {ms_to_srt(int(end_t*1000))}", text, ""])
        idx += 1
    i = j

with open(SRT_OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print(f"输出: {SRT_OUT} ({idx-1} 条)")

for line in out:
    if line and not re.match(r'^\d+$',line) and '-->' not in line:
        print(f"  ▶ {line}")

shutil.rmtree(tmp)
