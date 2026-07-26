"""
混合方案 v1：whisper 文字 + OCR 精确定时
- whisper SRT → 完整文字（不丢词）
- OCR 在 whisper 时间窗口内扫描 → 找到精确的 appear/disappear 帧

只跑前2分钟测试
"""

from paddleocr import PaddleOCR
import subprocess, json, re, tempfile, shutil
from pathlib import Path
import cv2, numpy as np

VIDEO = r"C:\Users\lhl20\Desktop\youtube_playlist\test_2min.mp4"
SRT_WHISPER = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.en.srt"
SRT_OUT = r"C:\Users\lhl20\Desktop\youtube_playlist\test_2min_hybrid.srt"

CROP_BOTTOM = 0.35
FPS = 4  # 提高到4fps，捕捉短字幕
MARGIN_SEC = 2.0  # 时间窗口前后各2秒

def ms_to_srt(ms):
    h, m = int(ms)//3600000, (int(ms)%3600000)//60000
    s, rem = (int(ms)%60000)//1000, int(ms)%1000
    return f"{h:02d}:{m:02d}:{s:02d},{rem:03d}"

def parse_whisper(path, max_t=120):
    """读 whisper SRT，只取前 N 秒"""
    with open(path, encoding="utf-8") as f:
        blocks = f.read().strip().split("\n\n")
    entries = []
    for b in blocks:
        lines = b.split("\n")
        if len(lines) < 3: continue
        m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", lines[1])
        if not m: continue
        start = int(m[1])*3600+int(m[2])*60+int(m[3])+int(m[4])/1000
        if start > max_t: break
        end = int(m[5])*3600+int(m[6])*60+int(m[7])+int(m[8])/1000
        text = " ".join(lines[2:]).strip()
        if any(s in text.lower() for s in ["(upbeat music)","(cheering)","(groaning)","♪"]):
            continue
        entries.append((start, end, text))
    return entries

def text_similarity(a, b):
    """简单的文本重叠度"""
    a_words = set(re.findall(r'\w+', a.lower()))
    b_words = set(re.findall(r'\w+', b.lower()))
    if not a_words or not b_words: return 0
    return len(a_words & b_words) / max(len(a_words), len(b_words))

print("="*55)
print("混合方案: whisper文字 + OCR精确定时")
print("="*55)

# 1. whisper 文字（前2分钟）
whisper_entries = parse_whisper(SRT_WHISPER, 120)
print(f"📋 whisper: {len(whisper_entries)} 条")
for s,e,t in whisper_entries[:10]:
    print(f"  [{s:.0f}s] {t[:60]}")

# 2. 确定需要扫的时间窗口
if not whisper_entries: exit()

scan_start = max(0, whisper_entries[0][0] - MARGIN_SEC)
scan_end = min(120, whisper_entries[-1][1] + MARGIN_SEC)
print(f"\n🎯 扫描范围: {scan_start:.0f}s → {scan_end:.0f}s ({scan_end-scan_start:.0f}s)")

# 3. 初始化 OCR
print("🔧 PaddleOCR...")
ocr = PaddleOCR(lang="en", engine="onnxruntime",
    use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)

# 4. 抽帧（只在扫描范围内）
tmp = tempfile.mkdtemp(prefix="hyb_")
print(f"🎞 抽帧 {FPS}fps...")
subprocess.run([
    "ffmpeg", "-v", "quiet", "-y",
    "-ss", str(scan_start), "-to", str(scan_end),
    "-i", VIDEO,
    "-vf", f"fps={FPS},crop=iw:ih*{CROP_BOTTOM}:0:ih*(1-{CROP_BOTTOM})",
    f"{tmp}/f_%04d.png"
], check=True)

frames = sorted(Path(tmp).glob("f_*.png"))
print(f"🖼 {len(frames)} 帧")

# 5. 帧差法 → OCR（只 OCR 变化帧）
change_frames = []
prev = cv2.imread(str(frames[0]), cv2.IMREAD_GRAYSCALE).astype(float)
for i in range(1, len(frames)):
    curr = cv2.imread(str(frames[i]), cv2.IMREAD_GRAYSCALE).astype(float)
    if abs(curr-prev).sum()/(prev.shape[0]*prev.shape[1]*255) > 0.03:
        change_frames.append(i)
    prev = curr

print(f"🔍 {len(change_frames)} 变化帧")

# 6. OCR 变化帧
print("🔤 OCR...")
ocr_data = []  # [(abs_time, text)]
for fi, ci in enumerate(change_frames):
    t = scan_start + ci / FPS
    try:
        r = ocr.predict(str(frames[ci]))
        texts = []
        for res in r:
            texts.extend(res["rec_texts"])
        text = " ".join(texts).strip()
        for w in ["TamNgoaiNgu",".com"]:
            text = re.sub(r'\S*'+re.escape(w)+r'\S*','',text,flags=re.I).strip()
        text = re.sub(r'\s+',' ',text)
    except:
        text = ""
    
    if text and re.search(r'[a-zA-Z]{2,}', text):
        ocr_data.append((t, text))
    
    if (fi+1) % 30 == 0:
        print(f"  [{fi+1}] t={t:.0f}s: {text[:50]}")

print(f"📋 OCR: {len(ocr_data)} 条")

# 7. 匹配：每条 whisper → 在时间窗口内找 OCR 最佳匹配
print("\n🎯 匹配 whisper → OCR...")
results = []

for ws, we, wtext in whisper_entries:
    # 搜索 whisper 时间 ± margin
    candidates = [(t, txt) for t, txt in ocr_data 
                  if ws - MARGIN_SEC * 2 <= t <= we + MARGIN_SEC * 2]
    
    # 找最佳文字匹配
    best_match = None; best_score = 0
    for t, txt in candidates:
        score = text_similarity(wtext, txt)
        if score > best_score:
            best_score = score
            best_match = (t, txt)
    
    if best_match and best_score > 0.3:
        # 找到这个文字在 OCR 中的持续时间
        match_text = best_match[1]
        appear_t = best_match[0]
        # 找消失时间：OCR 中下一帧变为不同文字的时间
        disappear_t = we
        for t2, txt2 in ocr_data:
            if t2 > appear_t and text_similarity(match_text, txt2) < 0.5:
                disappear_t = t2
                break
        
        results.append((appear_t, disappear_t, wtext))
        print(f"  ✅ [{appear_t:.1f}s] '{wtext[:50]}' ← OCR='{match_text[:30]}' score={best_score:.2f}")
    else:
        # 没匹配到，保留 whisper 时间戳
        results.append((ws, we, wtext))
        print(f"  ⚠ [{ws:.0f}s] '{wtext[:50]}' (未匹配，保留whisper时间)")

# 8. 输出
out, idx = [], 1
for s, e, t in results:
    if e - s >= 0.3:
        out.extend([str(idx), 
            f"{ms_to_srt(int(s*1000))} --> {ms_to_srt(int(e*1000))}", t, ""])
        idx += 1

with open(SRT_OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print(f"\n✅ {SRT_OUT} ({idx-1} 条)")

# 对比表
print(f"\n{'whisper(原)':<22} {'混合(OCR精确定时)':<22} 文字")
for (ws,we,wt), (rs,re,_) in zip(whisper_entries, results):
    w = f"{ws:.1f}→{we:.1f}"
    r = f"{rs:.1f}→{re:.1f}"
    marker = "★" if abs(rs-ws) > 1 else " "
    print(f"{marker}{w:<21} {r:<21} {wt[:45]}")

shutil.rmtree(tmp)
