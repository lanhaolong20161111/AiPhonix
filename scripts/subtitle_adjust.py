"""手工字幕时间对齐工具

功能：
  1. 整体偏移  python subtitle_adjust.py in.srt --offset 2.5
  2. 锚点插值  python subtitle_adjust.py in.srt --anchors "3=00:01:05.200,8=00:01:50.000"
  3. 交互标记  python subtitle_adjust.py in.srt --interactive
               逐条显示字幕，按 Enter 记录当前视频时间（需手动播放视频）
  4. Web GUI   python subtitle_adjust.py in.srt --web
"""
import re, sys, argparse, time, json, os

def ms_to_srt(ms):
    h, ms = divmod(int(ms), 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def parse_time(s):
    """解析 'HH:MM:SS.mmm' 或 'MM:SS.mmm' 或秒数"""
    s = s.strip()
    try:
        return float(s) * 1000
    except ValueError:
        pass
    m = re.match(r'(\d+):(\d+)[:.](\d+)', s)
    if m:
        if s.count(':') == 2:
            h, mi, sec = int(m[1]), int(m[2]), float(m[3])
        else:
            h, mi, sec = 0, int(m[1]), float(m[2]+'.'+m[3])
        return (h*3600 + mi*60 + sec) * 1000
    raise ValueError(f"Cannot parse time: {s}")

def read_srt(path):
    """读取 SRT，返回 [(from_ms, to_ms, text), ...]"""
    with open(path, 'r', encoding='utf-8') as f:
        raw = f.read()
    entries = []
    for block in re.split(r'\n\s*\n', raw.strip()):
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue
        m = re.match(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*'
                     r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})', lines[1])
        if not m:
            continue
        t0 = (int(m[1])*3600+int(m[2])*60+int(m[3]))*1000+int(m[4])
        t1 = (int(m[5])*3600+int(m[6])*60+int(m[7]))*1000+int(m[8])
        text = '\n'.join(lines[2:]).strip()
        entries.append((t0, t1, text))
    return entries

def write_srt(entries, path):
    lines = []
    for i, (t0, t1, txt) in enumerate(entries, 1):
        lines.append(f"{i}\n{ms_to_srt(t0)} --> {ms_to_srt(t1)}\n{txt}")
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n\n'.join(lines))

# ── 整体偏移 ──
def apply_offset(entries, offset_sec):
    offset_ms = offset_sec * 1000
    return [(max(0, t0+offset_ms), max(0, t1+offset_ms), txt)
            for t0, t1, txt in entries]

# ── 锚点插值 ──
def apply_anchors(entries, anchors):
    """
    anchors: [(entry_index, correct_time_ms), ...]  1-based index
    对锚点之间的字幕做线性时间变换
    """
    anchors = sorted(anchors, key=lambda x: x[0])
    
    # 验证
    for idx, ct in anchors:
        if idx < 1 or idx > len(entries):
            raise ValueError(f"Anchor index {idx} out of range (1-{len(entries)})")
    
    # 为每个 entry 计算原始中间时间
    orig_mid = [ (t0+t1)/2 for t0, t1, _ in entries ]
    
    # 构建锚点的 (原始时间, 正确时间) 映射
    anchor_points = []
    for idx, ct in anchors:
        orig_t = orig_mid[idx-1]  # 条目中间时间
        anchor_points.append((orig_t, ct))
    
    # 添加边界：第一条字幕保持在0附近，最后一条按比例
    if anchor_points[0][0] > 0:
        # 前面用线性外推
        pass
    
    result = []
    a_idx = 0
    
    for i, (t0, t1, txt) in enumerate(entries):
        mid = orig_mid[i]
        
        # 找到 mid 落在哪两个锚点之间
        while a_idx + 1 < len(anchor_points) and mid > anchor_points[a_idx+1][0]:
            a_idx += 1
        
        if a_idx + 1 < len(anchor_points):
            # 在两个锚点之间：线性插值
            o1, c1 = anchor_points[a_idx]
            o2, c2 = anchor_points[a_idx+1]
            
            if o2 > o1:
                ratio = (mid - o1) / (o2 - o1)
                new_mid = c1 + ratio * (c2 - c1)
            else:
                new_mid = c1
        elif a_idx < len(anchor_points):
            # 在最后一个锚点之后：用最后一个锚点的偏移量
            o1, c1 = anchor_points[a_idx]
            offset = c1 - o1
            new_mid = mid + offset
        else:
            new_mid = mid
        
        # 保持时长不变，平移中间时间
        dur = t1 - t0
        new_t0 = max(0, new_mid - dur/2)
        new_t1 = new_t0 + dur
        
        result.append((new_t0, new_t1, txt))
    
    return result

# ── 交互模式 ──
def interactive_mode(entries):
    """逐条显示字幕，用户可输入新时间或跳过"""
    print("Interactive subtitle adjuster")
    print("Commands: <new_start> [new_end]  |  s=skip  |  q=quit  |  p=prev")
    print("Times: MM:SS.ms or seconds\n")
    
    adjusted = []
    i = 0
    while i < len(entries):
        t0, t1, txt = entries[i]
        print(f"[{i+1}/{len(entries)}] {ms_to_srt(t0)} --> {ms_to_srt(t1)}")
        print(f"  {txt[:80]}")
        
        cmd = input("> ").strip()
        if cmd.lower() == 'q':
            break
        elif cmd.lower() == 's':
            adjusted.append((t0, t1, txt))
            i += 1
        elif cmd.lower() == 'p' and adjusted:
            i -= 1
            adjusted.pop()
        elif not cmd:
            adjusted.append((t0, t1, txt))
            i += 1
        else:
            parts = cmd.split()
            try:
                new_t0 = parse_time(parts[0])
                if len(parts) > 1:
                    new_t1 = parse_time(parts[1])
                else:
                    new_t1 = new_t0 + (t1 - t0)  # keep original duration
                adjusted.append((new_t0, new_t1, txt))
                i += 1
            except ValueError as e:
                print(f"  Error: {e}")
    
    return adjusted

# ── Web GUI ──
WEB_TEMPLATE = r"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Subtitle Adjuster</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font:14px sans-serif; display:flex; height:100vh; background:#1a1a2e; color:#eee; }
  #left { width:360px; overflow-y:auto; padding:10px; border-right:2px solid #333; }
  #right { flex:1; display:flex; flex-direction:column; }
  #video-container { background:#000; }
  video { width:100%; max-height:60vh; }
  #controls { padding:10px; display:flex; gap:10px; align-items:center; }
  button { padding:6px 14px; cursor:pointer; background:#e94560; color:white; border:none; border-radius:4px; }
  button:hover { background:#ff6b81; }
  input { padding:6px 8px; border-radius:4px; border:1px solid #555; background:#16213e; color:#eee; width:100px; }
  .sub { padding:6px 8px; margin:3px 0; border-radius:4px; cursor:pointer; transition:0.15s; }
  .sub:hover { background:#16213e; }
  .sub.active { background:#e94560; }
  .sub .idx { color:#888; font-size:11px; }
  .sub .time { color:#aaa; font-size:11px; }
  .sub .txt { margin-top:2px; }
  #info { padding:10px; color:#aaa; font-size:12px; }
  #offset-row { display:flex; align-items:center; gap:6px; }
  #export-btn { background:#0f3460; }
</style>
</head>
<body>
<div id="left">
  <h3 style="margin-bottom:8px">Subtitles</h3>
  <div id="offset-row" style="margin-bottom:8px">
    <span>Offset:</span>
    <input id="offset" type="number" step="0.1" value="0" style="width:70px"> sec
    <button id="apply-offset" style="background:#0f3460">Apply All</button>
  </div>
  <div style="margin-bottom:8px">
    <button id="mark-start">Mark Start</button>
    <button id="mark-end">Mark End</button>
    <button id="export-btn">Export SRT</button>
  </div>
  <div id="sub-list"></div>
</div>
<div id="right">
  <div id="video-container">
    <video id="video" controls crossorigin="anonymous">
      <source src="/video" type="video/mp4">
    </video>
  </div>
  <div id="info">
    Click a subtitle row to jump. Use Mark Start/End to set new timestamps.
  </div>
</div>

<script>
let subs = SUBTITLES_JSON;
let currentIdx = -1;

function render() {
  let html = '';
  subs.forEach((s, i) => {
    let cls = i === currentIdx ? 'sub active' : 'sub';
    html += `<div class="${cls}" onclick="jump(${i})">
      <div class="idx">#${i+1}</div>
      <div class="time">${ms2str(s[0])} --> ${ms2str(s[1])}</div>
      <div class="txt">${esc(s[2])}</div>
    </div>`;
  });
  document.getElementById('sub-list').innerHTML = html;
}

function ms2str(ms) {
  let h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000),
      s=Math.floor((ms%60000)/1000), r=ms%1000;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+
         String(s).padStart(2,'0')+','+String(r).padStart(3,'0');
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function jump(i) {
  currentIdx = i;
  let v = document.getElementById('video');
  v.currentTime = subs[i][0] / 1000;
  v.play();
  render();
}

document.getElementById('mark-start').onclick = () => {
  if (currentIdx < 0) return;
  let t = document.getElementById('video').currentTime * 1000;
  subs[currentIdx][0] = Math.round(t);
  render();
};

document.getElementById('mark-end').onclick = () => {
  if (currentIdx < 0) return;
  let t = document.getElementById('video').currentTime * 1000;
  subs[currentIdx][1] = Math.round(t);
  render();
};

document.getElementById('apply-offset').onclick = () => {
  let off = parseFloat(document.getElementById('offset').value) * 1000;
  subs.forEach(s => { s[0] += off; s[1] += off; });
  document.getElementById('offset').value = 0;
  render();
};

document.getElementById('export-btn').onclick = async () => {
  let resp = await fetch('/export', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(subs)
  });
  let data = await resp.json();
  alert('Saved: ' + data.path);
};

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 's' && currentIdx >= 0) {
    document.getElementById('mark-start').click();
  } else if (e.key === 'e' && currentIdx >= 0) {
    document.getElementById('mark-end').click();
  } else if (e.key === 'ArrowDown') {
    currentIdx = Math.min(subs.length-1, currentIdx+1);
    jump(currentIdx);
  } else if (e.key === 'ArrowUp') {
    currentIdx = Math.max(0, currentIdx-1);
    jump(currentIdx);
  }
});

render();
</script>
</body>
</html>"""

def web_mode(entries, video_path, srt_path):
    """启动 Flask Web 服务器"""
    try:
        from flask import Flask, request, jsonify, send_file, Response
    except ImportError:
        print("pip install flask  required for --web mode")
        sys.exit(1)
    
    # 把 entries 转成 list of list（JSON 可序列化）
    subs = [[t0, t1, txt] for t0, t1, txt in entries]
    
    app = Flask(__name__)
    
    @app.route('/')
    def index():
        html = WEB_TEMPLATE.replace('SUBTITLES_JSON', json.dumps(subs))
        return html
    
    @app.route('/video')
    def video():
        return send_file(video_path, mimetype='video/mp4')
    
    @app.route('/export', methods=['POST'])
    def export():
        data = request.get_json()
        out_path = srt_path.replace('.srt', '_edited.srt')
        if out_path == srt_path:
            out_path = srt_path + '.edited.srt'
        write_srt([(e[0], e[1], e[2]) for e in data], out_path)
        return jsonify({'path': out_path})
    
    print(f"\n  Open http://localhost:5000 in your browser\n")
    app.run(host='127.0.0.1', port=5000, debug=False)


# ── CLI ──
def main():
    ap = argparse.ArgumentParser(description="手工字幕时间对齐工具")
    ap.add_argument("srt", help="输入 SRT 文件")
    ap.add_argument("-o", "--output", help="输出 SRT 路径")
    ap.add_argument("--offset", type=float, help="整体偏移（秒），正=延迟，负=提前")
    ap.add_argument("--anchors", help='锚点对齐，格式: "3=00:01:05,8=00:01:50"')
    ap.add_argument("--interactive", "-i", action="store_true", help="交互逐条调整")
    ap.add_argument("--web", action="store_true", help="启动 Web GUI（需 Flask + 视频文件）")
    ap.add_argument("--video", help="Web 模式下的视频文件路径")
    ap.add_argument("--list", "-l", action="store_true", help="列出所有字幕")
    args = ap.parse_args()
    
    entries = read_srt(args.srt)
    print(f"Loaded {len(entries)} subtitles from {args.srt}")
    
    out = args.output
    
    if args.list:
        for i, (t0, t1, txt) in enumerate(entries, 1):
            print(f"  [{i:3d}] {ms_to_srt(t0)} --> {ms_to_srt(t1)}  {txt[:60]}")
        return
    
    if args.offset is not None:
        entries = apply_offset(entries, args.offset)
        print(f"Applied offset: {args.offset:+.1f}s")
        out = out or args.srt.replace('.srt', f'_offset{args.offset:+.1f}.srt')
    
    if args.anchors:
        pairs = []
        for part in args.anchors.split(','):
            idx, t = part.strip().split('=')
            pairs.append((int(idx), parse_time(t)))
        entries = apply_anchors(entries, pairs)
        print(f"Applied {len(pairs)} anchors")
        out = out or args.srt.replace('.srt', '_anchored.srt')
    
    if args.interactive:
        entries = interactive_mode(entries)
        out = out or args.srt.replace('.srt', '_edited.srt')
    
    if args.web:
        video = args.video
        if not video:
            # 尝试猜视频文件
            base = os.path.splitext(args.srt)[0]
            for ext in ['.mp4', '.mkv', '.webm']:
                if os.path.exists(base + ext):
                    video = base + ext
                    break
        if not video or not os.path.exists(video):
            print("Error: --video required for web mode (video file not found)")
            sys.exit(1)
        web_mode(entries, video, args.srt)
        return
    
    if out and (args.offset is not None or args.anchors or args.interactive):
        write_srt(entries, out)
        print(f"Wrote {out}")
    elif not args.offset and not args.anchors and not args.interactive and not args.list:
        ap.print_help()

if __name__ == "__main__":
    main()
