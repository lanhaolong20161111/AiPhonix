# AiPhonix 架构评审报告

> 由 GLM-5.2 (`glm-5-2-260617`) 基于代码结构摘要自动生成 · 2026-08-20 12:39

> 摘要来源：`server_py/code_summary.txt`（collect_summary.py 生成）

---

作为资深架构评审专家，基于提供的 AiPhonix 项目代码结构摘要，以下是严谨、具体、结构化的架构评审报告。

## 1. 项目结构

### 现状描述
项目采用前后端分离架构。前端 `web/src` 遵循 React 现代最佳实践，按 `pages`（页面）、`components`（组件）、`hooks`（逻辑复用）、`services`（API 接口）、`stores`（状态管理）、`lib`（工具库）清晰分层。后端 `server_py` 采用 FastAPI，分为 `routes`（路由层）、`services`（服务层）、`utils`（工具层），核心入口与配置位于根目录。

### 亮点
- **前端目录职责单一**：`hooks` 和 `services` 拆分细致，如 `useAiChat.ts`、`useTts.ts` 独立于 UI，利于复用。
- **后端分层明确**：`routes/` 专注 HTTP 协议与 DTO 校验，`services/` 封装外部 API（如 `deepseek.py`, `baidutts.py`），职责边界清晰。

### 问题/风险
- **后端根目录污染严重**：`server_py/` 根目录散落大量脚本和测试文件（如 `douyin_download.py`, `gen_char_examples.py`, `test_*.py`, `start_*.bat`），甚至包含 `app.db` 和 `.mypy_cache`，严重混杂了应用入口与运维/开发工具。
- **路由文件过于庞大**：`routes/ai_chinese.py` 和 `routes/ai_homework.py` 包含了大量的内部函数（如 `_auto_orient`, `_ark_extract_text`, `_split_questions` 等），存在“胖路由”问题。

### 改进建议
- **整理根目录**：将脚本迁移至 `scripts/` 目录，测试迁移至 `tests/` 目录，启动脚本迁移至 `deploy/` 或 `ops/` 目录。确保 `.mypy_cache` 和 `app.db` 被加入 `.gitignore`。
- **拆分胖路由**：将 `routes/ai_chinese.py` 中的 OCR 解析、图像处理等业务逻辑下沉至 `services/` 层，路由层仅保留请求接收与响应返回。

## 2. 技术栈

### 现状描述
- **前端**：React 19 + Vite + TypeScript + Tailwind CSS，状态管理使用 Zustand（由 `stores/` 目录推断）。
- **后端**：FastAPI + SQLAlchemy (Async) + Pydantic + LangGraph（用于复杂多轮对话编排）。
- **外部依赖**：DeepSeek LLM、火山引擎 ARK（免费 LLM 与文生图）、百度 TTS、腾讯云 SOE（语音评测）、PaddleOCR/PP-Structure。

### 亮点
- **前沿且高效**：采用 React 19 和 LangGraph，技术选型非常前沿。LangGraph 结合 Checkpointer 落库，非常适合小学生闯关问答这种需要状态回溯的复杂业务。
- **成本控制意识**：`services/deepseek.py` 内置了预算控制（`BudgetExceededError`, `_record_cost`），且 `routes/free_llm.py` 专门提供绕过付费预算的免费通道，体现了良好的 LLM 成本管理。

### 问题/风险
- **高危调试接口**：`routes/dev_agent.py` 实现了一个 AI 编程助手，允许 LLM 通过 tool_calls 执行文件读写和命令运行。即使在项目目录内，这也是极大的安全隐患。
- **多 OCR/LLM 通道维护成本高**：同时集成了 ARK、DeepSeek、EasyOCR、PP-Structure，回退逻辑复杂。

### 改进建议
- **隔离高危接口**：`dev_agent` 路由必须在生产环境中通过环境变量严格禁用，或增加强鉴权机制（如仅限本地 IP 访问）。
- **统一外部服务适配**：考虑将 LLM 调用抽象为统一的 `LLMProvider` 接口，降低 `routes` 层直接处理多通道回退的耦合度。

## 3. 核心模块职责

### 现状描述
- **前端**：`lib/audioManager.ts` 和 `lib/pcmRecorder.ts` 负责底层音频处理；`services/` 负责对接后端 API；`pages/` 负责页面组装。
- **后端**：`database.py` 定义所有 ORM 模型；`services/quest_graph.py` 和 `services/ai_practice.py` 负责核心 AI 编排；`routes/` 负责 HTTP 接口。

### 亮点
- **智能图像预处理**：`utils/image_classify.py` 通过纯图像特征（PIL/OpenCV）预分类，决定走哪条识图通道，实现了“毫秒级免费分类 + 降本增效”的优秀设计。
- **状态机隔离**：数学闯关（`quest_graph.py`）与 AI 陪我练（`ai_practice.py`）各自维护独立的 LangGraph 图，互不干扰。

### 问题/风险
- **数据模型过度集中**：`database.py` 包含了 20 多个模型定义（User, Essay, QuestSessionRow, WikiPageRow 等），随着业务增长会变得难以维护。
- **职责越界**：`routes/wordbank.py` 和 `routes/practice.py` 中存在直接操作文件系统（`_load`, `_save`）的逻辑，路由层承担了持久化职责。

### 改进建议
- **拆分数据模型**：按业务域拆分 `database.py`，如 `models/user.py`, `models/chinese.py`, `models/practice.py`。
- **持久化下沉**：将 `routes/wordbank.py` 中的 JSON 文件读写逻辑下沉到 `services/` 层，或直接迁移至数据库。

## 4. 数据流

### 现状描述
- **AI 作业数据流**：前端拍照/上传 -> `routes/uploads.py` 接收 -> `utils/image_classify.py` 分类 -> `routes/ai_chinese.py` 调用 LLM 解析 -> 存入 `user_imports` 表 -> 前端拉取展示。
- **多轮对话数据流**：前端 `useAiChat` -> `routes/ai_chat.py` -> 读取 `student_profiles` -> 注入 Prompt 调 LLM -> 解析回复尾部标记回写画像 -> 返回前端。

### 亮点
- **跨会话学生画像**：`routes/ai_chat.py` 实现了从 LLM 回复中提取 `【画像】易错/掌握` 标记并持久化，下次对话自动注入，实现了真正的个性化记忆。
- **本地与云端协同**：`routes/free_llm.py` 将内网本地文件转 base64 内联给云端 LLM，巧妙解决了内网文件无法被云端直接访问的问题。

### 问题/风险
- **基于文件系统的缓存竞态**：`routes/ai_chinese.py` 中的 `_read_cache` 和 `_write_cache` 是同步的文件操作，在异步并发下极易产生竞态条件。
- **LLM 输出解析脆弱**：依赖正则或特定标记（如 `【画像】`）从 LLM 回复中提取结构化数据，一旦 LLM 输出格式偏差，流程就会中断。

### 改进建议
- **替换文件缓存**：将 `_read_cache` / `_write_cache` 替换为 Redis 或 SQLite，解决并发写入问题。
- **增强 LLM 输出鲁棒性**：对于结构化输出，尽量使用 LLM 的 Function Calling / Tool Call 能力，而非正则解析自然语言文本。

## 5. 线程模型

### 现状描述
- **前端**：使用 Web Audio API 的 `AudioWorkletProcessor`（`lib/pcmRecorder.ts` 中的 `MyProcessor`）在独立线程处理 PCM 音频录制，避免阻塞 UI 主线程。
- **后端**：FastAPI 基于 asyncio 事件循环。部分同步阻塞操作（如 `routes/uploads.py` 中的 `_recognize_sync`）存在。

### 亮点
- **前端音频处理架构正确**：使用 `AudioWorklet` 替代已废弃的 `ScriptProcessorNode`，保证了录音过程的高性能与低延迟。

### 问题/风险
- **事件循环阻塞风险**：`routes/uploads.py` 中的 `_recognize_sync`（OCR 识别）和 `routes/ai_chinese.py` 中的图像处理（`_compress_image`, `_auto_orient`）是 CPU 密集型同步操作，会阻塞 FastAPI 的整个事件循环，导致其他并发请求被挂起。 — **✅ 已修复（2026-08-20）**：`_auto_orient` / `_compress_image` / `classify_image` / `crop_to_box` 共 11 处已用 `asyncio.to_thread()` 包裹（ai_chinese.py / ai_homework.py / uploads.py），修复方案与完整代码由 GLM-5.2 生成。
- **异步锁使用不当**：`routes/chinese_practice.py` 中使用了 `asyncio.Lock` 保护句子生成，但如果锁内包含同步阻塞操作，依然会阻塞事件循环。

### 改进建议
- **卸载 CPU 密集任务**：使用 `asyncio.to_thread()` 或 FastAPI 的 `run_in_threadpool` 将 `_recognize_sync`、图像压缩与旋转等操作放到线程池中执行。

## 6. 异步模型

### 现状描述
- **前端**：基于 React Hooks 的异步模型，通过 `stores` 管理全局状态。
- **后端**：全链路异步。SQLAlchemy 使用 `AsyncSession`，外部 HTTP 调用使用 `httpx.AsyncClient`（如 `services/pp_structure.py`），LangGraph 节点均为 `async def`。

### 亮点
- **真正的端到端异步**：从数据库（`database.py` 的 `async def get_session`）到外部 API（`services/pp_structure.py` 的 `httpx.AsyncClient`）均保持异步，最大化并发能力。
- **异步轮询设计良好**：`services/pp_structure.py` 中的 `_submit` -> `_poll` -> `_download_jsonl` 异步轮询模式，是处理异步长任务的优秀实践。

### 问题/风险
- **同步文件 I/O 混入异步上下文**：`services/deepseek.py` 中的 `_load_logs`, `_save_logs` 等日志和预算记录操作使用同步文件 I/O，在频繁调用时会拖慢异步性能。
- **WebSocket 资源管理**：`services/soe.py` 原生实现腾讯云 SOE WebSocket，若未正确处理超时与断连，可能造成连接泄漏。

### 改进建议
- **异步文件 I/O**：将 `services/deepseek.py` 中的文件读写替换为 `aiofiles`。
- **WebSocket 健壮性**：为 `services/soe.py` 的 WebSocket 请求增加严格的超时控制与异常捕获。

## 7. 主要业务流程

### 现状描述
- **AI 作业闯关流程**：拍照识题 -> `utils/image_classify.py` 预判 -> LLM 提取题目 -> `services/quest_graph.py` 构建状态机 -> 学生答题 -> LangGraph 节点流转（生成计划 -> 提问 -> 判题 -> 降解 -> 讲解） -> 落库 Checkpointer。
- **语音评测流程**：前端 `pcmRecorder.ts` 录音 -> `routes/soe.py` 接收 -> `services/soe.py` 调用腾讯云 WebSocket -> 返回评测结果 -> 存入 `SpeechEvalRecord`。

### 亮点
- **数学闯关的降级策略**：`services/quest_graph.py` 包含 `degrade`（子问题降解）和 `concept_degrade`（概念降解）节点，当小学生答错时能够智能拆解问题，符合教育心理学。
- **多模态 OCR 融合**：作业解析流程结合了 ARK 多模态、PP-Structure 版面分析和 EasyOCR 回退，容错率极高。

### 问题/风险
- **闯关回溯的复杂性**：`quest_graph.py` 支持回溯到选错时刻重做（`replay` / `resume`），这对 Checkpointer 状态管理要求极高，容易出现状态不一致。
- **音频文件存储分散**：`routes/char_images.py` 和 `routes/ai_chinese.py` 都有处理音频上传/下发的逻辑，音频文件散落在不同目录。

### 改进建议
- **状态机测试覆盖**：为 `quest_graph.py` 编写端到端的状态流转测试，特别是针对回溯、重做等边界场景。
- **统一静态资源管理**：将音频、图片等静态资源统一由一个 `static_service` 或对象存储（OSS/MinIO）管理，路由层只负责业务逻辑。

## 总结

### 总体评价
AiPhonix 是一个业务逻辑丰富、技术选型现代的优秀教育类 AI 项目。前端充分利用了 React 19 与 Web Audio API 的能力，后端深度集成了 LangGraph、多模态 LLM 与异步架构，特别是在 LLM 成本控制、图像智能预分类、数学闯关状态机设计上展现了极高的工程水准。然而，项目在工程规范（根目录混乱、胖路由）、性能（异步上下文中的同步阻塞）和安全（Dev Agent 接口）方面存在明显的架构债务，需要尽快偿还以支撑业务的规模化扩展。

### 最需要优先改进的 3 件事
1. **消除异步上下文中的同步阻塞（高优）**：立即将 `routes/uploads.py` 的 OCR 识别和 `routes/ai_chinese.py` 的图像处理逻辑包裹在 `asyncio.to_thread()` 中，防止并发请求时服务卡死。 — **✅ 已修复（2026-08-20）**
2. **清理工程结构与拆分胖路由（中优）**：整理 `server_py/` 根目录，将脚本与测试移出；将 `ai_chinese.py` 等胖路由中的业务逻辑下沉至 `services/`，保持路由层精简。
3. **封堵高危安全漏洞（高优）**：严格限制或禁用 `routes/dev_agent.py` 接口在生产环境的暴露，防止通过 LLM 发起任意文件读写与命令执行攻击。