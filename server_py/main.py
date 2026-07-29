"""AiPhonix Python 服务端 — FastAPI 入口"""

import logging
import os
import sys

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import load_config

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
logger = logging.getLogger(__name__)

# 创建 app
app = FastAPI(title="AiPhonix Server", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


def _init_routes():
    """初始化所有路由（延迟导入，解决循环依赖）"""
    from routes import llm, quiz, tts, soe, wordbank, chinese_practice, practice, practice_tracker, word_suggestions, english, char_images, ark_image

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
    english  # no init needed
    char_images.init()

    from services import ark_image as ark_svc
    ark_svc.init(cfg.ark_image)

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
    app.include_router(ark_image.router, prefix="/api/v1")

    logger.info("所有路由已注册")
    return cfg


@app.on_event("startup")
async def startup():
    global _cfg
    _cfg = _init_routes()
    model = _cfg.deepseek.model
    addr = f"{_cfg.server.host}:{_cfg.server.port}"
    logger.info("AiPhonix 服务器启动: %s (模型: %s)", addr, model)


@app.get("/health")
async def health():
    return {"status": "ok", "model": _cfg.deepseek.model if hasattr(_cfg, 'deepseek') else "unknown"}


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
