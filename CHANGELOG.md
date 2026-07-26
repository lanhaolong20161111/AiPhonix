# Changelog

## [0.1.0] — 2026-07-20 — Phase 1: 项目骨架搭建完毕

### 新增
- **项目初始化**：基于 Android CLI empty-activity 模板创建
  - 包名: `com.example.ai` | 应用名: "ai伴我学发音"
  - 技术栈: Compose + Navigation 3 + 手动 DI (AppContainer)
  - minSdk 26, targetSdk 36, AGP 9.0.1

- **架构层**
  - Domain model: `Letter`, `Phoneme`, `Word`, `PronunciationResult`, `LessonPlan`
  - Repository 层: `ContentRepository`（本地 JSON 词库）、`SpeechRepository`（接口 + Mock）、`LLMRepository`（接口 + Mock）
  - 手动 DI: `AppContainer` 持有所有 repository 实例
  - Navigation 3: 5 个路由 `Home` / `Letter` / `Phonics` / `Practice` / `Report`

- **UI 页面（5 屏）**
  - **首页**: 连续学习天数、今日任务、字母 & 拼读入口卡片
  - **字母学习**: 大小写展示 + IPA + 口型说明 + 3 个示例单词
  - **自然拼读**: 音素分组、口型舌位说明、6 词网格
  - **发音评测**: 状态机（Idle→Playing→Recording→Assessing→Result）
    - 波形动画、星星评分、音素热力图、AI 建议
  - **学习报告**: 本周统计、弱项分析

- **词库**：`assets/wordbank.json` 含 46 个 emoji 单词，覆盖 26 字母 + 20 核心音素

### 技术决策
- ❌ 去掉 Hilt（不兼容 AGP 9），改用手动 DI（`AppContainer`）
- ✅ 使用 `collectAsStateWithLifecycle` 收集 UI 状态
- ✅ 所有 ViewModel 使用构造注入（通过 factory lambda）
- ✅ PronunciationViewModel 实现完整状态机

### 构建
- `./gradlew assembleDebug` ✅ BUILD SUCCESSFUL
- APK 输出: `app/build/outputs/apk/debug/app-debug.apk`

## [0.2.0] — 2026-07-20 — 词库扩充：音标覆盖达 90%

### 新增
- **17 个新单词**，补充缺失 IPA 音标：`cake`, `face`, `rain`, `cow`, `house`, `mouse`, `boy`, `toy`, `coin`, `thumb`, `mouth`, `bath`, `this`, `feather`, `mother`, `bird`, `girl`, `television`
- **7 个新音标教学描述**：/aʊ/, /ɔɪ/, /θ/, /ð/, /ɜː/, /ʒ/（含口型/舌位/常见错误）
- 总词库：46 → **63 个单词**

### 音标覆盖变化
| 类别 | 之前 | 现在 |
|---|---|---|
| 单元音 | 11 | 12（+ /ɜː/） |
| 双元音 | 2 | 5（+ /eɪ/ /aʊ/ /ɔɪ/） |
| 辅音 | 20 | 23（+ /θ/ /ð/ /ʒ/） |
| **合计** | **33** | **40**（≈ 英语 44 音的 90%） |

## [0.3.0] — 2026-07-20 — 接入 DeepSeek LLM

### 新增
- **DeepSeek LLM 集成**：基于 OpenAI 兼容接口调用 DeepSeek Chat Completions API
- **3 个 AI 功能**：
  - `generateFeedback`：根据评测结果生成儿童友好的口语改进建议（含 emoji + 鼓励语）
  - `generateLetterLesson`：动态生成字母教学讲解（发音/口型/记忆联想）
  - `generateLessonPlan`：根据学习进度生成个性化每日任务计划
- **配置系统**：`deepseek.local.properties` 配置文件（已 gitignored）
- **自动降级**：有配置使用 DeepSeek，无配置自动回退到 MockLLMRepository

### 配置方式
1. 复制 `deepseek.local.properties.template` → `deepseek.local.properties`
2. 从 https://platform.deepseek.com/api_keys 获取 API Key
3. 填入 `deepseek.apiKey=sk-xxx`

### 技术说明
- 使用 OkHttp 同步调用 + `Dispatchers.IO` 确保 main-safe
- 超时设置：connect 30s / read 60s / write 30s
- 所有回复要求简短（≤3 句）+ 儿童语言 + 简体中文 + emoji
- 模型默认 `deepseek-chat`，可在配置文件中修改

### 构建
- `./gradlew assembleDebug` ✅ BUILD SUCCESSFUL
