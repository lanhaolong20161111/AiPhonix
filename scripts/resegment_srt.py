"""按「两个停顿之间的所有内容」重切 SRT —— 停顿对齐的测评对象切分。

原理：
  1. ffmpeg silencedetect 扫视频音轨，得到静音区间表（离线，一次性，不受运行时配乐干扰）；
  2. 显著停顿(>= PAUSE_S)把时间轴切成"一口气"片段，同一片段内的 SRT 块合并为一个测评对象
     —— 连句不再被腰斩，换人台词（间隔大）自然切开；
  3. 块边缘向最近的静音边缘吸附(<=0.8s)，修正 ASR/估算时间戳误差（听原音不再切尾音）；
  4. 超长单元(>MAX_LEN_S 或 >MAX_WORDS)在最大内部停顿处再切，保证孩子跟读负荷。

输出 SRT 首行带 "; PAUSE-ALIGNED v1" 标记，前端 srtParser 据此跳过标点合并(toSentences)。

用法:
  python resegment_srt.py <video.mp4> <in.srt> <out.srt> [--noise-db -35] [--pause 0.35]
"""

import argparse
import re
import subprocess
import sys

NOISE_DB_DEFAULT = -35  # silencedetect 能量阈值（Big Muzzy 配乐较轻，-35dB 可分离对白间隙）
RAW_D_DEFAULT = 0.25    # 采集所有 >=0.25s 静音（用于边缘吸附/超长切分）
PAUSE_DEFAULT = 0.35    # 显著停顿阈值：>=0.35s 静音 = 测评对象边界
MAX_LEN_S = 15.0        # 单个测评对象最长时长
MAX_WORDS = 25          # 单个测评对象最多单词数
SNAP_TOL = 0.8          # 边缘吸附容差（秒）

TIMESTAMP_RE = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*"
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})"
)


def ms(h, m, s, milli):
    return h * 3600000 + m * 60000 + s * 1000 + milli


def srt_time(ms_val):
    h, rem = divmod(int(ms_val), 3600000)
    m, rem = divmod(rem, 60000)
    s, milli = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{milli:03d}"


def parse_srt(path):
    """返回 [(startMs, endMs, text)]，过滤音乐/空块"""
    text = open(path, encoding="utf-8-sig", errors="replace").read()
    blocks = []
    for b in re.split(r"\n\n+|\r\n\r\n+", text.strip()):
        lines = [l.strip() for l in b.strip().splitlines() if l.strip()]
        m = TIMESTAMP_RE.search(" ".join(lines[:2]))
        if not m:
            continue
        start = ms(*map(int, m.group(1, 2, 3, 4)))
        end = ms(*map(int, m.group(5, 6, 7, 8)))
        body = " ".join(lines[2:]) if len(lines) > 2 else ""
        body = re.sub(r"<[^>]*>|\{[^}]*\}|\[[^\]]*\]", "", body).strip()
        if not body or body.replace("♪", "").strip() == "":
            continue
        blocks.append([start, end, body])
    return blocks


def detect_silences(video, noise_db, raw_d):
    """ffmpeg silencedetect → [(start_s, end_s)]（按时间升序）"""
    cmd = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", video,
        "-af", f"silencedetect=noise={noise_db}dB:d={raw_d}",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    log = proc.stderr or ""
    silences, cur_start = [], None
    for line in log.splitlines():
        m = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m:
            cur_start = float(m.group(1))
            continue
        m = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m and cur_start is not None:
            silences.append((cur_start, float(m.group(1))))
            cur_start = None
    if cur_start is not None:  # 片尾静音未闭合
        silences.append((cur_start, float("inf")))
    return silences


def snap_edge(t_ms, silences):
    """把时间点吸附到最近的静音边缘（秒→毫秒），超过容差则原样返回"""
    best, best_d = None, SNAP_TOL * 1000
    for s, e in silences:
        for edge_s in (s, e):
            if edge_s == float("inf"):
                continue
            d = abs(edge_s * 1000 - t_ms)
            if d < best_d:
                best, best_d = edge_s * 1000, d
    return int(best) if best is not None else t_ms


TAIL_PAD = 0.6  # 找不到静音边缘时的尾部保护垫（秒）——音乐段语音拖尾被估早
LEAD_PAD = 0.3  # 头部保护垫


def snap_end(t_ms, silences):
    """句尾吸附（方向敏感）：只认「语音结束」（静音起点）。
    - t 落在静音内 → 收缩到该静音起点（剪掉死气口，不可能切词）；
    - 有更晚的静音起点在容差内 → 延伸到那里（语音还在继续，含进句尾词）；
    - 找不到任何候选（连续音乐段）→ 加 TAIL_PAD 保护垫。
    返回 (毫秒, 是否使用了保护垫)。绝不因吸附把句尾提前切词。"""
    for s, e in silences:
        if s * 1000 <= t_ms <= e * 1000:
            return int(s * 1000), False
    best, best_d = None, SNAP_TOL * 1000
    for s, _e in silences:
        d = s * 1000 - t_ms
        if 0 < d < best_d:
            best, best_d = int(s * 1000), d
    if best is not None:
        return best, False
    return int(t_ms + TAIL_PAD * 1000), True


def snap_start(t_ms, silences):
    """句首吸附（方向敏感）：只认「语音开始」（静音终点）。
    - t 落在静音内 → 推迟到该静音终点（剪掉死气口）；
    - 有更早的静音终点在容差内 → 提前到那里（语音已开始，别切头词）；
    - 找不到任何候选 → 减 LEAD_PAD 保护垫。
    返回 (毫秒, 是否使用了保护垫)。"""
    for s, e in silences:
        if e != float("inf") and s * 1000 <= t_ms <= e * 1000:
            return int(e * 1000), False
    best, best_d = None, SNAP_TOL * 1000
    for _s, e in silences:
        if e == float("inf"):
            continue
        d = t_ms - e * 1000
        if 0 < d < best_d:
            best, best_d = int(e * 1000), d
    if best is not None:
        return best, False
    return int(t_ms - LEAD_PAD * 1000), True


def word_count(text):
    return len([w for w in re.split(r"\s+", text) if w])


def split_unit(unit, blocks, silences, sig_silences):
    """超长单元切分：优先在最大内部停顿切，否则在最近的原始块边界切。返回 [unit]"""
    start, end, text = unit
    dur = (end - start) / 1000
    if dur <= MAX_LEN_S and word_count(text) <= MAX_WORDS:
        return [unit]

    # 候选切点1：单元内部最大静音（不在首尾 0.15s 内）
    inner = [
        (s, e) for s, e in silences
        if s * 1000 > start + 150 and e * 1000 < end - 150
    ]
    if inner:
        s, e = max(inner, key=lambda se: se[1] - se[0])
        cut = (s + e) * 500  # 静音中点
    else:
        # 候选切点2：最接近中点的原始块边界
        mid = (start + end) / 2
        cut = min(
            (b[0] for b in blocks if start + 500 < b[0] < end - 500),
            key=lambda t: abs(t - mid),
            default=None,
        )
        if cut is None:
            return [unit]  # 无法再切，放弃（理论少见）

    left = [b for b in blocks if b[0] < cut]
    right = [b for b in blocks if b[0] >= cut]
    if not left or not right:
        return [unit]

    lu = [start, max(b[1] for b in left), " ".join(b[2] for b in left)]
    ru = [min(b[0] for b in right), end, " ".join(b[2] for b in right)]
    if inner:
        # 切在静音 [s,e] 内：左段止于 s（语音结束），右段起于 e（语音开始）——方向正确，不切词
        lu[1] = max(lu[1], int(s * 1000))
        ru[0] = int(e * 1000)
    return split_unit(lu, left, silences, sig_silences) + split_unit(ru, right, silences, sig_silences)


def resegment(video, srt_in, srt_out, noise_db, pause_s):
    blocks = parse_srt(srt_in)
    if not blocks:
        print("ERROR: no SRT blocks parsed", file=sys.stderr)
        return 1
    print(f"[1/4] SRT 块数: {len(blocks)}，时长 {(blocks[-1][1]-blocks[0][0])/1000:.0f}s")

    silences = detect_silences(video, noise_db, RAW_D_DEFAULT)
    print(f"[2/4] 静音区间(>= {RAW_D_DEFAULT}s): {len(silences)} 个")
    sig = [(s, e) for s, e in silences if e - s >= pause_s]
    print(f"      显著停顿(>= {pause_s}s): {len(sig)} 个")

    # 显著停顿的补集 = "一口气"语音片段；把每个 SRT 块按中点归入片段
    spans = []  # [(span_start, span_end)]
    prev = 0.0
    for s, e in sig:
        if s * 1000 > prev:
            spans.append((prev, s * 1000))
        prev = max(prev, e * 1000)
    spans.append((prev, float("inf")))

    def span_idx(t):
        for i, (a, b) in enumerate(spans):
            if a <= t < b:
                return i
        return len(spans) - 1

    # ── 混合规则分组（停顿 + 标点）──
    # 纯停顿规则会把快节奏对白里不同角色的短句并进来（实测 King→Queen 间隔 <0.35s），
    # 因此：句末标点收尾的块只有间隔极小(<0.25s)才合并；半句被打断的块间隔 <0.7s 就合并（连句修复）。
    MERGE_CONT = 250     # ms：近乎无缝 → 同一口气，无条件合并
    MERGE_MID = 700      # ms：半句中断 + 小间隔 → 连句合并

    def ends_sentence(t):
        t = t.rstrip()
        return bool(t) and t[-1] in ".!?…"

    groups = [[blocks[0]]]
    n_merged = 0
    for b in blocks[1:]:
        g = groups[-1]
        last = g[-1]
        gap = b[0] - last[1]
        cur_words = word_count(" ".join(x[2] for x in g))
        can = gap < MERGE_CONT or (not ends_sentence(last[2]) and gap < MERGE_MID)
        if can and cur_words + word_count(b[2]) <= MAX_WORDS:
            g.append(b)
            n_merged += 1
        else:
            groups.append([b])
    print(f"[3/4] 混合规则分组: {len(groups)} 组（原始 {len(blocks)} 块，合并 {n_merged} 次）")

    # 组内边缘吸附（方向敏感）+ 超长切分
    units = []
    n_pad = 0
    for g in groups:
        start = min(b[0] for b in g)
        end = max(b[1] for b in g)
        text = " ".join(b[2] for b in g)
        start, _ = snap_start(start, silences)
        end, padded = snap_end(end, silences)
        if padded:
            n_pad += 1
        units.extend(split_unit([start, end, text], g, silences, sig))

    # ── 尾部二次扫描：把句尾延伸到「下一单元起点之前的最后一个静音起点」──
    # 场景：唱歌段 whisper 尾估算可偏早 >1.3s，超出吸附容差，0.6s 保护垫仍切词
    # （实测 "and some grapes" 拖唱被切）。下一单元起点已吸附到语音开始，
    # 因此它与本单元句尾之间的静音起点必然属于本单元的拖尾，延伸绝不吃到下一句的词。
    n_ext = 0
    for i in range(len(units) - 1):
        next_start = units[i + 1][0]
        cands = [int(s * 1000) for s, _e in silences
                 if units[i][1] < s * 1000 < next_start - 50]
        if cands:
            new_end = max(cands)
            if new_end > units[i][1]:
                units[i][1] = new_end
                n_ext += 1

    # 写出（带 PAUSE-ALIGNED 头，前端据此跳过 toSentences）
    with open(srt_out, "w", encoding="utf-8") as f:
        f.write("; PAUSE-ALIGNED v1\n\n")
        for i, (start, end, text) in enumerate(units, 1):
            f.write(f"{i}\n{srt_time(start)} --> {srt_time(end)}\n{text}\n\n")

    durs = [(u[1] - u[0]) / 1000 for u in units]
    words = [word_count(u[2]) for u in units]
    print(f"[4/4] 完成: {len(blocks)} 块 → {len(units)} 个测评对象"
          f"（{n_pad} 个尾垫，{n_ext} 个尾二次延伸）")
    print(f"      时长 中位 {sorted(durs)[len(durs)//2]:.1f}s / 最长 {max(durs):.1f}s；"
          f"词数 中位 {sorted(words)[len(words)//2]} / 最多 {max(words)}")
    print("\n=== 最长 5 个单元（检查是否异常）===")
    for u in sorted(units, key=lambda x: x[1] - x[0], reverse=True)[:5]:
        print(f"  {(u[1]-u[0])/1000:5.1f}s [{word_count(u[2]):2d}词] {u[2][:60]}")
    print("\n=== 连句合并样例（前 8 个多块合并）===")
    shown = 0
    for g in groups:
        if len(g) > 1 and shown < 8:
            print(f"  ({len(g)}块) {' / '.join(b[2][:25] for b in g)}")
            shown += 1
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("srt_in")
    ap.add_argument("srt_out")
    ap.add_argument("--noise-db", type=int, default=NOISE_DB_DEFAULT)
    ap.add_argument("--pause", type=float, default=PAUSE_DEFAULT)
    args = ap.parse_args()
    sys.exit(resegment(args.video, args.srt_in, args.srt_out, args.noise_db, args.pause))


if __name__ == "__main__":
    main()
