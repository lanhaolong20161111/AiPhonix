# 部署指南 — AiPhonix 容器化部署到云端
#
# ── 前提条件 ───────────────────────────────────────────
# 1. Docker (云服务器已安装 Docker)
# 2. 一个容器镜像仓库（可选：Docker Hub / 阿里云容器镜像服务 / 腾讯云 TCR）
#
# ── 步骤 1：构建镜像 ──────────────────────────────────
#   在项目根目录 (android_cli_demos/) 执行：
#
#   docker build -t aiphonix-server -f server_py/Dockerfile .
#
#   （或者在 AiPhonix/ 目录下执行）
#   cd AiPhonix
#   docker build -t aiphonix-server -f server_py/Dockerfile .
#
# ── 步骤 2：本地测试 ──────────────────────────────────
#   docker run -d --name aiphonix \
#     -p 8080:8080 \
#     -e ARK_API_KEY=你的密钥 \
#     -e TENCENT_SECRET_ID=你的密钥 \
#     -e TENCENT_SECRET_KEY=你的密钥 \
#     aiphonix-server
#
#   或使用 docker compose（推荐）:
#   cp .env.example .env   # 编辑 .env 填入密钥
#   docker compose up -d
#
# ── 步骤 3：推送到镜像仓库 ─────────────────────────────
#   # Docker Hub
#   docker tag aiphonix-server yourname/aiphonix-server:latest
#   docker push yourname/aiphonix-server:latest
#
#   # 阿里云容器镜像服务
#   docker tag aiphonix-server registry.cn-hangzhou.aliyuncs.com/your-ns/aiphonix-server:latest
#   docker push registry.cn-hangzhou.aliyuncs.com/your-ns/aiphonix-server:latest
#
# ── 步骤 4：云服务器上运行 ────────────────────────────
#   docker pull yourname/aiphonix-server:latest
#   docker run -d --name aiphonix --restart unless-stopped \
#     -p 8080:8080 \
#     -e ARK_API_KEY=... \
#     -e TENCENT_SECRET_ID=... \
#     -e TENCENT_SECRET_KEY=... \
#     -v char_images_data:/app/data/char_images \
#     yourname/aiphonix-server:latest
#
# ── 云平台推荐 ──────────────────────────────────────
# 1. 腾讯云 CVM + 安装 Docker → docker run（最低 2核4G）
# 2. 腾讯云 TKE（容器服务）→ 直接部署 YAML
# 3. 阿里云 ECS + Docker
# 4. AWS EC2 + Docker
# 5. Railway / Render（简单但贵）
#
# ── 云服务器最低配置 ────────────────────────────────
#   CPU:     2 核
#   内存:    4 GB
#  磁盘:    20 GB（数据 + 图片 ~500MB）
#  带宽:    按量计费（主要传输图片和TTS音频）
#  系统:    Ubuntu 22.04 / Debian 12 / CentOS 7+
#  端口:    开放 8080（或通过 Nginx 反代到 80/443）
#
# ── 云部署需要准备的环境变量 ─────────────────────────
#  必填（至少填一个服务才有用）:
#    ARK_API_KEY            — 火山引擎 ARK（图片生成）
#
#  按需:
#    DEEPSEEK_API_KEY       — DeepSeek LLM（英语/语文教学）
#    BAIDU_TTS_APP_ID       — 百度 TTS（语音合成）
#    BAIDU_TTS_API_KEY
#    BAIDU_TTS_SECRET_KEY
#    TENCENT_APP_ID         — 腾讯 SOE（语音评测）
#    TENCENT_SECRET_ID
#    TENCENT_SECRET_KEY
#
# ── 数据持久化 ──────────────────────────────────────
#  容器重启后图片数据会丢失，建议挂载外部卷：
#    docker volume create aiphonix-char-images
#    docker run ... -v aiphonix-char-images:/app/data/char_images ...
#
# ── HTTPS 配置（推荐） ──────────────────────────────
#  用 Nginx 反代:
#    server {
#        listen 443 ssl;
#        ssl_certificate /path/to/cert.pem;
#        ssl_certificate_key /path/to/key.pem;
#        location / {
#            proxy_pass http://127.0.0.1:8080;
#            proxy_set_header Host $host;
#        }
#    }
#
#  或用 Cloudflare Tunnel（零成本）:
#    cloudflared tunnel --url http://localhost:8080
