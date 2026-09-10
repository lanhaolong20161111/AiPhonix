# SESSION_HANDOFF_OPENAICLI_20260811

> 本交接由 opencode 会话（2026-08-10 ~ 08-11）产出：数学模块搭积木/信息猎人/动态提示词模板库/TTS 全面修复/麦克风录音。
> 新会话先读本文件，再按需读 `memory-export-20260810.md`（Reasonix 50 条记忆全文）与 `AGENTS.md`（开发规范）。

## 1. 环境状态（当前有效）

- 项目根：`C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix`
- 服务端：`server_py`（uvicorn 8080，已运行 health OK；启动必须 `Start-Process` 分离或 VBS 自启，前台进程会被会话清理）
  - 数据库实际在 `server_py/data/app.db`（不是根目录 app.db！DATABASE_URL 指向 data/）
- 客户端：包 `com.example.ai`，Compose + Navigation 3；构建 `.\gradlew.bat :app:assembleDebug`（gradle daemon 冷启动慢 → run_in_background + wait）
- 设备：`4HPJM7W48XNR9XLV`（无线 adb 时好时坏，掉线需手机重新开无线调试；adb 命令一律 `-s 4HPJM7W48XNR9XLV`）
- 电脑 IP：192.168.1.10（DHCP 动态；serverBase 在 `ServiceModule.serverBase` 一处管理，TTS 已统一走它）
- 模型：文本 `deepseek-v4-flash-ga-260731`（analyze 必须 max_tokens 8192）；识图 `doubao-seed-evolving`（MULTIMODAL_MODEL）

## 2. 本会话完成（全部已装机验证）

### 2.1 搭积木模块（ui/aihomework/BlockBuilder*）
- 磁吸：仅两端点磁吸（端点对齐端点，中点不吸；**完全重合不吸**——否则重叠线段拖不开）
- 线段全局等比缩放：k × 数值，无基准；超画布仅显示层缩放（**k 不被污染**，改小自动恢复）；两指缩放改 k；拖手柄跟随
- 单位换算比例（米/厘米/…、时/分/秒、元/角/分、千克/克/斤、升/毫升；不同单位类型不比较；空单位视为同单位）
- 均分（segments）：**有余数**时商段+橙色余数段，每段下方标数量，两端向下大括号+尖下总数
- 放大倍数（times）：N 段复制拼接（总长不变分 N 段）
- 多中间端点（midPoints）：拖拽式添加（🎯 模式：左/右端点拖出红点，实时显示距离，✅ 确定）；每段自动标数量
- 左/右端点名称（leftLabel/rightLabel）
- 左对齐/右对齐（以最上面线段 y 最小者为边界）
- 🤖 自动搭线段图：LLM 提取（segments/times/diff/brace）→ 生成初始线段（数值比例、左对齐、未知虚线）
- 已删组件：数值、大括号、小人、节点圆、文本、动态积木（✨倍数条）——组件栏仅剩 线段/虚线
- 已删功能：增加长度（extra 字段保留在模型，UI 已移除）
- 操作行用 FlowRow 防截断；点击选中（tap）+ 重叠循环切换；选中拖动保持

### 2.2 关键条件区域（识别页+练习页统一）
- 一句话一个方框（按 。？！ 切分，逗号不断句；服务端 `_split_sentences`）
- 每句 🔊（TTS）+ 🎤（麦克风录音上传服务端）+ ▶（播放录音，已录时显示）
- 句内高亮关键条件（is_key 黄底黑字加粗 + highlight 片段深红加粗 AnnotatedString）
- 互斥：🔊 播放中 → 🎤/▶ 禁用；🎤 录音中 → 所有 🔊/▶ 禁用（练习页还与 ASR 录音互斥）

### 2.3 TTS 全面修复（data/tts/BaiduTtsCache.kt + 两个 aihomework ViewModel）
- 分段播放（splitForTts，120 字/段按标点断）——规避百度单次合成限制
- **下载/播放都不设协程超时**（百度合成偶发 70s+，超时会取消播放但阻塞 IO 继续下载 → "下载成功却不播"）
- 服务端 baidutts.py：网络/SSL 异常自动重试 3 次（百度偶发 UNEXPECTED_EOF_WHILE_READING）
- 防重音三层：VM speakLock(AtomicBoolean) + BaiduTtsCache.playLock(全局) + UI enabled 置灰
- 返回键停止：Screen DisposableEffect onDispose → cancelSpeaking()（取消协程+stopAll）；VM onCleared 双保险（**已实测生效**）
- 失败可见反馈：error 提示区"朗读失败：网络或服务器异常"
- 服务端地址统一 ServiceModule.serverBase（之前 fallback 旧 IP 192.168.1.3 导致无声）

### 2.4 麦克风录音（学生朗读 → 服务端）
- 服务端：POST/GET `/ai-homework/sentence-audio` + `/{hash}/exists`（按句子 MD5 存 data/ai_homework_sentence_audio/）
- 客户端：MediaRecorder(AAC m4a) → uploadSentenceAudio → recordedSentences 本地回显 → ▶ playRemote（带 JWT header）

### 2.5 信息猎人（ui/infohunter/，入口：AI 陪我练 → 数学应用题下方绿色卡片）
- 六关问答：找数字（**每个数字一个方框填写**）→ 贴标签（数字↔实体配对）→ 找关系词（点击收集）→ 已知/未知（点选）→ 汇总 → 自己列算式（LLM 只点评关系不给答案）
- 每关标题右侧 💡 提示按钮（显示答案）
- 支持拍照/相册识别题目（复用 parse-image）+ 手动粘贴
- 服务端：`/ai-homework/hunter-analyze`（只提取信息结构）、`/ai-homework/hunter-check`（判算式关系）

### 2.6 动态题型提示词 + 模板库（重点新架构）
- `server_py/question_classifier.py`：本地 15 类题型（鸡兔同笼/植树/年龄/分数/平均/工程/行程/周期/剩余/分配/价格/倍数/和差/几何/单位换算）+ `signature_of()` 结构指纹（关系词集合+数字个数）
- `server_py/prompts_aihomework.py`：Jinja2 模板（analyze + hunter-analyze），按题型注入【题型专项】段
- **模板库**：`question_templates` 表（database.py）——LLM 首次分析顺带返回 `question_type/type_hint` 自动入库；同签名题直接命中复用（analyze/hunter 共用），hit_count 计数；已 e2e 验证（首次入库 4.8s → 同构题命中 3.4s）

## 3. 坑（本会话反复踩）

- 无线 adb：输入事件偶发丢失（ColorOS 限制注入）→ tap/swipe 时灵时不灵；uiautomator bounds 与视觉有偏差，像素级验证用截图颜色扫描
- 改 prompt/模型后**必须清缓存** `server_py/data/ai_homework_cache/`（analyze_/hunter_/steps_/questions_/parse_/blocks_）
- Python 关键字不能作字段名（`from` → source）
- Jinja2 无内置 enumerate；模板里用 `{% for i in range(sentences|length) %}`
- 服务端日志未重定向（排查请求先看客户端 logcat TAG BaiduTtsCache / 服务端缓存文件时间）
- mypy 对 httpx timeout 用 `httpx.Timeout(120.0, connect=10.0)`

## 4. 待办 / 可继续

- 信息猎人：第三关（找关系词）当前靠点击收集，可考虑改填写/选项；多题识别结果目前只取第一题
- 模板库：管理端点（查看/删除错误模板）、按 hit_count 展示热点题型
- 关系一致性校验（LLM 提取的关系自洽性检查，轻量规则即可）
- 客户端 APK 已是最新；新改动需重新构建装机

## 5. 如何导出本会话到新会话（方法）

1. **本项目内**：本文件 `SESSION_HANDOFF_OPENAICLI_20260811.md` 就是交接文档——复制/保留，新会话第一句"读 SESSION_HANDOFF_OPENAICLI_20260811.md"即可完整接手
2. **Reasonix 记忆**（如果想让 Reasonix 也记住）：把本文件内容追加进 Reasonix 记忆（如 log-after-operation 或新建一条），或直接复制 `%APPDATA%\reasonix\projects\c--users-lhl20-desktop-android_cli_demos\memory\` 下 .md 导出（注意只读不改 state）
3. **opencode 自带**：本会话所有关键结论都已写进本文件 + memory-export 系列，新会话读文件即可，无需其他机制
