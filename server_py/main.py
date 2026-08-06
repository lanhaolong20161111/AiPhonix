"""AiPhonix Python 服务端 — FastAPI 入口"""

import logging
import os
import sys
import json
import html
import urllib.parse

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from config import load_config
from services.deepseek import BudgetExceededError

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
logger = logging.getLogger(__name__)

# 创建 app
app = FastAPI(title="AiPhonix Server", version="1.0.0")


# 预算守卫：统一提示（所有端点一致）
@app.exception_handler(BudgetExceededError)
async def budget_exceeded_handler(request: Request, exc: BudgetExceededError):
    logger.warning("LLM 预算守卫拒绝: %s", exc)
    return JSONResponse(
        status_code=429,
        content={"detail": "今日 AI 额度已用完，请明天再试（预算守卫）", "budget": True},
    )

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


async def _init_routes():
    """初始化所有路由（延迟导入，解决循环依赖）"""
    from routes import llm, quiz, tts, soe, wordbank, chinese_practice, practice, practice_tracker, word_suggestions, english, char_images, ark_image, essays, auth, users, uploads, import_templates, user_imports, free_llm, training, pinyin_audio, ipa_audio, ai_practice

    # 加载配置
    cfg_path = os.environ.get("CONFIG_PATH", "config.yaml")
    cfg = load_config(cfg_path)

    # 初始化各路由模块
    llm.init(cfg)
    quiz.init(cfg)
    tts.init(cfg)
    soe.init(cfg)
    wordbank.init("data")
    chinese_practice.init(cfg)
    practice.init("data")
    practice_tracker.init(cfg)
    word_suggestions.init(cfg)
    essays.init(cfg)
    english  # no init needed
    char_images.init()
    pinyin_audio.init()
    ipa_audio.init()
    import_templates.init("data")
    await ai_practice.init(cfg)

    from services import ark_image as ark_svc
    ark_svc.init(cfg.ark_image)

    from services import free_llm as free_llm_svc
    free_llm_svc.init(cfg.ark_chat)

    # 注册路由
    app.include_router(llm.router, prefix="/api/v1")
    app.include_router(quiz.router, prefix="/api/v1")
    app.include_router(tts.router, prefix="/api/v1")
    app.include_router(soe.router, prefix="/api/v1")
    app.include_router(wordbank.router, prefix="/api/v1")
    app.include_router(chinese_practice.router, prefix="/api/v1")
    app.include_router(practice.router, prefix="/api/v1")
    app.include_router(practice_tracker.router, prefix="/api/v1")
    app.include_router(word_suggestions.router, prefix="/api/v1")
    app.include_router(english.router, prefix="/api/v1")
    app.include_router(char_images.router, prefix="/api/v1")
    app.include_router(pinyin_audio.router, prefix="/api/v1")
    app.include_router(ipa_audio.router, prefix="/api/v1")
    app.include_router(ark_image.router, prefix="/api/v1")
    app.include_router(essays.router, prefix="/api/v1")
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(uploads.router, prefix="/api/v1")
    app.include_router(import_templates.router, prefix="/api/v1")
    app.include_router(user_imports.router, prefix="/api/v1")
    app.include_router(free_llm.router, prefix="/api/v1")
    app.include_router(training.router, prefix="/api/v1")
    app.include_router(ai_practice.router, prefix="/api/v1")

    # 移动端网页（上传工具），构建产物在 static/web/
    from fastapi.staticfiles import StaticFiles
    web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "web")
    if os.path.isdir(web_dir):
        app.mount("/web", StaticFiles(directory=web_dir, html=True), name="web")
        logger.info("移动端网页已挂载: %s", web_dir)

    logger.info("所有路由已注册")
    return cfg


@app.on_event("startup")
async def startup():
    global _cfg
    # 初始化数据库
    from database import init_db
    await init_db()
    _cfg = await _init_routes()
    model = _cfg.deepseek.model
    addr = f"{_cfg.server.host}:{_cfg.server.port}"
    logger.info("AiPhonix 服务器启动: %s (模型: %s)", addr, model)


@app.get("/health")
async def health():
    return {"status": "ok", "model": _cfg.deepseek.model if hasattr(_cfg, 'deepseek') else "unknown"}


# ── APK 下载（局域网安装） ──

DOWNLOAD_DIR = os.path.join("data", "downloads")
APK_PATH = os.path.join(DOWNLOAD_DIR, "AiPhonix.apk")


@app.get("/download", response_class=HTMLResponse)
async def download_page():
    """局域网内其他手机下载 APK 的引导页"""
    apk_exists = os.path.exists(APK_PATH)
    size_mb = round(os.path.getsize(APK_PATH) / (1024 * 1024), 1) if apk_exists else 0
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AiPhonix 下载</title>
<style>
  body {{ font-family: -apple-system, "Microsoft YaHei", sans-serif; background:#f5f7fa; display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; }}
  .card {{ background:#fff; border-radius:16px; padding:40px 32px; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,.08); max-width:360px; width:90%; }}
  .logo {{ font-size:52px; margin-bottom:12px; }}
  h1 {{ font-size:22px; color:#1a1a2e; margin:0 0 8px; }}
  p {{ color:#666; font-size:14px; line-height:1.7; margin:6px 0; }}
  .btn {{ display:block; background:#4a6cf7; color:#fff; text-decoration:none; padding:14px; border-radius:10px; font-size:17px; font-weight:600; margin-top:20px; }}
  .btn:active {{ opacity:.85; }}
  .tip {{ background:#fff8e6; border:1px solid #f0d68a; border-radius:8px; padding:10px; font-size:12px; color:#8a6d1a; margin-top:16px; text-align:left; }}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📱</div>
  <h1>AiPhonix</h1>
  <p>局域网内 APK 安装包</p>
  <p>版本：Debug 构建 · 大小：{size_mb} MB</p>
  <a class="btn" href="/download/apk">⬇️ 下载并安装</a>
  <div class="tip">
    ⚠️ 首次安装需在手机设置中允许「安装未知来源应用」<br>
    （不同品牌路径：设置 → 安全/应用 → 允许安装未知应用）
  </div>
</div>
</body>
</html>"""


@app.get("/download/apk")
async def download_apk():
    """返回 APK 文件"""
    if not os.path.exists(APK_PATH):
        return HTMLResponse("<h3>APK 文件不存在</h3>", status_code=404)
    return FileResponse(
        APK_PATH,
        filename="AiPhonix.apk",
        media_type="application/vnd.android.package-archive",
    )


# ── 英句图片汇总审查页 ──

INDEX_PATH = os.path.join("data", "char_image_index.json")

# 最近重配的 24 张英句卡（Seedream-5.0 新图），用于单独审查
RECENT_SENTS = [
    "beg your pardon", "Can you see me", "come here",
    "Did you hear anything", "doors go up", "good afternoon",
    "how about a drink", "How far is it?", "I beg your pardon",
    "I can hear something", "i can't see anyone", "I see.",
    "in front", "it's not big enough", "look out",
    "no one can see me", "once upon a time", "say it again",
    "second floor", "straight on", "take away",
    "Tell me.", "there's no one outside", "yes I like apples",
]


@app.get("/review", response_class=HTMLResponse)
async def review_page():
    """全部英句图片汇总页，供用户审查"""
    try:
        with open(INDEX_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return HTMLResponse("<h3>索引文件读取失败</h3>", status_code=500)
    items = data["items"] if isinstance(data, dict) and "items" in data else data
    sents = sorted(
        (it for it in items if it.get("type") == "英句"),
        key=lambda x: x.get("char", "").lower(),
    )
    cards = ""
    for it in sents:
        char = html.escape(it.get("char", ""))
        img = urllib.parse.quote(it.get("image", ""))
        cards += f"""
        <div class="card">
          <div class="imgwrap"><img src="/api/v1/char-images/file/{img}" alt="{char}" loading="lazy"></div>
          <div class="info"><span class="word">{char}</span><span class="type">英句</span></div>
        </div>"""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>英句图片汇总审查（{len(sents)} 条）</title>
<style>
  body {{ font-family: -apple-system, "Microsoft YaHei", sans-serif; background:#f5f7fa; margin:0; padding:20px; }}
  h1 {{ font-size:20px; color:#1a1a2e; text-align:center; }}
  .stats {{ text-align:center; color:#888; font-size:14px; margin:4px 0 16px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; max-width:1400px; margin:0 auto; }}
  .card {{ background:#fff; border-radius:14px; padding:12px; box-shadow:0 2px 12px rgba(0,0,0,.06); }}
  .imgwrap {{ background:#eee; border-radius:10px; overflow:hidden; aspect-ratio:1/1; display:flex; align-items:center; justify-content:center; }}
  .imgwrap img {{ max-width:100%; max-height:100%; object-fit:contain; }}
  .info {{ display:flex; align-items:center; gap:8px; margin:10px 2px 4px; }}
  .word {{ font-size:15px; font-weight:700; color:#1a1a2e; word-break:break-word; }}
  .type {{ background:#4a6cf7; color:#fff; font-size:12px; padding:2px 8px; border-radius:20px; flex-shrink:0; }}
</style>
</head>
<body>
<h1>📄 英句图片汇总（{len(sents)} 条）</h1>
<div class="stats">按字母排序 · 点击图片可放大查看原图</div>
<div class="grid">{cards}
</div>
</body>
</html>"""


@app.get("/review/new", response_class=HTMLResponse)
async def review_recent_page():
    """最近用 Seedream-5.0 重配的 24 张英句卡审查页"""
    try:
        with open(INDEX_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return HTMLResponse("<h3>索引文件读取失败</h3>", status_code=500)
    items = data["items"] if isinstance(data, dict) and "items" in data else data
    by_char = {it.get("char"): it for it in items if it.get("type") == "英句"}
    cards = ""
    found = 0
    for sent in RECENT_SENTS:
        it = by_char.get(sent)
        if not it:
            continue
        found += 1
        char = html.escape(sent)
        img = urllib.parse.quote(it["image"])
        cards += f"""
        <div class="card">
          <div class="imgwrap"><img src="/api/v1/char-images/file/{img}" alt="{char}" loading="lazy"></div>
          <div class="info"><span class="word">{char}</span><span class="type">英句</span></div>
        </div>"""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>新图审核（{found}/{len(RECENT_SENTS)}）</title>
<style>
  body {{ font-family: -apple-system, "Microsoft YaHei", sans-serif; background:#f5f7fa; margin:0; padding:20px; }}
  h1 {{ font-size:20px; color:#1a1a2e; text-align:center; }}
  .stats {{ text-align:center; color:#888; font-size:14px; margin:4px 0 16px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; max-width:1400px; margin:0 auto; }}
  .card {{ background:#fff; border-radius:14px; padding:12px; box-shadow:0 2px 12px rgba(0,0,0,.06); }}
  .imgwrap {{ background:#eee; border-radius:10px; overflow:hidden; aspect-ratio:1/1; display:flex; align-items:center; justify-content:center; }}
  .imgwrap img {{ max-width:100%; max-height:100%; object-fit:contain; }}
  .info {{ display:flex; align-items:center; gap:8px; margin:10px 2px 4px; }}
  .word {{ font-size:15px; font-weight:700; color:#1a1a2e; word-break:break-word; }}
  .type {{ background:#4a6cf7; color:#fff; font-size:12px; padding:2px 8px; border-radius:20px; flex-shrink:0; }}
  a.back {{ display:block; text-align:center; color:#4a6cf7; margin-bottom:12px; text-decoration:none; }}
</style>
</head>
<body>
<h1>🆕 新图审核（{found}/{len(RECENT_SENTS)}）</h1>
<div class="stats">Seedream-5.0 重配的 24 张英句卡 · <a href="/review">查看全部英句</a></div>
<div class="grid">{cards}
</div>
</body>
</html>"""


# 在模块启动时初始化
_cfg = None


def main():
    cfg = load_config()
    host = cfg.server.host
    port = int(cfg.server.port)
    logger.info("启动服务器 %s:%d", host, port)
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    # 确保在 server_py 目录下运行
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
