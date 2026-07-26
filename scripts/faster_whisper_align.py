"""用 faster-whisper 生成逐词精确 SRT 字幕"""
import sys
from faster_whisper import WhisperModel

video_path = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.mp4"
output_path = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01_fw.srt"

print("⏳ 加载 base.en 模型...")
model = WhisperModel("base.en", device="cpu", compute_type="int8")

print("🎤 转录中（word_timestamps=True）...")
segments, info = model.transcribe(
    video_path,
    word_timestamps=True,
    language="en",
    beam_size=5,
    vad_filter=True,
    vad_parameters=dict(min_silence_duration_ms=500),
)
print(f"   语言: {info.language}  概率: {info.language_probability:.2%}")

entries = []
idx = 1
for seg in segments:
    # 每个 segment 有 word-level timestamps
    if not seg.words:
        continue
    text = seg.text.strip()
    if not text or text.isspace():
        continue
    
    start_ms = int(seg.start * 1000)
    end_ms = int(seg.end * 1000)
    
    def ms_to_srt(ms):
        h = ms // 3600000
        m = (ms % 3600000) // 60000
        s = (ms % 60000) // 1000
        r = ms % 1000
        return f"{h:02d}:{m:02d}:{s:02d},{r:03d}"
    
    entries.append(f"{idx}\n{ms_to_srt(start_ms)} --> {ms_to_srt(end_ms)}\n{text}")
    idx += 1

# 写入文件
with open(output_path, "w", encoding="utf-8") as f:
    f.write("\n\n".join(entries))

print(f"✅ 生成 {len(entries)} 条字幕 → {output_path}")
print(f"   首条: {entries[0].split(chr(10))[-1]}")
print(f"   末条: {entries[-1].split(chr(10))[-1]}")
