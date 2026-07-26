"""从 whisper -ojf JSON 生成 SRT，使用词级时间戳

whisper tokenizer 约定：token 有前导空格 = 新词；无空格 = 子词延续
"""
import json, re, argparse

def ms_to_srt(ms):
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

SP_PREFIXES = {"[_BEG_]", "[_TT_", "[_EOT_]", "[_SOF_]", "[_SOT_]", "[_SEP_]", "[_FIL_]", "[_NOISE_]"}
MAX_WORDS = 12
MUSIC = re.compile(
    r"^[\s\"'()\[\]]*"
    r"((upbeat|cheer|groan|whoosh|growl|music|applause|♪)[\s\w]*"
    r"|♪+)"
    r"[\s\"'()\[\]]*$",
    re.IGNORECASE
)

def is_special(text):
    return any(text.startswith(p) for p in SP_PREFIXES)

def is_punct_ish(text):
    """标点或空白为主的token"""
    return bool(re.fullmatch(r"[\s\W_]+", text))

SENT_END_RE = re.compile(r'[.?!]["\')\]}>]*$')

def is_sentence_ender(text):
    """token 文本是否以句子结束标点结尾（可能后跟引号/括号）"""
    return bool(SENT_END_RE.search(text))

def extract_sentences(tokens):
    """从 token 列表提取 clean words + 句子边界
    
    返回 [(text, from_ms, to_ms), ...] 每个元素是一句
    """
    # Step 1: 将 tokens 合并为 clean words（无标点）
    words = []  # [(text, from_ms, to_ms, sentence_end_flag), ...]
    cur = ""
    cur_from = None
    cur_to = None
    
    for t in tokens:
        raw = t["text"]
        if is_special(raw):
            continue
        
        t_from = t["offsets"]["from"]
        t_to = t["offsets"]["to"]
        stripped = raw.strip()
        
        if not stripped:
            continue
        
        if is_punct_ish(stripped):
            # 标记前一个词的句子结束
            if cur and is_sentence_ender(stripped):
                words.append((cur, cur_from, cur_to, True))
                cur = ""
                cur_from = None
                cur_to = None
            # 纯标点跳过（不影响当前词）
            continue
        
        # 真实词 token
        if raw.startswith(" "):
            # 新词开始
            if cur:
                words.append((cur, cur_from, cur_to, False))
            cur = stripped
            cur_from = t_from
            cur_to = t_to
        else:
            # 子词延续
            if cur:
                cur += stripped
                cur_to = t_to
            else:
                cur = stripped
                cur_from = t_from
                cur_to = t_to
    
    if cur:
        words.append((cur, cur_from, cur_to, False))
    
    # Step 2: 将 words 按 sentence_end 标志切分成句子
    sentences = []
    buf = []
    buf_from = None
    buf_end = None
    
    for text, t0, t1, is_end in words:
        if buf_from is None:
            buf_from = t0
        buf.append(text)
        buf_end = t1
        
        if is_end:
            sent_text = " ".join(buf).strip()
            if sent_text:
                sentences.append((sent_text, buf_from, buf_end))
            buf = []
            buf_from = None
            buf_end = None
    
    if buf:
        sent_text = " ".join(buf).strip()
        if sent_text:
            sentences.append((sent_text, buf_from, buf_end))
    
    return sentences


def main():
    ap = argparse.ArgumentParser(
        description="whisper -ojf JSON → 按句切分 SRT（词级时间戳，非线性插值）")
    ap.add_argument("json", help="whisper -ojf JSON 文件路径")
    ap.add_argument("-o", "--output", help="输出 SRT 路径")
    ap.add_argument("-w", "--max-words", type=int, default=MAX_WORDS,
                    help=f"每段最大词数 (默认: {MAX_WORDS})")
    ap.add_argument("--min-dur", type=int, default=300,
                    help="最短字幕时长 (ms), 默认 300")
    args = ap.parse_args()
    
    with open(args.json, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    out = args.output or re.sub(r'\.json$', '.wt.srt', args.json)
    max_w = args.max_words
    min_dur = args.min_dur
    
    # 音效/拟声词过滤（单独成句时过滤）
    SFX_WORDS = {"cheering", "groaning", "growling", "whooshing", "music",
                 "applause", "♪", "♪♪", "weeeeeeee", "eeeeee", "whoosh"}
    # 词级过滤：从句子中移除 SFX 词
    WORD_SFX = {"weeeeeeee", "eeeeee", "whoosh", "♪", "♪♪"}
    
    entries = []
    for seg in data["transcription"]:
        seg_text = (seg.get("text") or "").strip()
        if MUSIC.match(seg_text):
            continue
        
        sentences = extract_sentences(seg["tokens"])
        
        for sent_text, t0, t1 in sentences:
            ws = sent_text.split()
            if not ws:
                continue
            # 词级过滤：移除 SFX 词
            ws = [w for w in ws if w.lower().strip("()[]") not in WORD_SFX]
            if not ws:
                continue
            sent_text = " ".join(ws)
            # 过滤纯音效句
            if all(w.lower().strip("()[]") in SFX_WORDS or
                   MUSIC.match(w) for w in ws):
                continue
            # 修正极短时间戳
            if t1 <= t0:
                t1 = t0 + min_dur
            elif t1 - t0 < min_dur:
                t1 = t0 + min_dur
            
            if len(ws) <= max_w:
                if t1 > t0:
                    entries.append((t0, t1, sent_text))
            else:
                dur = t1 - t0
                for i in range(0, len(ws), max_w):
                    chunk = " ".join(ws[i:i+max_w])
                    ct0 = t0 + int(dur * i / len(ws))
                    ct1 = t0 + int(dur * min(i+max_w, len(ws)) / len(ws))
                    if ct1 > ct0:
                        entries.append((ct0, ct1, chunk))
    
    entries.sort(key=lambda x: x[0])
    
    # 合并相邻相同文本
    merged = []
    for t0, t1, txt in entries:
        if merged and merged[-1][2] == txt and t0 - merged[-1][1] < 500:
            merged[-1] = (merged[-1][0], t1, txt)
        else:
            merged.append((t0, t1, txt))
    
    lines = []
    for i, (t0, t1, txt) in enumerate(merged, 1):
        lines.append(f"{i}\n{ms_to_srt(t0)} --> {ms_to_srt(t1)}\n{txt}")
    
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n\n".join(lines))
    
    print(f"Segments: {len(data['transcription'])} -> Subtitles: {len(merged)}")
    print(f"Output: {out}")
    if merged:
        print(f"  [0] {ms_to_srt(merged[0][0])} {merged[0][2][:70]}")
        print(f"  [-1] {ms_to_srt(merged[-1][0])} {merged[-1][2][:70]}")


if __name__ == "__main__":
    main()
