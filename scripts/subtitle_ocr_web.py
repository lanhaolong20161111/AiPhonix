"""交互式字幕 OCR 采集工具（Web）

用法：
  python subtitle_ocr_web.py --video video.mp4 [--port 5000]

操作流程：
  1. 打开 http://localhost:5000
  2. 在视频上用鼠标拖动框选字幕区域（或使用预设区域）
  3. 播放视频，看到字幕变化时按 空格键 暂停
  4. 自动 OCR 识别字幕文字，按 Enter 确认保存
  5. 重复以上步骤采集所有字幕
  6. 导出 SRT 文件

快捷键：
  空格    - 暂停/播放
  Enter   - 确认当前捕获
  S       - 标记开始时间（不 OCR）
  E       - 标记结束时间
  Delete  - 删除当前字幕
  左/右箭头 - 微调时间 ±0.5s
  Ctrl+S  - 导出 SRT
"""
import os, sys, json, re, tempfile, subprocess, time, argparse
from flask import Flask, request, jsonify, send_file, Response, make_response
import cv2
import numpy as np

app = Flask(__name__)

# 全局状态
VIDEO_PATH = None
OCR = None
CROP_CACHE = {}  # {(time_rounded): text}


def init_ocr():
    global OCR
    if OCR is None:
        print("Loading PaddleOCR...")
        from paddleocr import PaddleOCR
        OCR = PaddleOCR(
            lang='en',
            engine='onnxruntime',
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
        print("PaddleOCR ready.")


def extract_frame_at(video_path, time_sec, region=None):
    """提取视频指定时间的帧，可选裁剪区域 region=(x,y,w,h)"""
    # 使用 ffmpeg 快速 seek
    tmp = tempfile.mktemp(suffix='.png')
    filters = []
    if region:
        x, y, w, h = region
        # 需要获取原视频尺寸来确定比例，这里假设前端传的是像素值
        filters.append(f"crop={w}:{h}:{x}:{y}")
    
    vf = ','.join(filters) if filters else None
    cmd = [
        "ffmpeg", "-v", "quiet", "-y",
        "-ss", str(time_sec),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2"
    ]
    if vf:
        cmd.extend(["-vf", vf])
    cmd.append(tmp)
    
    subprocess.run(cmd, check=True, timeout=10)
    
    if not os.path.exists(tmp) or os.path.getsize(tmp) < 100:
        return None
    
    img = cv2.imread(tmp)
    os.unlink(tmp)
    return img


def do_ocr(img, region=None):
    """对图像做 OCR，返回文字列表"""
    global OCR
    if OCR is None:
        init_ocr()
    
    if region:
        x, y, w, h = int(region['x']), int(region['y']), int(region['w']), int(region['h'])
        img = img[y:y+h, x:x+w]
    
    if img is None or img.size == 0:
        return []
    
    # 转为 RGB (PaddleOCR 需要)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    # 保存临时文件（PaddleOCR 需要文件路径或 numpy array）
    # PaddleOCR 3.x 的 predict 支持 numpy array
    try:
        result = OCR.predict(img_rgb)
        texts = []
        if isinstance(result, list):
            for r in result:
                if isinstance(r, dict) and 'rec_texts' in r:
                    texts.extend(r['rec_texts'])
                elif isinstance(r, dict) and 'rec_text' in r:
                    texts.append(r['rec_text'])
        return texts
    except Exception as e:
        print(f"OCR error: {e}")
        return []


def find_text_region(img):
    """自动检测文本区域（用于初次框选）"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    
    # 检测底部区域的活动像素
    bottom = gray[int(h*0.65):, :]
    _, thresh = cv2.threshold(bottom, 200, 255, cv2.THRESH_BINARY)
    
    # 找文字行的上下边界
    rows = np.mean(thresh, axis=1)
    text_rows = np.where(rows > 128)[0]
    
    if len(text_rows) < 10:
        return None
    
    top_row = text_rows[0] + int(h*0.65)
    bottom_row = text_rows[-1] + int(h*0.65)
    
    # 左右边界
    cols = np.mean(thresh, axis=0)
    text_cols = np.where(cols > 128)[0]
    left_col = max(0, text_cols[0] - 20) if len(text_cols) > 0 else 0
    right_col = min(w, text_cols[-1] + 20) if len(text_cols) > 0 else w
    
    return {
        'x': int(left_col),
        'y': int(top_row),
        'w': int(right_col - left_col),
        'h': int(bottom_row - top_row)
    }


# ══════ API 路由 ══════

@app.route('/api/list_dir', methods=['POST'])
def list_dir():
    """列出目录内容"""
    data = request.get_json()
    path = data.get('path', '') or ''
    if not path:
        path = os.path.dirname(VIDEO_PATH) if VIDEO_PATH else os.path.expanduser('~')
    if not os.path.isdir(path):
        path = os.path.dirname(path)
    filter_type = data.get('filter', 'video')  # 'video' | 'srt' | 'all'
    try:
        entries = []
        # 父目录
        parent = os.path.dirname(path)
        if parent != path:
            entries.append({'name': '..', 'path': parent, 'type': 'dir'})
        # 子项
        items = sorted(os.listdir(path), key=lambda x: (not os.path.isdir(os.path.join(path, x)), x.lower()))
        for name in items:
            full = os.path.join(path, name)
            if os.path.isdir(full):
                entries.append({'name': name, 'path': full, 'type': 'dir'})
            elif filter_type == 'all':
                entries.append({'name': name, 'path': full, 'type': 'file', 'size': os.path.getsize(full)})
            elif filter_type == 'srt' and name.lower().endswith('.srt'):
                entries.append({'name': name, 'path': full, 'type': 'srt', 'size': os.path.getsize(full)})
            elif filter_type == 'video' and name.lower().endswith(('.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.ts', '.m4v')):
                entries.append({'name': name, 'path': full, 'type': 'video', 'size': os.path.getsize(full)})
        return jsonify({'ok': True, 'path': path, 'entries': entries, 'filter': filter_type})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/load_srt_file', methods=['POST'])
def load_srt_file():
    """从路径读取 SRT 文件内容"""
    data = request.get_json()
    path = data.get('path', '')
    if not path or not os.path.isfile(path):
        return jsonify({'ok': False, 'error': '文件不存在'}), 404
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({'ok': True, 'path': path, 'content': content})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/')
def index():
    resp = make_response(HTML_PAGE)
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


@app.route('/video')
def serve_video():
    """流式传输视频文件"""
    if not VIDEO_PATH or not os.path.exists(VIDEO_PATH):
        return "Video not found", 404
    
    range_header = request.headers.get('Range')
    file_size = os.path.getsize(VIDEO_PATH)
    
    if range_header:
        byte_range = range_header.replace('bytes=', '').split('-')
        start = int(byte_range[0])
        end = min(int(byte_range[1]), file_size - 1) if byte_range[1] else file_size - 1
        length = end - start + 1
        
        with open(VIDEO_PATH, 'rb') as f:
            f.seek(start)
            data = f.read(length)
        
        resp = Response(data, 206, mimetype='video/mp4')
        resp.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
        resp.headers['Accept-Ranges'] = 'bytes'
        resp.headers['Content-Length'] = str(length)
        return resp
    else:
        resp = send_file(VIDEO_PATH, mimetype='video/mp4')
        resp.headers['Accept-Ranges'] = 'bytes'
        return resp


@app.route('/api/capture', methods=['POST'])
def capture():
    """捕获当前帧并 OCR"""
    data = request.get_json()
    time_sec = data.get('time', 0)
    region = data.get('region')  # {x, y, w, h} 像素坐标
    
    t0 = time.time()
    
    # 提取帧
    img = extract_frame_at(VIDEO_PATH, time_sec, region=None)  # 先取全帧
    if img is None:
        return jsonify({'error': 'Failed to extract frame'}), 500
    
    # OCR
    texts = do_ocr(img, region)
    elapsed = time.time() - t0
    
    text = ' '.join(texts).strip() if texts else ''
    
    # 自动检测区域（如果没有提供 region）
    auto_region = None
    if not region:
        auto_region = find_text_region(img)
    
    return jsonify({
        'text': text,
        'time': time_sec,
        'elapsed': round(elapsed, 2),
        'auto_region': auto_region
    })


@app.route('/api/auto_region', methods=['POST'])
def auto_region():
    """自动检测字幕区域"""
    data = request.get_json()
    time_sec = data.get('time', 60)  # 默认取1分钟处
    
    img = extract_frame_at(VIDEO_PATH, time_sec)
    if img is None:
        return jsonify({'error': 'Failed to extract frame'}), 500
    
    r = find_text_region(img)
    return jsonify({'region': r, 'time': time_sec})


@app.route('/api/open_video', methods=['POST'])
def open_video():
    """切换视频文件"""
    global VIDEO_PATH
    data = request.get_json()
    path = data.get('path', '')
    if not path or not os.path.exists(path):
        return jsonify({'ok': False, 'error': '文件不存在'}), 400
    VIDEO_PATH = os.path.abspath(path)
    return jsonify({'ok': True, 'name': os.path.basename(VIDEO_PATH)})

@app.route('/api/export', methods=['POST'])
def export_srt():
    """导出 SRT 文件"""
    data = request.get_json()
    entries = data.get('entries', [])  # [{start, end, text}, ...]
    
    ts = time.strftime("%Y%m%d_%H%M%S")
    out_path = os.path.splitext(VIDEO_PATH)[0] + f'_ocr_{ts}.srt'
    
    lines = []
    for i, entry in enumerate(entries, 1):
        t0 = float(entry.get('start', 0)) * 1000
        t1 = float(entry.get('end', entry.get('start', 0))) * 1000
        if t1 <= t0:
            t1 = t0 + 500  # 最少 500ms
        text = entry.get('text', '').strip()
        if not text:
            continue
        
        h = int(t0) // 3600000
        m = (int(t0) % 3600000) // 60000
        s = (int(t0) % 60000) // 1000
        ms = int(t0) % 1000
        start_str = f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
        
        h = int(t1) // 3600000
        m = (int(t1) % 3600000) // 60000
        s = (int(t1) % 60000) // 1000
        ms = int(t1) % 1000
        end_str = f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
        
        lines.append(f"{i}\n{start_str} --> {end_str}\n{text}")
    
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n\n'.join(lines))
    
    return jsonify({'path': out_path, 'count': len(entries)})

@app.route('/api/save_srt', methods=['POST'])
def save_srt():
    """覆盖保存 SRT 到视频目录"""
    data = request.get_json()
    filename = data.get('path', 'subtitle.srt')
    entries = data.get('entries', [])
    
    out_path = os.path.join(os.path.dirname(VIDEO_PATH), os.path.basename(filename))
    
    lines = []
    for i, entry in enumerate(entries, 1):
        t0 = float(entry.get('start', 0)) * 1000
        t1 = float(entry.get('end', entry.get('start', 0))) * 1000
        if t1 <= t0:
            t1 = t0 + 500
        text = entry.get('text', '').strip()
        if not text:
            continue
        h0, m0, s0, ms0 = int(t0)//3600000, (int(t0)%3600000)//60000, (int(t0)%60000)//1000, int(t0)%1000
        h1, m1, s1, ms1 = int(t1)//3600000, (int(t1)%3600000)//60000, (int(t1)%60000)//1000, int(t1)%1000
        lines.append(f"{i}\n{h0:02d}:{m0:02d}:{s0:02d},{ms0:03d} --> {h1:02d}:{m1:02d}:{s1:02d},{ms1:03d}\n{text}")
    
    try:
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write('\n\n'.join(lines))
        return jsonify({'ok': True, 'path': out_path, 'count': len(lines)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ══════ HTML 页面 ══════

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>字幕 OCR 采集工具</title>
<style>
:root { --bg: #0d1117; --fg: #c9d1d9; --accent: #58a6ff; --danger: #f85149;
  --panel: #161b22; --border: #30363d; --hover: #1c2128; --success: #3fb950; }

* { box-sizing: border-box; margin: 0; padding: 0; }
body { display: flex; height: 100vh; font: 14px/1.5 system-ui; background: var(--bg); color: var(--fg); }

/* Left: video */
#video-panel { flex: 1; display: flex; flex-direction: column; position: relative; background: #000; min-width: 0; }
#video-wrapper { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
video { max-width: 100%; max-height: 100%; }
#overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: crosshair; }
/* Controls bar */
#controls-bar { padding: 6px 10px; background: var(--panel); border-top: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 4px; }
#controls-bar .row { display: flex; gap: 10px; align-items: center; font-size: 13px; }
#controls-bar .time { color: var(--accent); font-weight: bold; font: 14px monospace; min-width: 95px; }
#controls-bar .time-total { color: #8b949e; font: 13px monospace; }
#progress-wrap { flex: 1; position: relative; height: 20px; display: flex; align-items: center; cursor: pointer; }
#progress-bar { width: 100%; height: 6px; -webkit-appearance: none; appearance: none; background: #30363d;
  border-radius: 3px; outline: none; cursor: pointer; }
#progress-bar::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent); cursor: pointer; border: none; }
#progress-bar::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent); cursor: pointer; border: none; }
.btn-ctrl { padding: 3px 8px; font-size: 13px; border-radius: 4px; background: transparent; border: 1px solid var(--border);
  color: var(--fg); cursor: pointer; min-width: 32px; text-align: center; }
.btn-ctrl:hover { background: #30363d; }
.btn-ctrl:active { background: var(--accent); color: #000; }
.btn-step { font-weight: bold; font-size: 16px; padding: 2px 6px; }

/* Right: panel */
#right-panel { width: 380px; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--panel); }
#right-panel h3 { padding: 12px; border-bottom: 1px solid var(--border); font-size: 15px; }
#region-info { padding: 8px 12px; font-size: 12px; color: #8b949e; border-bottom: 1px solid var(--border); }
#sub-list { flex: 1; overflow-y: auto; }
#sub-list .entry { padding: 6px 8px; border-bottom: 1px solid var(--border); cursor: pointer; transition: .15s; }
#sub-list .entry:hover { background: var(--hover); }
#sub-list .entry.active { background: #1f2937; border-left: 3px solid var(--accent); }
.idx { display: inline-block; color: #58a6ff; font-weight: 600; font-size: 11px; min-width: 22px; }
#sub-list .entry .time-row { display: flex; gap: 3px; align-items: center; font-size: 11px; color: #8b949e; }
#sub-list .entry .time-row input { background: transparent; border: 1px solid var(--border); color: var(--fg);
  font: 11px monospace; padding: 1px 2px; width: 78px; border-radius: 3px; }
#sub-list .entry .txt { font-size: 14px; word-break: break-word; display: flex; align-items: center; }
#capture-preview { padding: 12px; border-top: 1px solid var(--border); min-height: 80px; }
#capture-preview .status { font-size: 12px; color: #8b949e; margin-bottom: 4px; }
#capture-preview .result { font-size: 16px; font-weight: bold; color: var(--success); min-height: 22px; }
#capture-preview .result.pending { color: #d29922; }
#capture-preview .result.error { color: var(--danger); }
#btn-row { padding: 8px 12px; border-top: 1px solid var(--border); display: flex; gap: 8px; }
button { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: #21262d;
  color: var(--fg); cursor: pointer; font-size: 13px; transition: .15s; }
button:hover { background: #30363d; }
button.primary { background: #238636; border-color: #238636; color: #fff; }
button.danger { background: #da3633; border-color: #da3633; color: #fff; }
button.small { padding: 3px 8px; font-size: 11px; }
button.adj { padding: 1px 2px; font-size: 9px; background: #21262d; border: 1px solid var(--border); border-radius: 3px; color: #8b949e; cursor: pointer; line-height: 1; min-width: 14px; text-align: center; }
button.adj:hover { background: #30363d; color: var(--fg); }
#sub-list .entry .time-row input.time-focus { border-color: #58a6ff; box-shadow: 0 0 3px rgba(88,166,255,.4); }

/* Spinner */
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%; animation: spin .6s linear infinite; vertical-align: middle; margin-left: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Progress markers */
#progress-wrap { position: relative; flex: 1; height: 28px; display: flex; align-items: center; }
#marker-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; }
#marker-canvas.clickable { pointer-events: auto; cursor: pointer; }
/* Toast */
#toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #333; color: #fff;
  padding: 8px 20px; border-radius: 8px; font-size: 13px; opacity: 0; transition: .3s; pointer-events: none; z-index: 99; }
#toast.show { opacity: 1; }

/* Video browser modal */
#video-browser-mask { display:none; position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:999; justify-content:center; align-items:center; }
#video-browser { background:var(--bg); border:1px solid var(--border); border-radius:12px; width:600px; max-height:70vh; display:flex; flex-direction:column; overflow:hidden; }
#vb-header { padding:12px 16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
#vb-path { font-size:12px; color:#8b949e; word-break:break-all; flex:1; margin-right:8px; }
#vb-close { background:none; border:none; color:#8b949e; cursor:pointer; font-size:20px; }
#vb-list { flex:1; overflow-y:auto; padding:8px; }
#vb-list div { padding:8px 12px; cursor:pointer; border-radius:6px; font-size:13px; color:var(--text); }
#vb-list div:hover { background:rgba(88,166,255,0.1); }
.vb-dir { color:#58a6ff !important; }
.vb-video { }
</style>
</head>
<body>

<div id="video-panel">
  <div id="video-wrapper">
    <video id="video" controls crossorigin="anonymous">
      <source src="/video" type="video/mp4">
    </video>
    <canvas id="overlay"></canvas>
  </div>
  <div id="controls-bar">
    <div class="row">
      <span class="time" id="vtime">00:00:00.000</span>
      <span class="time-total" id="vtotal">/ 00:00:00.000</span>
      <button class="btn-ctrl btn-step" onclick="stepFrame(-5)" title="后退5帧">⏪5</button>
      <button class="btn-ctrl btn-step" onclick="stepFrame(-1)" title="后退1帧">⏪</button>
      <button class="btn-ctrl" id="btn-play" onclick="togglePlay()">▶</button>
      <button class="btn-ctrl btn-step" onclick="stepFrame(1)" title="前进1帧">⏩</button>
      <button class="btn-ctrl btn-step" onclick="stepFrame(5)" title="前进5帧">5⏩</button>
      <button class="btn-ctrl" onclick="setSpeed(0.25)" id="btn-spd025" title="0.25倍速">0.25x</button>
      <button class="btn-ctrl" onclick="setSpeed(0.5)" id="btn-spd05" title="0.5倍速">0.5x</button>
      <button class="btn-ctrl" onclick="setSpeed(0.75)" id="btn-spd075" title="0.75倍速">0.75x</button>
      <button class="btn-ctrl" onclick="setSpeed(1)" id="btn-spd1" title="正常速度">1x</button>
      <div id="progress-wrap">
        <input type="range" id="progress-bar" min="0" max="1000" value="0" step="0.1">
        <canvas id="marker-canvas"></canvas>
      </div>
    </div>
    <div class="row">
      <span class="hint" style="color:#8b949e;font-size:11px">
        ←→=跳转 · Shift+←→=逐帧 · Ctrl+←→↑↓=移动选框 · Ctrl+Shift+←→↑↓=缩放选框 · R=识别 · Del=删除 · Ctrl+S=导出
      <button onclick="openVideo()" style="margin-left:12px;font-size:11px;padding:2px 8px">📂 打开视频</button>
      </span>
    </div>
  </div>
</div>

<div id="right-panel">
  <h3>字幕列表</h3>
  <div id="region-info">字幕区域：拖动鼠标框选</div>
  <div id="guide-header" style="display:none;padding:6px 12px;font-size:12px;color:#f85149;border-bottom:1px solid var(--border);background:rgba(248,81,73,0.06)">📄 参考字幕 (<span id="guide-count">0</span>条)</div>
  <div id="guide-list" style="max-height:200px;overflow-y:auto"></div>
  <div id="guide-import-bar" style="padding:6px 12px;display:flex;gap:8px;align-items:center;border-top:1px solid var(--border)">
    <button onclick="importSrt()" style="font-size:11px;padding:3px 10px;background:var(--border);color:var(--fg);border:1px solid var(--border);border-radius:4px;cursor:pointer">📂 导入字幕</button>
    <span id="guide-path-hint" style="font-size:10px;color:#8b949e;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
  </div>
  <div id="sub-header" style="padding:6px 12px;font-size:12px;color:#8b949e;border-bottom:1px solid var(--border);border-top:1px solid var(--border)">✅ 已采集 (<span id="sub-count">0</span>条)</div>
  <div id="sub-list"></div>
  <div id="capture-preview">
    <div class="status">等待捕获...</div>
    <div class="result" id="preview-text"></div>
  </div>
  <div id="btn-row">
    <button onclick="handleCapture()" class="primary" id="capture-btn">R 识别</button>
    <button onclick="exportSRT()">💾 导出 SRT</button>
    <button onclick="saveOverwrite()">💾 保存</button>
    <button onclick="clearAll()" class="danger small">清空</button>
  </div>
</div>

<div id="toast"></div>

<div id="video-browser-mask">
  <div id="video-browser">
    <div id="vb-header">
      <span id="vb-path">...</span>
      <button id="vb-close" onclick="vbClose()">&times;</button>
    </div>
    <div id="vb-list"></div>
  </div>
</div>

<script>
let subs = [];           // [{start, end, text}]
let currentIdx = -1;
let region = null;      // {x, y, w, h} normalized (0-1)
let dragMode = 'idle';   // 'draw' | 'move' | 'resize' | 'idle'
let dragHandle = '';     // resize handle: nw, n, ne, e, se, s, sw, w
let drawStart = {x:0, y:0};
let dragOrigRegion = null;  // region snapshot before move/resize
let dragOrigMouse = {x:0, y:0};
let capturing = false;
let importedSrtPath = null;  // 导入的 SRT 文件名（供保存覆盖）
let timeFocus = null;         // {subIdx, field: 'start'|'end'} 当前微调的时间字段
let guideTimeFocus = null;   // {subIdx, field: 'start'|'end'} 参考字幕微调字段

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const progressBar = document.getElementById('progress-bar');

async function openVideo() {
  showFileBrowser('video');
}

// ─── File browser modal ───
let videoBrowserPath = '';
let browserFilter = 'video'; // 'video' | 'srt'

async function showFileBrowser(filter) {
  browserFilter = filter || 'video';
  videoBrowserPath = '';
  document.getElementById('video-browser-mask').style.display = 'flex';
  document.getElementById('vb-path').textContent = '...';
  await refreshFileBrowser();
}

async function refreshFileBrowser() {
  try {
    let resp = await fetch('/api/list_dir', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: videoBrowserPath || '', filter: browserFilter})
    });
    let data = await resp.json();
    if (!data.ok) { toast('❌ ' + data.error); return; }
    videoBrowserPath = data.path;
    document.getElementById('vb-path').textContent = data.path;
    let html = '';
    for (let e of data.entries) {
      let icon = e.type === 'dir' ? '📁' : (browserFilter === 'srt' ? '📝' : '🎬');
      let cls = (e.type === 'video' || e.type === 'srt') ? 'vb-video' : 'vb-dir';
      let info = e.size ? ` (${(e.size/1024/1024).toFixed(1)}MB)` : '';
      let action = e.type === 'dir' ? 'vbEnter' : (browserFilter === 'srt' ? 'vbSelectSrt' : 'vbSelect');
      html += `<div class="${cls}" onclick="${action}('${escJs(e.path)}')">${icon} ${esc(e.name)}${info}</div>`;
    }
    document.getElementById('vb-list').innerHTML = html;
  } catch(e) { toast('❌ ' + e.message); }
}

async function vbEnter(p) {
  videoBrowserPath = p;
  await refreshFileBrowser();
}

async function vbSelect(p) {
  try {
    let resp = await fetch('/api/open_video', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: p})
    });
    let data = await resp.json();
    if (data.ok) {
      toast('📺 ' + data.name);
      video.src = '/video?t=' + Date.now();
      subs = []; currentIdx = -1; region = null;
      guideSubs = []; importedSrtPath = null;
      document.getElementById('guide-path-hint').textContent = '';
      render(); resizeMarkers(); drawRegion();
      document.getElementById('video-browser-mask').style.display = 'none';
    } else { toast('❌ ' + data.error); }
  } catch(e) { toast('❌ ' + e.message); }
}

async function vbSelectSrt(p) {
  try {
    let resp = await fetch('/api/load_srt_file', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: p})
    });
    let data = await resp.json();
    if (data.ok) {
      guideSubs = parseSRT(data.content);
      importedSrtPath = p;
      let name = p.split(/[/\\]/).pop();
      document.getElementById('guide-path-hint').textContent = '📄 ' + name;
      markerCanvas.classList.add('clickable');
      resizeMarkers(); render();
      toast(`📂 导入 ${guideSubs.length} 条参考字幕`);
      document.getElementById('video-browser-mask').style.display = 'none';
    } else { toast('❌ ' + data.error); }
  } catch(e) { toast('❌ ' + e.message); }
}

function importSrt() { showFileBrowser('srt'); }

function vbClose() {
  document.getElementById('video-browser-mask').style.display = 'none';
}

// ─── Video events ───
let progressDragging = false;

video.addEventListener('timeupdate', () => {
  document.getElementById('vtime').textContent = formatTime(video.currentTime);
  // 同步进度条（拖动时不要反向更新）
  if (!progressDragging && video.duration) {
    progressBar.value = (video.currentTime / video.duration) * 1000;
  }
  drawRegion();
});

video.addEventListener('loadedmetadata', () => {
  resizeOverlay();
  document.getElementById('vtotal').textContent = '/ ' + formatTime(video.duration);
});

// ─── Progress bar ───
progressBar.addEventListener('input', () => {
  progressDragging = true;
  if (video.duration) {
    video.currentTime = (progressBar.value / 1000) * video.duration;
  }
});

progressBar.addEventListener('change', () => {
  progressDragging = false;
});

// ─── SRT reference import ───
let guideSubs = [];
const markerCanvas = document.getElementById('marker-canvas');
const mctx = markerCanvas.getContext('2d');

function resizeMarkers() {
  const wrap = document.getElementById('progress-wrap');
  markerCanvas.width = wrap.clientWidth;
  markerCanvas.height = wrap.clientHeight;
  drawMarkers();
}

function drawMarkers() {
  mctx.clearRect(0, 0, markerCanvas.width, markerCanvas.height);
  if (!guideSubs.length || !video.duration) return;
  const w = markerCanvas.width, h = markerCanvas.height, dur = video.duration;
  guideSubs.forEach(g => {
    const x1 = (g.start / dur) * w, x2 = (g.end / dur) * w;
    mctx.fillStyle = 'rgba(248,81,73,0.25)';
    mctx.fillRect(x1, 4, Math.max(1, x2 - x1), h - 8);
    mctx.strokeStyle = '#f85149'; mctx.lineWidth = 1;
    mctx.beginPath(); mctx.moveTo(x1, 0); mctx.lineTo(x1, h); mctx.stroke();
    mctx.setLineDash([2, 3]);
    mctx.beginPath(); mctx.moveTo(x2, 0); mctx.lineTo(x2, h); mctx.stroke();
    mctx.setLineDash([]);
  });
}

markerCanvas.addEventListener('click', e => {
  if (!guideSubs.length || !video.duration) return;
  const rect = markerCanvas.getBoundingClientRect();
  const t = (e.clientX - rect.left) / markerCanvas.width * video.duration;
  let best = null, bestDist = Infinity;
  guideSubs.forEach(g => {
    ['start','end'].forEach(k => {
      let d = Math.abs(g[k] - t);
      if (d < bestDist) { bestDist = d; best = [g, k]; }
    });
  });
  if (best && bestDist < video.duration * 0.03) {
    video.currentTime = best[0][best[1]];
    video.pause();
    toast(`📍 ${best[1]} → ${best[0].text.substring(0, 40)}`);
  }
});

function parseSRT(text) {
  let entries = [];
  let blocks = text.trim().replace(/\r\n/g, '\n').split(/\n\n+/);
  const tsRe = /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/;
  for (let b of blocks) {
    let lines = b.trim().split('\n').filter(l => l.trim());
    if (lines.length < 1) continue;
    let tsIdx = lines.findIndex(l => tsRe.test(l));
    if (tsIdx < 0) continue;
    let m = lines[tsIdx].match(tsRe);
    // 时间戳行内嵌文字 + 后续行，都去掉可能残留的时间戳前缀
    let inline = lines[tsIdx].replace(tsRe, '').trim();
    let after = lines.slice(tsIdx + 1).join(' ').trim();
    after = after.replace(tsRe, '').trim();  // 二次清洗
    let txt = (inline + ' ' + after).trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    if (txt && !/^\d+$/.test(txt)) {
      entries.push({ start: timeToSec(m[1]), end: timeToSec(m[2]), text: txt });
    }
  }
  return entries;
}

// ─── Speed control ───
const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
function setSpeed(rate) {
  video.playbackRate = rate;
  ['btn-spd025','btn-spd05','btn-spd075','btn-spd1'].forEach(id => {
    let el = document.getElementById(id);
    if (el) el.style.background = '';
  });
  let id = 'btn-spd' + String(rate).replace('.','');
  let btn = document.getElementById(id);
  if (btn) btn.style.background = '#238636';
  toast(rate + 'x');
}
function adjSpeed(dir) {
  let cur = video.playbackRate;
  let idx = speeds.indexOf(cur);
  if (idx < 0) idx = speeds.findIndex(s => s > cur) - 1;
  idx = Math.max(0, Math.min(speeds.length - 1, idx + dir));
  setSpeed(speeds[idx]);
}
// 初始高亮 1x
setTimeout(() => setSpeed(1), 100);

// ─── Frame stepping ───
function stepFrame(n) {
  video.pause();
  // 假设 25fps，1帧 = 0.04s
  video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + n / 25));
}

function togglePlay() {
  if (video.paused) {
    video.play();
    document.getElementById('btn-play').textContent = '⏸';
  } else {
    video.pause();
    document.getElementById('btn-play').textContent = '▶';
  }
}

video.addEventListener('play', () => {
  document.getElementById('btn-play').textContent = '⏸';
});
video.addEventListener('pause', () => {
  document.getElementById('btn-play').textContent = '▶';
});

video.addEventListener('resize', resizeOverlay);
window.addEventListener('resize', () => { resizeOverlay(); resizeMarkers(); });

function resizeOverlay() {
  const rect = video.getBoundingClientRect();
  overlay.width = rect.width;
  overlay.height = rect.height;
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  drawRegion();
}

function formatTime(sec) {
  let h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60),
      s = (sec % 60).toFixed(3).padStart(6, '0');
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+s;
}

function timeToSec(str) {
  let parts = str.split(':');
  return +parts[0]*3600 + +parts[1]*60 + parseFloat(parts[2].replace(',','.'));
}

// ─── Region drawing / moving / resizing ───
const HANDLE_SIZE = 10; // px, edge grab zone

function hitTestHandle(mx, my) {
  if (!region) return '';
  const rect = overlay.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  const rx = region.x * w, ry = region.y * h;
  const rw = region.w * w, rh = region.h * h;
  const d = HANDLE_SIZE;
  // corners first, then edges
  if (mx < rx + d && my < ry + d) return 'nw';
  if (mx > rx + rw - d && my < ry + d) return 'ne';
  if (mx < rx + d && my > ry + rh - d) return 'sw';
  if (mx > rx + rw - d && my > ry + rh - d) return 'se';
  if (mx < rx + d && my > ry + d && my < ry + rh - d) return 'w';
  if (mx > rx + rw - d && my > ry + d && my < ry + rh - d) return 'e';
  if (my < ry + d && mx > rx + d && mx < rx + rw - d) return 'n';
  if (my > ry + rh - d && mx > rx + d && mx < rx + rw - d) return 's';
  if (mx > rx && mx < rx + rw && my > ry && my < ry + rh) return 'inside';
  return '';
}

overlay.addEventListener('mousedown', e => {
  const rect = overlay.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  video.pause();
  
  const handle = hitTestHandle(mx, my);
  if (handle === 'inside') {
    dragMode = 'move';
    dragOrigRegion = {...region};
    dragOrigMouse = {x: mx, y: my};
  } else if (handle && handle !== '') {
    dragMode = 'resize';
    dragHandle = handle;
    dragOrigRegion = {...region};
    dragOrigMouse = {x: mx, y: my};
  } else {
    dragMode = 'draw';
    drawStart = {x: mx, y: my};
    region = null; // start fresh
    drawRegion();
  }
});

overlay.addEventListener('mousemove', e => {
  const rect = overlay.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const w = rect.width, h = rect.height;
  
  // Update cursor
  if (dragMode === 'idle') {
    const h = hitTestHandle(mx, my);
    const cursors = {nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize',
                      n:'n-resize',  s:'s-resize',  e:'e-resize',  w:'w-resize',
                      inside:'move'};
    overlay.style.cursor = cursors[h] || 'crosshair';
  }
  
  if (dragMode === 'draw') {
    region = {
      x: Math.min(drawStart.x, mx) / w,
      y: Math.min(drawStart.y, my) / h,
      w: Math.abs(mx - drawStart.x) / w,
      h: Math.abs(my - drawStart.y) / h
    };
    drawRegion();
    return;
  }
  
  if (dragMode === 'move') {
    let dx = (mx - dragOrigMouse.x) / w;
    let dy = (my - dragOrigMouse.y) / h;
    region = {
      x: Math.max(0, Math.min(1 - dragOrigRegion.w, dragOrigRegion.x + dx)),
      y: Math.max(0, Math.min(1 - dragOrigRegion.h, dragOrigRegion.y + dy)),
      w: dragOrigRegion.w,
      h: dragOrigRegion.h
    };
    drawRegion();
    return;
  }
  
  if (dragMode === 'resize') {
    let dx = (mx - dragOrigMouse.x) / w;
    let dy = (my - dragOrigMouse.y) / h;
    let r = {...dragOrigRegion};
    const handle = dragHandle;
    if (handle.includes('e')) { r.w = Math.max(0.02, dragOrigRegion.w + dx); }
    if (handle.includes('w')) { r.x = Math.min(dragOrigRegion.x + dragOrigRegion.w - 0.02, dragOrigRegion.x + dx); r.w = dragOrigRegion.w - (r.x - dragOrigRegion.x); }
    if (handle.includes('s')) { r.h = Math.max(0.02, dragOrigRegion.h + dy); }
    if (handle.includes('n')) { r.y = Math.min(dragOrigRegion.y + dragOrigRegion.h - 0.02, dragOrigRegion.y + dy); r.h = dragOrigRegion.h - (r.y - dragOrigRegion.y); }
    r.x = Math.max(0, r.x);
    r.y = Math.max(0, r.y);
    r.w = Math.min(1 - r.x, Math.max(0.02, r.w));
    r.h = Math.min(1 - r.y, Math.max(0.02, r.h));
    region = r;
    drawRegion();
    return;
  }
});

overlay.addEventListener('mouseup', () => {
  if (dragMode !== 'idle') {
    updateRegionInfo();
  }
  dragMode = 'idle';
  dragHandle = '';
});

overlay.addEventListener('mouseleave', () => {
  dragMode = 'idle';
  dragHandle = '';
});

function drawRegion() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!region) return;
  
  const x = region.x * overlay.width;
  const y = region.y * overlay.height;
  const w = region.w * overlay.width;
  const h = region.h * overlay.height;
  
  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(88, 166, 255, 0.08)';
  ctx.fillRect(x, y, w, h);
  
  // 四角拖拽把手
  const d = 8;
  [[x, y], [x+w-d, y], [x, y+h-d], [x+w-d, y+h-d]].forEach(([cx, cy]) => {
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(cx, cy, d, d);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx, cy, d, d);
  });
  
  // 标注区域在视频中的实际像素（近似）
  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;
  const px = Math.round(region.x * vw);
  const py = Math.round(region.y * vh);
  const pw = Math.round(region.w * vw);
  const ph = Math.round(region.h * vh);
  
  ctx.font = '11px monospace';
  ctx.fillStyle = '#58a6ff';
  ctx.fillText(`${px},${py} ${pw}x${ph}`, x + 4, y - 6);
}

function updateRegionInfo() {
  if (!region) {
    document.getElementById('region-info').textContent = '字幕区域：拖动鼠标框选';
    return;
  }
  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;
  const x = Math.round(region.x * vw);
  const y = Math.round(region.y * vh);
  const w = Math.round(region.w * vw);
  const h = Math.round(region.h * vh);
  document.getElementById('region-info').textContent = `字幕区域：${x},${y} ${w}x${h} (视频像素)`;
}

// ─── Capture ───
// R 键 = 暂停 + OCR 识别 + 创建字幕条目
async function handleCapture() {
  if (capturing) return;
  
  const t = video.currentTime;
  video.pause();
  capturing = true;
  
  const preview = document.getElementById('preview-text');
  preview.textContent = 'OCR 识别中...';
  preview.className = 'result pending';
  document.querySelector('#capture-preview .status').textContent = `🔍 OCR @ ${formatTime(t)}`;
  
  let pxRegion = null;
  if (region) {
    const vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
    pxRegion = { x: Math.round(region.x*vw), y: Math.round(region.y*vh), w: Math.round(region.w*vw), h: Math.round(region.h*vh) };
  }
  
  try {
    let resp = await fetch('/api/capture', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({time: t, region: pxRegion})
    });
    let data = await resp.json();
    let text = data.text || '';
    
    if (!region && data.auto_region) {
      const r = data.auto_region;
      const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
      region = { x: r.x/vw, y: r.y/vh, w: r.w/vw, h: r.h/vh };
      resizeOverlay(); updateRegionInfo();
    }
    
    // 创建字幕条目：start=当前时间, end=占位(start+0.01)
    let entry = {start: t, end: t + 0.01, text: text};
    let idx = insertSorted(entry);
    if (idx >= 0) { currentIdx = idx; render(); }
    
    preview.textContent = text || '(未识别到文字)';
    preview.className = text ? 'result' : 'result error';
    toast(text ? `✅ #${subs.length} ${text.substring(0, 40)}` : `⚠ 未识别到文字`);
    document.querySelector('#capture-preview .status').textContent = `✅ #${subs.length} 已记录 @ ${formatTime(t)}`;
  } catch(e) {
    preview.textContent = '捕获失败: ' + e.message;
    preview.className = 'result error';
  }
  
  capturing = false;
}

// 点击列表项可编辑文字
function selectEntry(i) {
  currentIdx = i;
  if (subs[i]) {
    video.currentTime = subs[i].start;
    video.pause();
  }
  render();  // 刷新高亮
}

function manualCapture() {
  handleCapture();
}

async function autoDetectRegion() {
  video.pause();
  const t = video.currentTime || 60;
  try {
    let resp = await fetch('/api/auto_region', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({time: t})
    });
    let data = await resp.json();
    if (data.region) {
      const r = data.region;
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      region = {x: r.x/vw, y: r.y/vh, w: r.w/vw, h: r.h/vh};
      resizeOverlay();
      updateRegionInfo();
      toast('✅ 区域已自动检测');
    }
  } catch(e) {
    toast('❌ 自动检测失败');
  }
}

// ─── Subtitle list ───
function insertSorted(entry) {
  let pos = subs.findIndex(s => s.start > entry.start);
  if (pos === -1) pos = subs.length;
  
  let before = pos > 0 ? subs[pos - 1] : null;
  let after = pos < subs.length ? subs[pos] : null;
  if (before && before.end > entry.start) {
    toast(`⚠ 时间与上一条 #${pos} 重叠，插入失败`);
    return -1;
  }
  if (after && entry.end > after.start) {
    toast(`⚠ 时间与下一条 #${pos+1} 重叠，插入失败`);
    return -1;
  }
  
  subs.splice(pos, 0, entry);
  return pos;
}

function render() {
  // 已采集字幕
  let html = '';
  subs.forEach((s, i) => {
    let cls = i === currentIdx ? 'entry active' : 'entry';
    let sf = (timeFocus && timeFocus.subIdx === i && timeFocus.field === 'start') ? 'time-focus' : '';
    let ef = (timeFocus && timeFocus.subIdx === i && timeFocus.field === 'end') ? 'time-focus' : '';
    html += `<div class="${cls}" onclick="selectEntry(${i})">
      <div class="time-row">
        <label style="display:flex;align-items:center;gap:1px;cursor:pointer">
          <input type="checkbox" data-sub="${i}" ${s._chk ? 'checked' : ''} onchange="toggleSubChk(${i}, this.checked)" onclick="event.stopPropagation()" style="accent-color:#58a6ff;margin:0">
          <span class="idx">#${i+1}</span>
        </label>
        <span style="font-size:9px;color:#8b949e;width:22px">始</span>
        <button class="adj" onclick="event.stopPropagation();adjTime(${i},'start',-1)">◀</button>
        <input value="${s.start ? formatTime(s.start) : ''}" placeholder="开始" class="${sf}"
          onchange="updateTime(${i},'start',this.value)" onclick="event.stopPropagation()"
          onfocus="focusTimeField(${i},'start')" onblur="blurTimeField()">
        <button class="adj" onclick="event.stopPropagation();adjTime(${i},'start',1)">▶</button>
        <button class="adj" onclick="event.stopPropagation();addSubToGuide(${i})" title="加入参考" style="color:#3fb950">↗</button>
      </div>
      <div class="time-row">
        <span style="width:30px;flex-shrink:0"></span>
        <span style="font-size:9px;color:#8b949e;width:22px">终</span>
        <button class="adj" onclick="event.stopPropagation();adjTime(${i},'end',-1)">◀</button>
        <input value="${s.end ? formatTime(s.end) : ''}" placeholder="结束" class="${ef}"
          onchange="updateTime(${i},'end',this.value)" onclick="event.stopPropagation()"
          onfocus="focusTimeField(${i},'end')" onblur="blurTimeField()">
        <button class="adj" onclick="event.stopPropagation();adjTime(${i},'end',1)">▶</button>
      </div>
      <div class="txt">
        <span class="txt-val" style="flex:1;cursor:text" onclick="event.stopPropagation()" ondblclick="event.stopPropagation();editSubText(${i}, this)">${esc(s.text || '(无文字)')}</span>
        <button class="adj" onclick="event.stopPropagation();editSubText(${i}, this.parentElement.querySelector('.txt-val'))" title="编辑文字" style="margin-left:6px">✏️</button>
      </div>
    </div>`;
  });
  document.getElementById('sub-list').innerHTML = html || '<div style="padding:12px;color:#8b949e">暂无</div>';
  let nChk = subs.filter(s => s._chk).length;
  document.getElementById('sub-count').innerHTML = `${subs.length} 条 &nbsp; <button class="small" onclick="addEntry()" style="background:#238636;border-color:#238636;color:#fff">+ 增加</button> ${nChk > 0 ? `<button class="small" onclick="deleteCheckedSubs()" style="background:#da3633;border-color:#da3633;color:#fff">− 删除选中 (${nChk})</button>` : ''}`;
  
  // 参考字幕
  let gHtml = '';
  guideSubs.forEach((g, i) => {
    let sd = formatTime(g.start), ed = formatTime(g.end);
    let gsf = (guideTimeFocus && guideTimeFocus.subIdx === i && guideTimeFocus.field === 'start') ? 'time-focus' : '';
    let gef = (guideTimeFocus && guideTimeFocus.subIdx === i && guideTimeFocus.field === 'end') ? 'time-focus' : '';
    gHtml += `<div class="entry" style="border-left:3px solid ${g._sel ? '#58a6ff' : '#f85149'}" onclick="seekGuide(${i})">
      <div class="time-row">
        <label style="display:flex;align-items:center;gap:2px;cursor:pointer">
          <input type="checkbox" ${g._sel ? 'checked' : ''} onchange="toggleGuideSel(${i})" onclick="event.stopPropagation()" style="accent-color:#58a6ff;margin:0">
          <span class="idx">#${i+1}</span>
        </label>
        <span style="font-size:9px;color:#f85149;width:16px">始</span>
        <button class="adj" onclick="event.stopPropagation();guideAdjTime(${i},'start',-1)">◀</button>
        <input value="${sd}" class="${gsf}" onchange="guideUpdateTime(${i},'start',this.value)"
          onclick="event.stopPropagation()" onfocus="focusGuideTimeField(${i},'start')" onblur="blurGuideTimeField()">
        <button class="adj" onclick="event.stopPropagation();guideAdjTime(${i},'start',1)">▶</button>
      </div>
      <div class="time-row">
        <span style="width:32px;flex-shrink:0"></span>
        <span style="font-size:9px;color:#f85149;width:16px">终</span>
        <button class="adj" onclick="event.stopPropagation();guideAdjTime(${i},'end',-1)">◀</button>
        <input value="${ed}" class="${gef}" onchange="guideUpdateTime(${i},'end',this.value)"
          onclick="event.stopPropagation()" onfocus="focusGuideTimeField(${i},'end')" onblur="blurGuideTimeField()">
        <button class="adj" onclick="event.stopPropagation();guideAdjTime(${i},'end',1)">▶</button>
      </div>
      <div class="txt" style="font-size:12px;display:flex;align-items:center">
        <span class="txt-val" style="flex:1" onclick="event.stopPropagation()" ondblclick="event.stopPropagation();editGuideText(${i}, this)">${esc(g.text.substring(0, 60))}</span>
        <button class="adj" onclick="event.stopPropagation();editGuideText(${i}, this.parentElement.querySelector('.txt-val'))" title="编辑" style="margin-left:4px">✏️</button>
      </div>
    </div>`;
  });
  document.getElementById('guide-list').innerHTML = gHtml || '<div style="padding:12px;color:#8b949e">拖入 SRT 导入参考字幕</div>';
  let gh = document.getElementById('guide-header');
  gh.style.display = guideSubs.length ? 'block' : 'none';
  let gSel = guideSubs.filter(g => g._sel).length;
  let gBtns = '';
  if (gSel > 0) gBtns += `<button class="small" onclick="deleteCheckedGuides()" style="background:#da3633;border-color:#da3633;color:#fff">− 删除选中 (${gSel})</button> `;
  if (importedSrtPath) gBtns += `<button class="small" onclick="saveGuides()" style="background:#238636;border-color:#238636;color:#fff">💾 保存覆盖</button>`;
  document.getElementById('guide-count').innerHTML = `${guideSubs.length} 条 &nbsp; ${gBtns}`;
}

function seekGuide(i) {
  let g = guideSubs[i];
  if (g) {
    video.currentTime = g.start;
    video.pause();
    region = null; drawRegion();  // 清除选框，恢复 ←→ seek 视频
    toast(`📍 参考 #${i+1}: ${g.text.substring(0, 40)}`);
  }
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escJs(s) { return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }

function updateTime(i, field, val) {
  let sec = timeToSec(val);
  if (!isNaN(sec)) {
    subs[i][field] = sec;
  }
  render();
}

function deleteCurrent() {
  if (currentIdx >= 0) {
    let txt = subs[currentIdx].text;
    subs.splice(currentIdx, 1);
    currentIdx = Math.min(currentIdx, subs.length - 1);
    toast(`🗑 删除: ${txt}`);
    render();
  }
}

function clearAll() {
  if (subs.length && confirm('确定清空所有字幕？')) {
    subs = [];
    currentIdx = -1;
    render();
  }
}

async function exportSRT() {
  let resp = await fetch('/api/export', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({entries: subs})
  });
  let data = await resp.json();
  toast(`💾 ${data.path} (${data.count} 条)`);
}

async function saveOverwrite() {
  if (!importedSrtPath) {
    // 没导入过就用导出方式
    exportSRT(); return;
  }
  let entries = subs.map(s => ({ start: s.start, end: s.end, text: s.text }));
  try {
    let resp = await fetch('/api/save_srt', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: importedSrtPath, entries})
    });
    let data = await resp.json();
    toast(data.ok ? `💾 已保存 ${entries.length} 条 → ${importedSrtPath}` : `❌ ${data.error}`);
  } catch(e) { toast('保存失败: ' + e.message); }
}

// ─── Time field focus & adjust ───
function focusTimeField(i, field) {
  timeFocus = {subIdx: i, field: field};
  let s = subs[i];
  if (s && s[field] !== undefined) {
    video.pause();
    video.currentTime = s[field];
  }
  // 重新渲染以添加 time-focus class
  render();
}

function blurTimeField() {
  // 延迟清除，让 click 事件先触发
  setTimeout(() => { timeFocus = null; render(); }, 150);
}

function adjTime(i, field, dir) {
  let s = subs[i]; if (!s) return;
  let evt = event || window.event;
  let step = (evt && evt.shiftKey) ? 1/25 : 0.1;
  let delta = dir * step;
  s[field] = Math.max(0, Math.min(video.duration || 3600, (s[field] || 0) + delta));
  video.pause();
  video.currentTime = s[field];
  timeFocus = {subIdx: i, field: field};
  render();
}

// ─── Add / Delete / Save ───
function addSubToGuide(i) {
  let s = subs[i]; if (!s) return;
  if (!s.start && s.start !== 0) { toast('⚠ 请先设置开始时间'); return; }
  if (!s.text || !s.text.trim()) { toast('⚠ 请先添加文字（双击编辑）'); return; }
  
  let entry = {start: s.start, end: s.end || (s.start + 2), text: s.text.trim()};
  
  // 找插入位置（按 start 排序）
  let pos = 0;
  while (pos < guideSubs.length && guideSubs[pos].start < entry.start) pos++;
  
  // 检查与前一个条目重叠
  if (pos > 0 && guideSubs[pos-1].end > entry.start) {
    toast(`⚠ 与前段 #${pos} 时间重叠，不允许插入`);
    return;
  }
  // 检查与后一个条目重叠
  if (pos < guideSubs.length && entry.end > guideSubs[pos].start) {
    toast(`⚠ 与后段 #${pos+1} 时间重叠，不允许插入`);
    return;
  }
  
  guideSubs.splice(pos, 0, entry);
  subs.splice(i, 1);  // 从采集区移除
  if (currentIdx >= subs.length) currentIdx = Math.max(0, subs.length - 1);
  resizeMarkers(); render();
  toast(`↗ #${i+1} → 参考 #${pos+1}`);
}

function addEntry() {
  video.pause();
  let entry = {start: video.currentTime, end: video.currentTime + 2, text: ''};
  let idx = insertSorted(entry);
  if (idx >= 0) {
    currentIdx = idx;
    render();
    toast(`➕ 新增 #${idx+1} @ ${formatTime(entry.start)}`);
  }
}

function toggleSubChk(i, v) { subs[i]._chk = v; render(); }

function deleteCheckedSubs() {
  let sel = []; subs.forEach((s, i) => { if (s._chk) sel.push(i); });
  if (!sel.length) { toast('⚠ 请先勾选要删除的段落'); return; }
  for (let j = sel.length - 1; j >= 0; j--) subs.splice(sel[j], 1);
  currentIdx = Math.min(currentIdx, subs.length - 1);
  render(); toast(`🗑 已删除 ${sel.length} 条`);
}

function toggleGuideSel(i) { guideSubs[i]._sel = !guideSubs[i]._sel; resizeMarkers(); render(); }

// ─── Guide time edit ───
function focusGuideTimeField(i, field) {
  guideTimeFocus = {subIdx: i, field: field};
  let g = guideSubs[i];
  if (g && g[field] !== undefined) { video.pause(); video.currentTime = g[field]; }
  render();
}
function blurGuideTimeField() {
  setTimeout(() => { guideTimeFocus = null; render(); }, 150);
}
function guideAdjTime(i, field, dir) {
  let g = guideSubs[i]; if (!g) return;
  let evt = event || window.event;
  let step = (evt && evt.shiftKey) ? 1/25 : 0.1;
  g[field] = Math.max(0, Math.min(video.duration || 3600, (g[field] || 0) + dir * step));
  video.pause(); video.currentTime = g[field];
  guideTimeFocus = {subIdx: i, field: field};
  resizeMarkers(); render();
}
function guideUpdateTime(i, field, value) {
  let g = guideSubs[i]; if (!g) return;
  let parts = value.split(':'); if (parts.length === 3) {
    let ss = parts[2].split('.'); let ms = ss[1] ? parseInt(ss[1]) : 0;
    g[field] = parseInt(parts[0])*3600 + parseInt(parts[1])*60 + parseInt(ss[0]) + ms/1000;
  }
  resizeMarkers(); render();
}

function deleteCheckedGuides() {
  let sel = []; guideSubs.forEach((g, i) => { if (g._sel) sel.push(i); });
  if (!sel.length) { toast('⚠ 请先勾选'); return; }
  for (let j = sel.length - 1; j >= 0; j--) guideSubs.splice(sel[j], 1);
  resizeMarkers(); render(); toast(`🗑 已删除 ${sel.length} 条`);
}

async function saveGuides() {
  if (!importedSrtPath) { toast('⚠ 没有导入的文件路径'); return; }
  let entries = guideSubs.map(g => ({ start: g.start, end: g.end, text: g.text }));
  try {
    let resp = await fetch('/api/save_srt', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: importedSrtPath, entries})
    });
    let data = await resp.json();
    toast(data.ok ? `💾 已保存 ${entries.length} 条 → ${importedSrtPath}` : `❌ ${data.error}`);
  } catch(e) { toast('保存失败: ' + e.message); }
}

// ─── Edit text ───
function editSubText(i, el) {
  let s = subs[i]; if (!s) return;
  let input = document.createElement('input');
  input.value = s.text || '';
  Object.assign(input.style, {width:'100%',background:'var(--bg)',border:'1px solid var(--accent)',color:'var(--text)',padding:'2px 4px',fontSize:'13px',borderRadius:'4px'});
  input.onblur = () => { s.text = input.value.trim(); render(); };
  input.onkeydown = e => { e.stopPropagation(); if (e.key==='Enter') input.blur(); if (e.key==='Escape') render(); };
  el.innerHTML = ''; el.appendChild(input); input.focus(); input.select();
}
function editGuideText(i, el) {
  let g = guideSubs[i]; if (!g) return;
  let input = document.createElement('input');
  input.value = g.text || '';
  Object.assign(input.style, {width:'100%',background:'var(--bg)',border:'1px solid var(--accent)',color:'var(--text)',padding:'2px 4px',fontSize:'12px',borderRadius:'4px'});
  input.onblur = () => { g.text = input.value.trim(); resizeMarkers(); render(); };
  input.onkeydown = e => { e.stopPropagation(); if (e.key==='Enter') input.blur(); if (e.key==='Escape') render(); };
  el.innerHTML = ''; el.appendChild(input); input.focus(); input.select();
}

// ─── Keyboard ───
document.addEventListener('keydown', e => {
  // 时间字段微调模式 (优先处理，即使焦点在输入框)
  if (timeFocus && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Escape') { timeFocus = null; render(); return; }
    adjTime(timeFocus.subIdx, timeFocus.field, e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (guideTimeFocus && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Escape') { guideTimeFocus = null; render(); return; }
    guideAdjTime(guideTimeFocus.subIdx, guideTimeFocus.field, e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  
  // 不在输入框中
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  // 选框移动/缩放 (Ctrl+方向键，视频暂停时且已框选区域)
  if (region && video.paused && !capturing && e.ctrlKey) {
    const step = 0.005; // 移动步长 = 0.5% 画面尺寸
    switch(e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (e.shiftKey) { region.h = Math.max(0.02, region.h - step); }
        else { region.y = Math.max(0, region.y - step); }
        drawRegion(); updateRegionInfo();
        return;
      case 'ArrowDown':
        e.preventDefault();
        if (e.shiftKey) { region.h = Math.min(1 - region.y, region.h + step); }
        else { region.y = Math.min(1 - region.h, region.y + step); }
        drawRegion(); updateRegionInfo();
        return;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) { region.w = Math.max(0.02, region.w - step); }
        else { region.x = Math.max(0, region.x - step); }
        drawRegion(); updateRegionInfo();
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) { region.w = Math.min(1 - region.x, region.w + step); }
        else { region.x = Math.min(1 - region.w, region.x + step); }
        drawRegion(); updateRegionInfo();
        return;
    }
  }
  
  switch(e.key) {
    case ' ':
      e.preventDefault();
      if (video.paused) video.play(); else video.pause();
      break;
    case 'r':
    case 'R':
      e.preventDefault();
      handleCapture();
      break;
    case 's':
    case 'S':
      if (e.ctrlKey) { e.preventDefault(); exportSRT(); }
      break;
    case '[':
      e.preventDefault();
      adjSpeed(-1);
      break;
    case ']':
      e.preventDefault();
      adjSpeed(1);
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteCurrent();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      video.pause();
      video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1/25 : 0.1));
      break;
    case 'ArrowRight':
      e.preventDefault();
      video.pause();
      video.currentTime = Math.min(video.duration||Infinity, video.currentTime + (e.shiftKey ? 1/25 : 0.1));
      break;
  }
});

// ─── Toast ───
function toast(msg) {
  let el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = '', 2000);
}

// ─── Init ───
resizeOverlay();
resizeMarkers();
render();
</script>
</body>
</html>"""


def main():
    global VIDEO_PATH
    
    ap = argparse.ArgumentParser(description="交互式字幕 OCR 采集工具")
    ap.add_argument("--video", required=True, help="视频文件路径")
    ap.add_argument("--port", type=int, default=5000, help="服务器端口")
    args = ap.parse_args()
    
    VIDEO_PATH = os.path.abspath(args.video)
    if not os.path.exists(VIDEO_PATH):
        print(f"Error: video not found: {VIDEO_PATH}")
        sys.exit(1)
    
    init_ocr()
    
    print(f"\n  📺 视频: {VIDEO_PATH}")
    print(f"  🌐 打开 http://localhost:{args.port}\n")
    print(f"  操作:")
    print(f"    R 键 = 暂停 + OCR 识别 + 记录")
    print(f"    空格 = 播放/暂停")
    print(f"    ←→ = 跳转 · Shift+←→ = 逐帧")
    print(f"    Ctrl+←→↑↓ = 移动选框 · Ctrl+Shift+←→↑↓ = 缩放选框")
    print(f"    鼠标拖动 = 框选字幕区域")
    print(f"    Ctrl+S = 导出 SRT\n")
    
    app.run(host='127.0.0.1', port=args.port, debug=False)


if __name__ == "__main__":
    main()
