# AiPhonix 后端三端（PY / TS / Go）对比文档

> 生成日期：2026-08-24。目的：记录三端服务端实现的对应关系、技术差异与已知偏差，
> 供「替换部署 / 行为对齐 / 回归验证」参考。Go 版为新增（server_go/），功能对齐 PY/TS。

---

## 一、技术栈对比

| 维度 | PY (server_py/) | TS (server_ts/) | Go (server_go/) |
|---|---|---|---|
| 语言/运行时 | Python 3.14 + uvicorn | Node.js + Hono 4 | Go 1.26 + chi/v5 |
| HTTP 框架 | FastAPI | @hono/node-server | github.com/go-chi/chi/v5 |
| 数据库驱动 | SQLAlchemy async + aiosqlite | better-sqlite3 (WAL) + drizzle | database/sql + modernc.org/sqlite（纯 Go 无 CGO） |
| 共享数据 | server_py/data/app.db + config.yaml | 同左 | 同左（复用同一 app.db / config.yaml） |
| 配置加载 | pydantic + env | zod + env | yaml.v3 + env（不校验类型，缺字段用默认值） |
| 认证 | PyJWT HS256 + passlib bcrypt | jose HS256 + bcryptjs | 自实现 HS256 + x/crypto/bcrypt |
| 预算守卫 | data/llm_budget.json + llm_call_logs.json | 同文件 | 同文件（复刻逻辑） |
| LLM（付费） | httpx → DeepSeek | fetch → DeepSeek | net/http → DeepSeek |
| LLM（免费 Ark） | volcenginesdkarkruntime | fetch → ARK Responses | net/http → ARK Responses |
| 多模态识图 | 同 Ark（doubao-seed-evolving） | 同左 | 同左 |
| 图片处理 | PIL（EXIF/压缩/裁剪） | sharp | 标准库 image（EXIF 旋转降级，见偏差） |
| EasyOCR 回退 | 进程内 easyocr | 桥接 ts_image_bridge.py 子进程 | 同 TS：桥接 ts_image_bridge.py 子进程 |
| 腾讯 SOE | tencentcloud WebSocket SDK | ？ | 骨架（501，待接入） |
| 百度 TTS | 自实现 HTTP + 缓存 | 自实现 | 自实现（MD5 签名对齐 PY） |
| 订阅/路由数 | 143 条（28 文件） | 143 条 | 对齐中（30 文件） |

## 二、模块映射

| PY 路由文件 | TS 路由文件 | Go 路由文件 | 路由数(PY) |
|---|---|---|---|
| routes/auth.py | routes/auth.ts | routes/auth.go | 4 |
| routes/users.py | routes/users.ts | routes/users.go | 2 |
| routes/uploads.py | routes/uploads.ts | routes/uploads.go | 4 |
| routes/wordbank.py | routes/wordbank.ts | routes/wordbank.go | 4 |
| routes/pinyin_audio.py | routes/pinyin_audio.ts | routes/pinyin_audio.go | 1 |
| routes/ipa_audio.py | routes/ipa_audio.ts | routes/ipa_audio.go | 1 |
| routes/tts.py | routes/tts.ts | routes/tts.go | 1 |
| routes/quiz.py | routes/quiz.ts | routes/quiz.go | 2 |
| routes/llm.py | routes/llm.ts(ai_chat 内) | routes/llm.go | 4 |
| routes/free_llm.py | routes/free_llm.ts | routes/free_llm.go | 1 |
| routes/essays.py | routes/essays.ts | routes/essays.go | 6 |
| routes/practice.py | routes/practice.ts | routes/practice.go | 3 |
| routes/practice_tracker.py | routes/practice_tracker.ts | routes/practice_tracker.go | 3 |
| routes/chinese_practice.py | routes/chinese.ts | routes/chinese_practice.go | 4 |
| routes/char_images.py | routes/char_images.ts | routes/char_images.go | 8 |
| routes/english.py | routes/english.ts | routes/english.go | 2 |
| routes/import_templates.py | routes/import_templates.ts | routes/import_templates.go | 1 |
| routes/user_imports.py | routes/user_imports.ts | routes/user_imports.go | 3 |
| routes/training.py | routes/training.ts | routes/training.go | 4 |
| routes/ai_chinese.py | routes/ai_chinese.ts | routes/ai_chinese.go | 52 |
| routes/ai_homework.py | routes/ai_homework.ts | routes/ai_homework.go | 22 |
| routes/ai_chat.py | routes/ai_chat.ts | routes/ai_chat.go | 1 |
| routes/ai_practice.py | routes/ai_practice.ts | routes/ai_practice.go | 4 |
| routes/word_suggestions.py | routes/word_suggestions.ts | routes/word_suggestions.go | 1 |
| routes/ark_image.py | routes/ark_image.ts | routes/ark_image.go | 1 |
| routes/soe.py | routes/soe.ts | routes/soe.go | 4 |
| routes/dev_agent.py | routes/dev_agent.ts | routes/dev_agent.go | 2 |
| （TS-only） | routes/subtitleCapture.ts | routes/subtitle_capture.go | （TS/GO 独有，PY 无） |
| utils/ai_text_utils.py | lib/aiTextUtils.ts | routes/textutils.go | （工具） |
| services/deepseek.py | lib/deepseek.ts | internal/llm/llm.go | （服务） |
| services/free_llm.py | lib/ark.ts | 同 llm.go | （服务） |

## 三、已知偏差（Go 版 vs PY/TS）

| 项 | 说明 | 影响 |
|---|---|---|
| EXIF 图片旋转 | Go 标准库 image 不支持 EXIF orientation 自动旋转；PY/TS 会旋转像素。Go 上传/识图对横倒图识别方向可能异常 | 中（受手机拍照方向影响） |
| 拼音动态生成 | char_images/word-info 的 pinyin 动态生成（pypinyin）Go 未实现，仅用索引已有 pinyin 字段 | 低（索引大多有 pinyin） |
| 腾讯 SOE 评测 | Go 版 services/soe.go 为骨架，evaluate 返回 501；records/delete 已实现 | 中（评测链路不可用） |
| ai_practice 状态机 | PY 用 LangGraph，Go 简化为 LLM 直接生成 question/grade（路由契约一致） | 低（多轮引导质量可能略降） |
| dev_agent | GLM-5.2 工具调用已实现；run_command 用 cmd /c | 低 |
| 配置校验 | PY pydantic 启动即校验类型；Go 弱校验（缺字段用默认值） | 低 |
| ai_homework 发音/评测明细 | 部分降级，见文件内 TODO | 低 |

## 四、验证状态

- [x] `go build ./...` 零错误（go 1.26.5，modernc sqlite 纯 Go）
- [x] 启动冒烟（端口 8081）：/health、auth register/login/me、wordbank stats/query、essays、practice stats、training plan、char-images、chinese/polyphone、english/vocabulary、subtitle-capture/list 全部 HTTP 200
- [x] parse-image 链路打通：走到 Ark 识图调用（外部 API 偶发 EOF 时返回 422 诊断，链路正确）
- [ ] 三端逐路由行为对比（抽样为主，非全量）

### 偏差补充（Go 版实测确认）

| 项 | 说明 | 影响 |
|---|---|---|
| Quest/闯关 16 路由 | ai_chinese/ai_homework 各 8 个 quest 端点返回 501 占位（无 LangGraph） | 中（闯关功能不可用） |
| EXIF 旋转 | Go 未实现 auto_orient；横倒图识别方向可能异常 | 中 |
| 拼音动态生成 | 未实现 pypinyin；用索引已有 pinyin | 低 |
| SOE 评测 | Go services/soe.go 骨架，evaluate 501 | 中 |
| 图片预分类/区域切割 | classify_image/_detect_regions 未移植；crops 空 | 低-中 |
| /api/v1/search 认证 | Go 版要求 Bearer（PY/TS 无认证或前端带 token） | 低（前端带 token 即可） |

## 五、运行方式（Go）

```bash
cd AiPhonix/server_go
go build -o bin/server.exe ./cmd/server
PORT=8081 ./bin/server.exe   # 复用 server_py/data/app.db + config.yaml；默认 8080
```