"""
CV 字幕时间戳检测 —— 无需 OCR
原理：检测视频底部文字区域像素变化，记录变化帧的精确时间

输入：视频 .mp4 + whisper.cpp SRT（已有文字内容）
输出：SRT with CV精确定时 + whisper 文字

算法：
1. ffmpeg 抽帧（每秒 4 帧）
2. 裁剪底部 25% 区域，转灰度，计算帧间像素差异比例
3. 差异 > 5% → 文字变化事件
4. 连续稳定 > 1秒 → 文字消失
5. 将 whisper SRT 文字按顺序配到 CV 检测的时间窗口
"""

import subprocess, json, os, sys, re, tempfile, shutil
from pathlib import Path

VIDEO = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.mp4"
SRT_IN = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01.en.srt"
SRT_OUT = r"C:\Users\lhl20\Desktop\youtube_playlist\Big_Muzzy_Ep01_cv.srt"
CROP_BOTTOM = 0.25       # 裁剪底部 25%
DIFF_THRESHOLD = 0.05    # 5% 像素变化 = 文字变化
STABLE_GAP_SEC = 0.8     # 稳定 N 秒 = 文字消失
FPS = 4                  # 每秒采样帧数
MIN_DURATION_MS = 300    # 最少字幕持续时间


def parse_srt_texts(path):
    """只提取 SRT 文字（去音乐标签）"""
    with open(path, "r", encoding="utf-8") as f:
        blocks = f.read().strip().split("\n\n")
    texts = []
    for b in blocks:
        lines = b.split("\n")
        if len(lines) < 3:
            continue
        t = " ".join(lines[2:]).strip()
        t_lower = t.lower()
        skip = ["(upbeat music)", "(cheering)", "(groaning)", "[music]", "[applause]", "♪"]
        if any(s in t_lower for s in skip):
            continue
        texts.append(t)
    return texts


def main():
    print(f"📼 视频: {VIDEO}")
    print(f"📝 字幕: {SRT_IN}")
    
    # 1. 读取 whisper 文字
    texts = parse_srt_texts(SRT_IN)
    print(f"📋 文字条目: {len(texts)}")
    
    # 2. ffprobe 获取视频时长
    result = subprocess.run([
        "ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", VIDEO
    ], capture_output=True, text=True)
    info = json.loads(result.stdout)
    duration = float(info["format"]["duration"])
    print(f"⏱  时长: {duration:.1f}s")
    
    # 3. ffmpeg 抽帧到临时目录
    tmp = tempfile.mkdtemp(prefix="muzzy_frames_")
    print(f"🎞  抽帧中 ({FPS}fps)...")
    subprocess.run([
        "ffmpeg", "-v", "quiet", "-i", VIDEO,
        "-vf", f"fps={FPS},crop=iw:ih*{CROP_BOTTOM}:0:ih*(1-{CROP_BOTTOM})",
        "-pix_fmt", "gray", "-fps_mode", "passthrough",
        f"{tmp}/frame_%06d.png"
    ], check=True)
    
    frames = sorted(Path(tmp).glob("frame_*.png"))
    print(f"🖼  共 {len(frames)} 帧")
    
    # 4. 逐帧对比像素差异
    import cv2
    def frame_diff(p1, p2):
        """两帧底部区域的像素差异比例 (0~1)"""
        a = cv2.imread(str(p1), cv2.IMREAD_GRAYSCALE).astype(float)
        b = cv2.imread(str(p2), cv2.IMREAD_GRAYSCALE).astype(float)
        return (abs(a - b).sum() / (a.shape[0] * a.shape[1] * 255))
    
    # 5. 检测文字变化事件
    events = []  # [(frame_idx, time_sec, is_appear), ...]
    prev_diff = 0
    stable_count = 0
    
    for i in range(1, len(frames)):
        t = i / FPS
        diff = frame_diff(frames[i-1], frames[i])
        
        # 大幅变化 = 文字变化事件
        if diff > DIFF_THRESHOLD and prev_diff <= DIFF_THRESHOLD:
            events.append((i, t, True))   # 文字出现
        elif diff <= DIFF_THRESHOLD and prev_diff > DIFF_THRESHOLD:
            events.append((i, t, False))  # 文字消失
        
        prev_diff = diff
    
    print(f"📊 检测到 {len(events)} 个变化事件")
    
    # 6. 配对事件 → 字幕区间
    intervals = []
    i = 0
    while i < len(events):
        ei, et, is_appear = events[i]
        if is_appear:
            # 找下一个消失事件
            for j in range(i+1, len(events)):
                ej, et2, is_appear2 = events[j]
                if not is_appear2 and (et2 - et) >= MIN_DURATION_MS / 1000:
                    intervals.append((et, et2))
                    i = j + 1
                    break
            else:
                intervals.append((et, duration))
                i = len(events)
        else:
            i += 1
    
    print(f"📐 {len(intervals)} 个时间窗口")
    
    # 7. 匹配 whisper 文字到时间窗口
    def ms_to_srt(ms):
        h = int(ms) // 3600000
        m = (int(ms) % 3600000) // 60000
        s = (int(ms) % 60000) // 1000
        r = int(ms) % 1000
        return f"{h:02d}:{m:02d}:{s:02d},{r:03d}"
    
    out_lines = []
    n = min(len(texts), len(intervals))
    print(f"🔗 匹配: {n} 条 (文字{len(texts)} → 窗口{len(intervals)})")
    
    for idx in range(n):
        start_s, end_s = intervals[idx]
        text = texts[idx]
        start_ms = int(start_s * 1000)
        end_ms = int(end_s * 1000)
        out_lines.append(f"{idx+1}")
        out_lines.append(f"{ms_to_srt(start_ms)} --> {ms_to_srt(end_ms)}")
        out_lines.append(text)
        out_lines.append("")
    
    with open(SRT_OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines))
    
    print(f"✅ 输出: {SRT_OUT} ({len(out_lines)//4} 条)")
    
    # 打印前5条对比
    for idx in range(min(5, n)):
        print(f"  [{ms_to_srt(int(intervals[idx][0]*1000))} → {ms_to_srt(int(intervals[idx][1]*1000))}] {texts[idx][:60]}")
    
    # 清理
    shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
