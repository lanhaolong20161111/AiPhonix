# ===== Dockerfile =====
# AiPhonix Python 服务端容器化
# 构建: docker build -t aiphonix-server -f server_py/Dockerfile .
# 运行: docker run -p 8080:8080 --env-file .env aiphonix-server

FROM python:3.12-slim AS builder

WORKDIR /app

# 安装系统依赖（SOE WebSocket SDK 需要 SSL）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY server_py/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ===== 运行阶段 =====
FROM python:3.12-slim

WORKDIR /app

# 从 builder 复制已安装的包
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# 复制服务端代码
COPY server_py/ .

# 创建数据目录（持久化用）
VOLUME ["/app/data/char_images", "/app/data/char_audio"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

EXPOSE 8080

# 默认配置路径可以用环境变量覆盖
ENV CONFIG_PATH=config.yaml

# 启动（生产模式，不热重载）
CMD ["python", "run_server.py"]
