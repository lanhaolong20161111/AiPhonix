"""CV 精确定时字幕 —— 全自动，无需 OCR，无需手工

原理：
  1. 对视频底部字幕区域做帧间差分
  2. 检测像素大幅变化 → 字幕出现/消失事件
  3. 配对事件 → 精确时间窗口（精度 ±250ms @ 4fps）
  4. 按顺序匹配文字序列 → 输出 CV精确时间 + 正确文字

输入：视频 + 文字来源（yt-dlp SRT / whisper JSON / SRT）
输出：CV 精确时间戳的 SRT

速度：全片 15min ≈ 1.5 分钟（只做帧差，不做 OCR）
"""
import subprocess, json, os, sys, re, tempfile, shutil, argparse
import numpy as np
try:
    import cv2
except ImportError:
    print("pip install opencv-python")
    sys.exit(1)
from pathlib import Path

CROP_BOTTOM = 0.25
FPS = 4
DIFF_THRESHOLD = 0.05
MIN_DUR_MS = 300


def ms_to_srt(ms):
    h, ms2 = divmod(int(ms), 3600000)
    m, ms2 = divmod(ms2, 60000)
    s, ms2 = divmod(ms2, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms2:03d}"


def parse_text_source(path):
    """通用文字来源解析：SRT / JSON / 纯文本"""
    ext = os.path.splitext(path)[1].lower()
    texts = []
    
    if ext == '.json':
        # whisper -ojf JSON
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for seg in data.get('transcription', []):
            t = (seg.get('text') or '').strip()
            t = re.sub(r'\[_?\w+\]', '', t)  # 去特殊 token
            t = re.sub(r'\s+', ' ', t).strip()
            if t and not re.match(r'^[\s\"\'()\[\]♪]+$', t):
                texts.append(t)
    else:
        # SRT 格式
        with open(path, 'r', encoding='utf-8') as f:
            raw = f.read()
        for block in re.split(r'\n\s*\n', raw.strip()):
            lines = block.strip().split('\n')
            if len(lines) < 3:
                continue
            t = ' '.join(lines[2:]).strip()
            t = re.sub(r'\[Music\]', '', t, flags=re.IGNORECASE)
            t = re.sub(r'\s+', ' ', t).strip()
            # 过滤纯音乐标签
            skip = {"(upbeat music)", "(cheering)", "(groaning)", "(growling)",
                    "(whooshing)", "(music)", "[music]", "[applause]", "♪", "♪♪"}
            if t.lower() in skip or not t:
                continue
            texts.append(t)
    
    return texts


def extract_timeline(video_path, crop_ratio=CROP_BOTTOM, fps=FPS,
                     diff_thresh=DIFF_THRESHOLD, ref_ratio=0.25):
    """全片帧差扫描 → 变化事件 → 时间窗口
    
    双区域对比策略：
    - 字幕区（底部 crop_ratio%）：检测字幕变化
    - 参考区（顶部 ref_ratio%）：检测场景切换
    - 只有 字幕区变化 >> 参考区变化 才判定为字幕事件
      （两个区域都剧烈变化 = 场景切换 → 忽略）
    """
    # 获取时长
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", video_path],
        capture_output=True, text=True)
    duration = float(json.loads(result.stdout)["format"]["duration"])
    print(f"  Video: {duration:.0f}s")
    
    # 抽两套帧：字幕区 + 参考区
    tmp = tempfile.mkdtemp(prefix="cv_sub_")
    print(f"  Extracting frames @ {fps}fps (subtitle + ref regions)...")
    
    # 字幕区（底部）
    subprocess.run([
        "ffmpeg", "-v", "quiet", "-y", "-i", video_path,
        "-vf", f"fps={fps},crop=iw:ih*{crop_ratio}:0:ih*(1-{crop_ratio})",
        "-pix_fmt", "gray",
        f"{tmp}/sub_%06d.png"
    ], check=True, timeout=300)
    
    # 参考区（顶部）
    subprocess.run([
        "ffmpeg", "-v", "quiet", "-y", "-i", video_path,
        "-vf", f"fps={fps},crop=iw:ih*{ref_ratio}:0:0",
        "-pix_fmt", "gray",
        f"{tmp}/ref_%06d.png"
    ], check=True, timeout=300)
    
    sub_frames = sorted(Path(tmp).glob("sub_*.png"))
    ref_frames = sorted(Path(tmp).glob("ref_*.png"))
    n = min(len(sub_frames), len(ref_frames))
    print(f"  Frames: {n}")
    
    def frame_diff(a_path, b_path):
        a = cv2.imread(str(a_path), cv2.IMREAD_GRAYSCALE).astype(float)
        b = cv2.imread(str(b_path), cv2.IMREAD_GRAYSCALE).astype(float)
        return abs(b - a).sum() / (a.shape[0] * a.shape[1] * 255)
    
    # 计算双区域帧差
    print("  Computing dual-region frame diffs...")
    sub_diffs = np.zeros(n - 1)
    ref_diffs = np.zeros(n - 1)
    for i in range(n - 1):
        sub_diffs[i] = frame_diff(sub_frames[i], sub_frames[i+1])
        ref_diffs[i] = frame_diff(ref_frames[i], ref_frames[i+1])
        if (i + 1) % 500 == 0:
            print(f"    {i+1}/{n-1}")
    
    # 检测字幕变化事件（排除场景切换）
    print("  Detecting subtitle change events (excluding scene cuts)...")
    events = []
    prev_sub_hi = False
    
    for i in range(n - 1):
        t = i / fps
        sub_hi = sub_diffs[i] > diff_thresh
        ref_hi = ref_diffs[i] > diff_thresh
        
        # 场景切换：两个区域都剧烈变化 → 跳过
        is_scene_cut = sub_hi and ref_hi
        
        # 字幕变化：字幕区变化大 且 字幕区/参考区 > 2.0
        sub_only = sub_hi and not ref_hi and sub_diffs[i] > ref_diffs[i] * 2.0
        
        if sub_only and not prev_sub_hi:
            events.append((t, True))   # 字幕出现
        elif not sub_hi and prev_sub_hi and not is_scene_cut:
            events.append((t, False))  # 字幕消失
        
        prev_sub_hi = sub_hi
    
    print(f"  Events: {len(events)} (scene cuts filtered out)")
    
    # 配对 → 时间窗口
    windows = []
    i = 0
    while i < len(events):
        et, is_appear = events[i]
        if is_appear:
            for j in range(i + 1, len(events)):
                ej, is_dis = events[j]
                if not is_dis and (ej - et) * 1000 >= MIN_DUR_MS:
                    windows.append((et, ej))
                    i = j + 1
                    break
            else:
                windows.append((et, duration))
                i = len(events)
        else:
            i += 1
    
    print(f"  Windows: {len(windows)}")
    
    # 清理
    shutil.rmtree(tmp)
    return windows, duration


def smart_match(windows, texts):
    """智能匹配：时间窗口 vs 文字序列
    
    策略：
    - 窗口数 <= 文字数：每个窗口配一个文字（多余的窗口跳过）
    - 窗口数 > 文字数：合并短窗口
    """
    n_win = len(windows)
    n_txt = len(texts)
    
    if n_win <= n_txt:
        # CV 窗口少，裁剪文字
        print(f"  Windows ({n_win}) <= texts ({n_txt}): truncating texts")
        text_idx = max(0, (n_txt - n_win) // 2)  # 从中间开始
        used_texts = texts[text_idx:text_idx + n_win]
        return [(ws, we, txt) for (ws, we), txt in zip(windows, used_texts)]
    
    # 窗口多：合并短窗口（时长 < 500ms 的合并到相邻窗口）
    merged_windows = []
    i = 0
    while i < n_win:
        ws, we = windows[i]
        dur = we - ws
        # 合并后续短窗口
        while dur < 0.5 and i + 1 < n_win:
            i += 1
            _, we2 = windows[i]
            we = we2
            dur = we - ws
        merged_windows.append((ws, we))
        i += 1
    
    n_mw = len(merged_windows)
    print(f"  Merged: {n_win} → {n_mw} windows, {n_txt} texts")
    
    if n_mw <= n_txt:
        crop = n_txt - n_mw
        used_texts = texts[crop:] if crop > 0 else texts
        return [(ws, we, txt) for (ws, we), txt in zip(merged_windows, used_texts)]
    else:
        # 窗口仍然多于文字，均匀采样
        step = n_mw / n_txt
        result = []
        for ti in range(n_txt):
            wi = int(ti * step)
            if wi < n_mw:
                result.append((merged_windows[wi][0], merged_windows[wi][1], texts[ti]))
        return result


def main():
    ap = argparse.ArgumentParser(
        description="CV帧差字幕精确定时 —— 全自动，无需OCR无需手工")
    ap.add_argument("video", help="视频文件路径 (.mp4)")
    ap.add_argument("texts", help="文字来源：yt-dlp SRT / whisper JSON / 普通 SRT")
    ap.add_argument("-o", "--output", help="输出 SRT 路径")
    ap.add_argument("--fps", type=int, default=FPS,
                    help=f"采样帧率 (默认 {FPS})")
    ap.add_argument("--threshold", type=float, default=DIFF_THRESHOLD,
                    help=f"帧差阈值 (默认 {DIFF_THRESHOLD})")
    ap.add_argument("--crop", type=float, default=CROP_BOTTOM,
                    help=f"裁剪底部比例 (默认 {CROP_BOTTOM})")
    args = ap.parse_args()
    
    print("=" * 50)
    print("CV Subtitle Timestamp Detector")
    print("=" * 50)
    
    # 读取文字
    texts = parse_text_source(args.texts)
    print(f"Texts: {len(texts)} entries from {os.path.basename(args.texts)}")
    
    # CV 扫描
    print("\n[CV Scan]")
    windows, duration = extract_timeline(
        args.video, crop_ratio=args.crop, fps=args.fps,
        diff_thresh=args.threshold, ref_ratio=0.25)
    
    # 智能匹配
    print("\n[Matching]")
    matched = smart_match(windows, texts)
    print(f"  Result: {len(matched)} subtitles")
    
    # 输出
    out_path = args.output or os.path.splitext(args.video)[0] + '_cv.srt'
    lines = []
    for i, (ws, we, txt) in enumerate(matched, 1):
        t0 = int(ws * 1000)
        t1 = max(t0 + MIN_DUR_MS, int(we * 1000))
        lines.append(f"{i}\n{ms_to_srt(t0)} --> {ms_to_srt(t1)}\n{txt}")
    
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n\n'.join(lines))
    
    print(f"\nOutput: {out_path}")
    if matched:
        print(f"  [0] {ms_to_srt(int(matched[0][0]*1000))} {matched[0][2][:70]}")
        print(f"  [-1] {ms_to_srt(int(matched[-1][0]*1000))} {matched[-1][2][:70]}")


if __name__ == "__main__":
    main()
