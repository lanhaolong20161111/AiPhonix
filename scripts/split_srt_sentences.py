"""后处理 whisper.cpp SRT：将长段落按句子边界切分，时间戳按字符数比例分配"""
import re, sys

path = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01_wcpp.srt"
out_path = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.en.srt"

def parse_srt(text):
    blocks = text.strip().split("\n\n")
    entries = []
    for b in blocks:
        lines = b.split("\n")
        if len(lines) < 3:
            continue
        m = re.match(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})", lines[1])
        if not m:
            continue
        start = int(m[1])*3600000+int(m[2])*60000+int(m[3])*1000+int(m[4])
        end   = int(m[5])*3600000+int(m[6])*60000+int(m[7])*1000+int(m[8])
        text = "\n".join(lines[2:]).strip()
        text = re.sub(r'^[\s,"]+', '', text)
        text = re.sub(r'[\s,"]+$', '', text)
        if not text or text.replace("♪","").strip() == "":
            continue
        entries.append((start, end, text))
    return entries

MAX_WORDS = 12  # 每段最多单词数

def split_sentences(text):
    """按 . ? ! 切分；若无句号则按 MAX_WORDS 个词切分"""
    parts = re.split(r'(?<=[.?!])\s+', text)
    result = []
    for p in parts:
        p = p.strip()
        words = p.split()
        if len(words) <= MAX_WORDS:
            result.append(p)
        else:
            # 按 MAX_WORDS 切片
            chunks = [' '.join(words[i:i+MAX_WORDS]) for i in range(0, len(words), MAX_WORDS)]
            result.extend(chunks)
    return [r for r in result if r]

def ms_to_srt(ms):
    h = ms // 3600000
    m = (ms % 3600000) // 60000
    s = (ms % 60000) // 1000
    r = ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{r:03d}"

with open(path, "r", encoding="utf-8") as f:
    entries = parse_srt(f.read())

print(f"原始条目: {len(entries)}")

new_entries = []
for start, end, text in entries:
    # 跳过纯音乐 / 无意义标签
    skip_words = ["(upbeat music)", "(cheering)", "(groaning)", "♪", "(Music)", "[Music]", "[Applause]"]
    if text.lower() in [w.lower() for w in skip_words] or text.replace("♪","").strip() == "":
        continue
    
    sentences = split_sentences(text)
    total_chars = sum(len(s) for s in sentences)
    duration = end - start
    
    if len(sentences) <= 1 or total_chars == 0:
        new_entries.append((start, end, text))
        continue
    
    # 按字符数比例分配时间戳
    offset = start
    for i, sent in enumerate(sentences):
        ratio = len(sent) / total_chars
        seg_dur = int(duration * ratio)
        seg_end = min(offset + seg_dur, end) if i < len(sentences) - 1 else end
        if seg_end <= offset:
            seg_end = offset + 100  # 最少 100ms
        new_entries.append((offset, seg_end, sent))
        offset = seg_end

new_entries.sort(key=lambda x: x[0])

print(f"切分后条目: {len(new_entries)}")

out = []
for i, (start, end, text) in enumerate(new_entries, 1):
    out.append(f"{i}\n{ms_to_srt(start)} --> {ms_to_srt(end)}\n{text}")

with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n\n".join(out))

print(f"✅ 写入 {out_path}")
print(f"   前3条: {new_entries[0][2][:60]}")
print(f"   后3条: {new_entries[-1][2][:60]}")
