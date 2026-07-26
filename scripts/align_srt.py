"""将 yt-dlp SRT 字幕文字对齐到 whisper 词级时间戳

算法：滑动窗口 + 文本相似度匹配
- yt-dlp SRT 提供正确文字
- whisper JSON 提供精确时间戳
- 对每个 yt-dlp 句子，在相近时间窗口内找 whisper 最佳匹配
"""
import json, re, argparse

# ── 文本规范化 ──

def normalize(text):
    """小写、去标点、去多余空白"""
    text = text.lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def word_set(text):
    return set(normalize(text).split())

def similarity(a, b):
    """Jaccard 相似度"""
    sa, sb = word_set(a), word_set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)

# ── yt-dlp SRT 解析 ──

def parse_yt_srt(path):
    """解析 yt-dlp SRT，返回 [(from_ms, to_ms, text), ...]
    
    yt-dlp SRT 的特有格式：每条字幕有 2 个相邻条目
    - 10ms 占位符（文字为空或复制前一条）
    - 真正条目（有正常时长）
    
    过滤规则：
    - 去掉 [Music] 标签
    - 去掉时长 <= 100ms 的占位符
    - 合并相邻相同文本
    """
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    
    entries = []
    for block in re.split(r'\n\s*\n', raw.strip()):
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        m = re.match(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*'
                     r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})', lines[1])
        if not m:
            continue
        start = (int(m[1])*3600 + int(m[2])*60 + int(m[3]))*1000 + int(m[4])
        end   = (int(m[5])*3600 + int(m[6])*60 + int(m[7]))*1000 + int(m[8])
        
        text = " ".join(lines[2:]).strip()
        text = re.sub(r'\[Music\]', '', text, flags=re.IGNORECASE)
        text = re.sub(r'^\s*[,.\-]\s*', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        
        if not text:
            continue
        # 过滤占位符：时长极短（<=100ms）
        if end - start <= 100:
            continue
        entries.append((start, end, text))
    
    # 去重：合并相邻相同或高度相似的条目
    merged = []
    for t0, t1, txt in entries:
        if merged and normalize(merged[-1][2]) == normalize(txt):
            merged[-1] = (merged[-1][0], max(t1, merged[-1][1]), merged[-1][2])
        else:
            merged.append((t0, t1, txt))
    
    return merged

# ── whisper JSON 解析 ──

SP_PREFIXES = {"[_BEG_]", "[_TT_", "[_EOT_]", "[_SOF_]", "[_SOT_]", "[_SEP_]", "[_FIL_]", "[_NOISE_]"}
SENT_END_RE = re.compile(r'[.?!]["\')\]}>]*$')

def is_special(text):
    return any(text.startswith(p) for p in SP_PREFIXES)

def is_punct_ish(text):
    return bool(re.fullmatch(r"[\s\W_]+", text))

def is_sentence_ender(text):
    return bool(SENT_END_RE.search(text))

MUSIC = re.compile(
    r"^[\s\"'()\[\]]*((upbeat|cheer|groan|whoosh|growl|music|applause|♪)[\s\w]*|♪+)[\s\"'()\[\]]*$",
    re.IGNORECASE
)

def extract_sentences(tokens):
    """与 json_to_srt.py 一致的逻辑，返回 [(text, from_ms, to_ms), ...]"""
    words = []
    cur, cur_from, cur_to = "", None, None
    
    for t in tokens:
        raw = t["text"]
        if is_special(raw):
            continue
        t_from, t_to = t["offsets"]["from"], t["offsets"]["to"]
        stripped = raw.strip()
        if not stripped:
            continue
        
        if is_punct_ish(stripped):
            if cur and is_sentence_ender(stripped):
                words.append((cur, cur_from, cur_to, True))
                cur, cur_from, cur_to = "", None, None
            continue
        
        if raw.startswith(" "):
            if cur:
                words.append((cur, cur_from, cur_to, False))
            cur, cur_from, cur_to = stripped, t_from, t_to
        else:
            if cur:
                cur += stripped
                cur_to = t_to
            else:
                cur, cur_from, cur_to = stripped, t_from, t_to
    
    if cur:
        words.append((cur, cur_from, cur_to, False))
    
    sentences = []
    buf, buf_from, buf_end = [], None, None
    for text, t0, t1, is_end in words:
        if buf_from is None:
            buf_from = t0
        buf.append(text)
        buf_end = t1
        if is_end:
            sent_text = " ".join(buf).strip()
            if sent_text:
                sentences.append((sent_text, buf_from, buf_end))
            buf, buf_from, buf_end = [], None, None
    
    if buf:
        sent_text = " ".join(buf).strip()
        if sent_text:
            sentences.append((sent_text, buf_from, buf_end))
    
    return sentences

def parse_whisper_json(json_path):
    """从 whisper -ojf JSON 提取句子及其时间戳"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    sentences = []
    for seg in data["transcription"]:
        seg_text = (seg.get("text") or "").strip()
        if MUSIC.match(seg_text):
            continue
        for sent_text, t0, t1 in extract_sentences(seg["tokens"]):
            if sent_text.strip():
                sentences.append((t0, t1, sent_text))
    return sentences

# ── 对齐 ──

def align(whisper_sentences, yt_entries, min_sim=0.25, window_ms=8000):
    """以 whisper 句子为主导：每个 whisper 句子匹配最佳 yt-dlp 文字
    
    返回 [(from_ms, to_ms, yt_text), ...]，使用 whisper 时间戳 + yt-dlp 文字
    """
    result = []
    yt_idx = 0
    
    for w_t0, w_t1, w_text in whisper_sentences:
        # 在 whisper 时间 +- window_ms 内搜索 yt-dlp 条目
        best_sim = 0.0
        best_yt = None
        
        # 向前扫描：跳过已经过去的 yt 条目
        while yt_idx < len(yt_entries) and yt_entries[yt_idx][1] < w_t0 - window_ms:
            yt_idx += 1
        
        # 在窗口内搜索最佳匹配
        for yi in range(yt_idx, len(yt_entries)):
            y_t0, y_t1, y_text = yt_entries[yi]
            if y_t0 > w_t1 + window_ms:
                break
            sim = similarity(w_text, y_text)
            if sim > best_sim:
                best_sim = sim
                best_yt = y_text
        
        if best_yt and best_sim >= min_sim:
            result.append((w_t0, w_t1, best_yt))
        else:
            # 未匹配：仍然保留 whisper 文字和时间（回退）
            result.append((w_t0, w_t1, w_text))
    
    result.sort(key=lambda x: x[0])
    return result


def ms_to_srt(ms):
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    ap = argparse.ArgumentParser(
        description="yt-dlp SRT 文字 + whisper JSON 时间 → 对齐后的 SRT")
    ap.add_argument("whisper_json", help="whisper -ojf JSON 文件")
    ap.add_argument("yt_srt", help="yt-dlp 下载的 SRT 文件")
    ap.add_argument("-o", "--output", help="输出 SRT 路径")
    ap.add_argument("-s", "--min-sim", type=float, default=0.3,
                    help="匹配最小相似度 (0-1, 默认 0.3)")
    ap.add_argument("-w", "--window", type=int, default=5000,
                    help="搜索窗口 ms (默认 5000)")
    args = ap.parse_args()
    
    # 加载两份数据
    yt_entries = parse_yt_srt(args.yt_srt)
    whisper_sentences = parse_whisper_json(args.whisper_json)
    
    print(f"yt-dlp: {len(yt_entries)} entries, whisper: {len(whisper_sentences)} sentences")
    
    # 对齐
    aligned = align(whisper_sentences, yt_entries,
                    min_sim=args.min_sim, window_ms=args.window)
    
    # ── 后处理 ──
    # 过滤纯音效
    SFX_WORDS = {"cheering", "groaning", "growling", "whooshing", "music",
                 "applause", "♪", "♪♪", "weeeeeeee", "eeeeee", "whoosh"}
    filtered = []
    for t0, t1, txt in aligned:
        ws = txt.split()
        if all(w.lower().strip("()[]") in SFX_WORDS for w in ws):
            continue
        # 最小持续时长 300ms
        if t1 <= t0:
            t1 = t0 + 300
        filtered.append((t0, t1, txt))
    
    # 合并连续相同文本
    merged = []
    for t0, t1, txt in filtered:
        if merged and merged[-1][2] == txt and t0 - merged[-1][1] < 3000:
            merged[-1] = (merged[-1][0], t1, txt)
        else:
            merged.append((t0, t1, txt))
    
    aligned = merged
    
    # 统计匹配率（有匹配到 yt-dlp 文字的比例）
    matched = sum(1 for _, _, txt in aligned
                  if any(similarity(txt, w[2]) >= args.min_sim
                         for w in whisper_sentences))
    print(f"Aligned: {len(aligned)} subtitles "
          f"({100*matched//max(1,len(aligned))}% have yt-dlp text match)")
    
    # 输出
    out_path = args.output or re.sub(r'\.srt$', '.aligned.srt', args.yt_srt)
    lines = []
    for i, (t0, t1, txt) in enumerate(aligned, 1):
        lines.append(f"{i}\n{ms_to_srt(t0)} --> {ms_to_srt(t1)}\n{txt}")
    
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n\n".join(lines))
    
    print(f"Output: {out_path}")
    if aligned:
        print(f"  [0] {ms_to_srt(aligned[0][0])} {aligned[0][2][:70]}")
        print(f"  [-1] {ms_to_srt(aligned[-1][0])} {aligned[-1][2][:70]}")


if __name__ == "__main__":
    main()
