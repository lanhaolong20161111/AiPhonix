# Android 开发规范 — 写代码前必读

每次写代码之前，**必须主动查询**这三类官方文档，确保代码符合 Android 最新推荐实践。

---

## 1️⃣ 最佳实践

### Android 应用架构
> 来源: [Recommendations for Android architecture](kb://android/topic/architecture/recommendations)

| 规范 | 优先级 |
|---|---|
| **分层架构**：清晰划分 Data Layer / UI Layer，Data Layer 通过 Repository 暴露数据 | 🔴 强烈推荐 |
| **单向数据流 (UDF)**：ViewModel 暴露 UI State，UI 通过事件回调通知 ViewModel | 🔴 强烈推荐 |
| **使用 `collectAsStateWithLifecycle`** 收集 UI 状态，而非 `collectAsState` | 🔴 强烈推荐 |
| **不要在 ViewModel 中向 UI 发送事件**：事件应在 ViewModel 中立即处理，通过 State 更新反映结果 | 🔴 强烈推荐 |
| **单 Activity 应用**，使用 Navigation 组件管理页面 | 🔴 强烈推荐 |
| **Jetpack Compose** 构建新 UI | 🔴 强烈推荐 |
| Domain Layer 仅在大型应用中需要使用 | 🟡 推荐 |
| **注入 Dispatchers**，不要硬编码 | 🔴 强烈推荐 |

### Compose 性能最佳实践
> 来源: [Follow best practices](kb://android/develop/ui/compose/performance/bestpractices)

| 规范 |
|---|
| 使用 `remember` 缓存昂贵计算结果，避免在 composable 函数体中重复计算 |
| Lazy layouts 必须提供 `key` 参数（稳定唯一 ID） |
| 使用 `derivedStateOf` 限制不必要的重组范围 |
| **延迟状态读取**：状态尽可能在低层级读取，读取点越靠近使用处越好 |
| 使用 lambda 版本的 Modifier（如 `Modifier.offset { }`）让 Compose 跳过 Composition 阶段直接进入 Layout/Draw |
| **禁止向后写入**：不要在已读取状态之后写入，会导致无限循环重组 |
| 优先将计算逻辑移到 ViewModel 中完成 |

### 协程最佳实践
> 来源: [Coroutines best practices](kb://android/kotlin/coroutines/coroutines-best-practices)

| 规范 |
|---|
| **注入 Dispatchers** 而非硬编码（便于测试） |
| **Suspend 函数必须 main-safe**：阻塞操作使用 `withContext(ioDispatcher)` |
| ViewModel 中创建协程（`viewModelScope.launch`），而非暴露 suspend 函数 |
| **不暴露可变类型**：使用 `MutableStateFlow` 私有 + `StateFlow` 公开的模式 |
| Data/Business Layer 暴露 `suspend fun`（一次性）或 `Flow`（数据流） |
| Data/Business Layer 中创建协程用 `coroutineScope` / `supervisorScope`，遵循调用方生命周期 |
| **避免 GlobalScope**，注入外部 CoroutineScope 用于需要超出页面生命周期的任务 |
| 确保协程可取消（`ensureActive()` 或调用 `kotlinx.coroutines` 的 suspend 函数） |
| 捕获特定异常类型（如 `IOException`），**不要捕获 `CancellationException`** |

### 依赖注入
> 来源: [Recommendations for Android architecture](kb://android/topic/architecture/recommendations)

| 规范 | 优先级 |
|---|---|
| **构造函数注入**优先，能用构造函数注入就不用其他方式 | 🔴 强烈推荐 |
| **不要用 `AndroidViewModel`**，使用普通 `ViewModel`；不要在 ViewModel 中持有 `Context`/`Activity`/`Resources` | 🟡 推荐 |
| 需要共享可变状态或初始化昂贵的类型时，scope 到依赖容器 | 🔴 强烈推荐 |
| 复杂项目（多页面 ViewModel、WorkManager、Navigation graph 作用域 ViewModel）用 **Hilt** | 🟡 推荐 |
| 简单项目可用手动依赖注入 | 🟡 推荐 |

### Lifecycle 处理
> 来源: [Recommendations for Android architecture](kb://android/topic/architecture/recommendations)

| 规范 |
|---|
| **不要在 `Activity` 生命周期方法中写业务逻辑**：`onCreate`/`onCreateView` 只做 Compose/View 初始化；禁止在 `onResume`/`onPause` 等方法中启动异步任务或数据处理 |
| 用 `LifecycleStartEffect` 在 Activity start/stop 时执行同步任务 |
| 用 `LifecycleResumeEffect` 在 Activity resume/pause 时执行同步任务 |
| 用 `repeatOnLifecycle` 在生命周期事件中执行异步任务 |
| 用 `collectAsStateWithLifecycle` 收集异步数据（Flow） |

### 测试规范
> 来源: [Recommendations for Android architecture](kb://android/topic/architecture/recommendations) · [Coroutines best practices](kb://android/kotlin/coroutines/coroutines-best-practices)

| 规范 |
|---|
| **优先用 Fake 而非 Mock** 作为测试替身 |
| 测试 `StateFlow` 时断言 `.value` 属性，配合 `WhileSubscribed` 策略 |
| 至少测：ViewModel + Flow 单测、Repository / DataSource 单测、UI 导航回归测试 |
| 测试中注入 `TestDispatcher`（`StandardTestDispatcher` / `UnconfinedTestDispatcher`），共享同一 `testScheduler` |
| 用 `runTest` 协程构建器测试协程，控制虚拟时间 |

### 安全规范
> 来源: [Security Best Practices](kb://android/privacy-and-security/security-best-practices)

| 规范 |
|---|
| **强制 TLS/HTTPS**：所有网络通信用 HTTPS，禁止明文流量 |
| **应用间通信**：隐式 Intent 配合 App Chooser，用签名权限保护共享数据 |
| **ContentProvider 默认不导出**（`android:exported="false"`），除非有意对外暴露 |
| **访问敏感信息前要求凭证**：PIN / 密码 / 生物识别 |
| **网络安全配置**：用 `network_security_config.xml` 管理信任锚，而非改代码 |
| **WebView 安全**：用 allowlist 限制可访问站点；除非完全信任否则禁用 JavaScript interface |
| Android 6.0+ 用 HTML message channels 替代 JS interface |

### 无障碍规范
> 来源: [Accessibility in Compose](kb://android/develop/ui/compose/accessibility/index) · [Principles](kb://android/guide/topics/ui/accessibility/principles)

| 规范 |
|---|
| **为每个交互元素提供 label**：用 `contentDescription` 或 `semantics` modifier |
| **优先用 Compose 默认无障碍行为**：Material 组件已内置，尽量不重复实现 |
| **除颜色外用其他方式区分元素**：图案、位置、大小，不能只靠颜色 |
| 编辑框用 `placeholder` 和 `label` 参数提供提示和描述 |
| 为媒体内容（视频/音频）添加文字描述 |
| 用 Compose 无障碍检查工具测试

### 应用启动优化
> 来源: [Best practices for app optimization](kb://android/topic/performance/appstartup/best-practices)

| 规范 |
|---|
| 使用 **Baseline Profiles** 提升 30% 首次启动速度 |
| 使用 **Startup Profile** 优化 DEX 布局 |
| 用 **App Startup 库** 替代多个 ContentProvider 初始化 |
| **延迟加载非必要库**：禁用自动初始化，按需初始化（如 WorkManager） |
| 优化 Splash Screen（Android 12+ 有原生支持） |
| 优先用 **矢量图 (vector drawables)**，其次 WebP |

### 字体颜色规范（视觉高对比，强约束）
> 项目专属 — 家长明确要求，所有页面一律遵守

| 规范 |
|---|
| **文字默认纯黑 `Color(0xFF000000)`**（白底/浅色卡片底一律纯黑），禁止用浅灰/淡蓝等低对比颜色作正文 |
| 正文/副标题/说明文字不用 `onSurfaceVariant` 灰色，也不用主题蓝等彩色；统一 `Color(0xFF000000)` |
| 语义强调色仅限：正确=绿 `0xFF2E7D32`、错误=红 `0xFFB71C1C`、播放中高亮=浅蓝 `0xFF90CAF9` |
| 背景色允许浅色（米黄 `0xFFFFF3D6`、浅绿 `0xFFE8F5E9` 等），但其上文字必须纯黑 |
| 图标/边框/选中态等非文字元素不受此限（可保留视觉功能色） |

### Kotlin 风格指南
> 来源: [Kotlin style guide](kb://android/kotlin/style-guide)

| 规范 |
|---|
| 源文件编码 **UTF-8** |
| 缩进用 **空格** 不用 Tab |
| 单顶层类文件名 = 类名.kt；多声明用 PascalCase 描述性名称 |
| 可打印 Unicode 字符直接用字符，不用 escape |
| 字符串字面量和注释中尽量不用 Unicode escape |

### AI/LLM 调用规范
> 项目专属 — 针对 LLM/AI Service 集成

| 规范 |
|---|
| **禁止 UI 层直接调用 LLM API**：Button onClick / composable 函数体中禁止出现网络调用 |
| 调用链必须为：`UI → ViewModel → UseCase → AIRepository → LLM Provider` |
| 所有 LLM 调用必须配置 **timeout、retry、cancellation** |
| LLM 调用必须 **logging**（请求/响应/耗时/错误），便于调试和监控 |
| LLM Provider 必须定义为 **interface**，便于 Fake 测试 |
| 测试用 `FakeLLMProvider` 替身，不 Mock 网络层 |

### Audio/ASR 引擎规范
> 项目专属 — 针对音频录制与语音识别

| 规范 |
|---|
| **禁止 Activity 直接控制 `AudioRecord`**：调用链必须为 `UI → ViewModel → AudioSessionManager → AudioRecord` |
| `AudioRecord` 必须 **单线程访问**，禁止多线程并发操作同一实例 |
| 音频引擎必须有 **明确状态机**：IDLE → RECORDING → PROCESSING → RELEASED |
| `AudioRecord` 必须 **release()**：在 `try-finally` 或 `Closeable.use{}` 中释放，防止泄露 |
| **禁止 AudioRecord 作为 global singleton**：生命周期由 ViewModel/SessionManager 管理 |
| 状态转换前检查当前状态，禁止非法转换（如 RELEASED → RECORDING） |

### Native/JNI 资源规范
> 项目专属 — 针对 sherpa-onnx 等 JNI 库

| 规范 |
|---|
| 所有 JNI 对象必须有 **明确生命周期所有者**（lifecycle owner） |
| JNI 对象必须提供 **close/release 方法**，在 `try-finally` 中调用 |
| **禁止在 `companion object` 中持有 Native 对象**：会导致无法释放或重复释放 |
| Native 资源释放前检查是否已释放，避免 double-free |
| ViewModel 的 `onCleared()` 中必须释放所有 Native 资源 |

### 数据库 DAO 边界规范
> 项目专属 — 针对 Room 数据库

| 规范 |
|---|
| **禁止 UI / ViewModel 直接调用 DAO**：调用链必须为 `ViewModel → UseCase → Repository → DAO` |
| DAO 只暴露给 Repository，Repository 对外只暴露 `suspend fun` 或 `Flow` |
| 数据库模型（Entity）不跨层暴露：Repository 负责映射为 UI/Domain model |

---

## 2️⃣ API 推荐用法

### Compose 组件 API 规范
> 来源: [API Guidelines for @Composable components](kb://android/jetpack/compose/compose-component-api-guidelines)

| 规范 |
|---|
| **单一职责**：一个组件只解决一个问题，不要搞多功能组合的组件 |
| **分层构建**：先提供低层 building block（`Checkbox`、`Text`），高层组件是它们的组合 |
| **优先用 Modifier 而非组件**：可应用于任意组件的行为做成 Modifier |
| **参数顺序**：`modifier` 始终是第一参数（如有），`content` lambda 始终是最后参数 |
| **为 composable 提供 KDoc**：包含一句话总结、详细说明、`@param` 描述 |
| **不要用 ViewModel 做可复用组件**：ViewModel 只在 Screen 级别使用 |
| 可复用 UI 组件使用 **plain state holder 类**，状态提升由外部控制 |
| 构造函数注入依赖，**不要用 `AndroidViewModel`** |
| UI State 统一命名为 `uiState`，类型为 `StateFlow`，用 `stateIn(WhileSubscribed(5000))` |
| Slot 参数优先用普通 `@Composable` lambda，**避免 DSL 风格**（除 Lazy 布局等需懒加载场景外） |
| 默认值放在 `ComponentDefaults` object 中 |
| 复杂颜色/elevation 逻辑用 `ComponentColors` / `ComponentElevation` 类隔离，而非 style 类 |
| 组件需支持 **Preview 和 Screenshot Testing**，初值能在非交互模式下渲染 |
| 新增参数**必须有默认值**（向后兼容）；移除参数是被禁止的 |

### 命名规范

| 规范 |
|---|
| 方法用动词短语：`makePayment()` |
| 属性用名词短语：`inProgressTopicSelection` |
| Flow 流命名：`get{Model}Stream(): Flow<Model>` |
| 接口实现用有意义的名称：`OfflineFirstNewsRepository`，无更好名称则用 `Default` 前缀 |
| Fake 实现前缀 `Fake`：`FakeAuthorsRepository` |
| 每个 Layer 可建独立 model，避免跨层直接暴露数据源模型 |

---

## 3️⃣ 迁移指南

### 从 View 到 Compose 的迁移策略
> 来源: [Migration strategy](kb://android/develop/ui/compose/migrate/strategy)

| 步骤 | 说明 |
|---|---|
| **先用 Compose 构建新界面** | 新功能页面直接用 Compose，Fragment 中用 `ComposeView` |
| **构建通用 UI 组件库** | 将通用 UI 元素提取为独立 Compose 组件库 |
| **逐屏替换** | 从简单页面开始，逐步替换现有 View 页面 |
| **迁移 Navigation** | 当所有目标都转换为 composable 后，迁移到 Navigation Compose |

### 从 Fragment Navigation 迁移到 Navigation Compose
> 来源: [Migrate from Fragment-based Navigation to Navigation Compose](kb://android/develop/ui/compose/migrate/migration-scenarios/navigation)

| 步骤 | 关键操作 |
|---|---|
| 1 | 添加 Navigation Compose 依赖 |
| 2 | 创建 App 级 composable，替换 `setContentView` |
| 3 | 用 `@Serializable data object/class` 定义路由 |
| 4 | 用 `rememberNavController()` 创建 `NavController` |
| 5 | 用 `NavHost` + `composable<T>` 构建导航图 |
| 6 | 传事件回调而非传 `NavController` 本身 |
| 7 | ViewModel 改为 `hiltViewModel()` |

### Navigation 3（新）
> 来源: [Navigation 3](kb://android/guide/navigation/navigation-3/index) · [Jetpack Navigation 3 Skill](kb://android/agents/skills/navigation/navigation-3/skill)

| 规范 |
|---|
| 官方架构文档已将 **Navigation 3** 列为推荐用于单 Activity 多页面导航 |
| Navigation 3 是 Compose 优先的导航库，提供对 back stack 的完全控制 |
| 新项目可优先评估 Navigation 3；老项目可按官方 Skill 指南迁移 |

---

## 工作流程

每次开始写代码前，按以下顺序执行：

1. **查最佳实践** → `android docs search "Android app architecture best practices"`
2. **查 API 推荐用法** → `android docs search "Jetpack Compose API best practices"` + 对应 API 名称
3. **查迁移指南** → `android docs search "Android migration guide <from> to <to>"`

遇到不确定的用法，随时用 `android docs fetch kb://<URL>` 拉取完整文档阅读。

---

## 4️⃣ AiPhonix 项目 — ChatGPT 代码评审与修复记录

> 来源: 第三方 ChatGPT 代码评审（2026-07-26），以及后续实施修复与发现的 Bug 记录。

### 代码评审发现（按严重程度）

| 问题 | 等级 | 状态 | 修复方式 |
|---|---|---|---|
| **音频协程无生命周期绑定** | P0 | ✅ 已修复 | `CoroutineScope(Dispatchers.IO).launch` → `withContext` + 子协程，绑定 viewModelScope |
| **Repository 职责过重** | P0 | ✅ 已修复 | 拆分为 `AudioRecorder`（PCM采集）、`ScoreClient`（HTTP+JSON解析）、`ProxySpeechRepository`（薄协调层） |
| **!! 非空断言滥用** | P2 | ✅ 已修复 | 4处（VideoPracticeScreen、QuizScreen、RecognitionScreen、WordBankRepository）替换为安全调用 |
| **AppContainer 上帝对象** | P1 | ✅ 已修复 | 模块化手动 DI：`NetworkModule`（共享 OkHttpClient）、`ServiceModule`（LLM/Quiz/TTS） |
| **服务端地址硬编码** | P1 | ✅ 已修复 | 集中 `ServiceModule.serverBase` 一处管理，fallback `http://192.168.1.7:8080` |
| **API 密钥泄露到 APK** | P1 | ✅ 已修复 | BuildConfig 密钥字段无 Kotlin 引用；config.yaml / soe_test/main.go 已替换为占位符 |
| **无统一网络层** | P2 | ✅ 已修复 | `NetworkModule` 单例 OkHttpClient（30s connect / 120s read / 30s write），8→1 处 |
| **流式 ASR 架构** | P2 | ⏸️ 暂缓 | 当前为录制→上传→评分模式，用户确认暂不改造 |
| **LLM 教学画像** | P2 | ⏸️ 暂缓 | `generateLessonPlan` 参数过于简单，需客户端存 UserProfile |
| **测试不足** | P3 | ✅ 已修复 | 31个单元测试通过：ScoreClientTest(11) + SrtParserTest(15) + WordBankRepositoryTest(5) |

### 本会话发现并修复的 Bug

| Bug | 根因 | 修复 |
|---|---|---|
| 默写"必"读出"跌"字 | 词库混入 LLM 垃圾 `"所以词语中必须包含"跌"字"`，搜索含"必"词时命中 | 清理 110 条垃圾数据；增加服务端验证 |
| 评测失败: null | `NetworkOnMainThreadException` — `scoreClient.evaluate()` OkHttp 同步调用在 Main 线程执行 | 包进 `withContext(Dispatchers.IO)` |
| 录音太短，请至少读一秒 | `AudioRecorder.stop()` 设 `stopped=true` 后未调用 `reset()`，下次录音循环立即退出 | `startStreamingEvaluation()` 前调 `audioRecorder.reset()` |
| startRecording() on uninitialized AudioRecord | 设备不支持 16kHz 采样率返回 `ERROR_BAD_VALUE` → AudioRecord 未初始化 | 采样率降级链 16000→44100→8000 + 初始化状态检查 |
| 字段默认值 pinyin="" 未生效 | Gson 绕过 Kotlin 构造器，缺省字段留为 null | 测试改为 `assertEquals(null, ...)` 匹配实际行为 |
| 词库清理后剩余 712→603 词 | 大量 LLM 生成时残留的提示词指令被当作词语录入 | `clean_garbage.py` 按标点/长度/LLM关键词 规则过滤 |

---

## 5️⃣ Web 化开发约定（2026-08-15 起）

> AiPhonix Web 端（`web/`，React 19 + Vite + TS）开发规范

### 测试方式
- **用户一律用手机浏览器测试页面**（Android Chrome 访问 `https://192.168.1.10:5173/web/`）。验证时优先考虑手机触控布局，不只测桌面。
- 手机首次访问自签证书需「高级→继续前往」；改代码后手机需清缓存或硬刷新。
- 麦克风录音（getUserMedia）必须在 **https 或 localhost** 下才能用——dev 用自签 https，生产需真 https。

### Web 端关键架构
- API 走同源 `/api/v1`（dev 由 Vite proxy → 127.0.0.1:8080，避免 https→http mixed content 被拦）。
- 字母视频 `/letter-clips/`、ipa 音频 `/api/v1/ipa-audio`、拼音音频 `/api/v1/pinyin-audio`。
- TTS 走服务端 `/tts/synthesize`（百度；edge-tts 已装可作回退）；全局 `audioManager` 保证同一时刻只播一个、切页中断。
- 录音：`lib/pcmRecorder.ts`（AudioWorklet 16kHz/16bit PCM）→ `useSoeScore` → `/api/v1/soe/evaluate`。
- 词库：`web/public/chinese_wordbank.json`（语文）+ `wordbank.json`/`english_vocabulary.json`（英语）。
- 家长按年级配置字词范围存在 `training/plan` 的 `PlanItem.config.grades`，练习页读取过滤。

### Web 端语音评分明细
- 发音评分页（`/module/pronounce/:wordId`）：**单词显示每个音素得分**（`result.words[0].phone_infos`），**句子显示每词得分**。明细颜色：≥80 绿 / 60-79 黄 / <60 红。
- `useSoeScore` 的 `state.result` 含完整 SoeResult（words + phone_infos）。

### 已知遗留
- 手机浏览器录音偶发「没检测到声音」/0 分——已加音量条调试，录音链路仍有待手机端实机验证（pcmRecorder 算法已验证正确）。
- Web 端已实现：登录/注册、首页+打卡、家长设置（PIN+年级批次）、认字/默写/词语/拼音、英语（字母/音素/发音评分）。未实现：视频跟读、词汇图片练习、AI 陪练、文章、素材导入等（占位页）。

---

## 6️⃣ 🔴 常犯错误清单（每次改代码前必查，避免重蹈覆辙）

> 这些错误都实际犯过并踩坑，按「改什么代码 → 查什么」组织。**改相关代码前先读对应条目**。

### SOE 评测模式必须按被测对象类型选（反复犯错）
> 腾讯 SOE 的 `eval_mode` 决定返回粒度，**选错模式拿不到对应明细**（尤其段落模式无音素 PhoneInfo）。这是反复出错的根因，已重构根治。

**腾讯 SOE eval_mode 枚举（接口文档 1774/107497）：**
| eval_mode | 模式 | 被测对象 | 返回粒度 |
|---|---|---|---|
| 0 | 单词/单字 | 英文 1 词 / 中文 1 汉字 | 单词+**音素**明细 |
| 1 | 句子 | 中文 ≤30 字 / 英文 ≤30 词 | 单词+音素明细 |
| 2 | 段落 | ≤120 字/词 | **只有单词级，无音素** |
| 8 | 拼音 | ≤30 拼音 | 音素明细 |

**调用约定（后端 `services/soe.py` + `routes/soe.py`）：**
- **前端必须传 `scene` 参数**（被测对象类型），值固定为 `word` / `sentence` / `paragraph` / `pinyin`，**不要传模糊的 eval_mode 数字**。
- 服务端 `_resolve_eval_mode(scene, eval_mode, ref_text, is_zh)` 统一映射 scene → eval_mode，优先级：`scene` > 旧 `eval_mode` > 自动判断。
- 各场景固定 scene：发音评分页（单英文单词）→ `word`；认字页（单汉字）→ `word`；拼音练习页 → `pinyin`；默写/词语页（组词/例句）→ `sentence`；长文 → `paragraph`。
- 改 SOE 相关代码后，必须用场景表逐项验证：word 单字出音素 / sentence 多词出多 word / 中文单字限 1 字（2 字传 word 会 4104 属预期）。
- `sentence_info_enabled` 必须为 `"1"`，否则 Words/PhoneInfos 全空，只有总分。

### 智聆音素 → 国际音标（支持英式/美式，官方映射表）
> 腾讯文档《音素标注》（884/33698）提供了官方映射表。**智聆返回小写音素**（ae/ah/iy/ow），与 ARPAbet 大写不同。
- 映射实现：`web/src/lib/arpabet.ts`（`arpabetToIpa(phone, style)`，style=uk/us），**别自己发明映射表**，按官方文档。
- 英式关键差异（长音 `ː`）：`iy`→`/iː/`、`uw`→`/uː/`、`ao`→`/ɔː/`、`aa`→`/ɑː/`、`er`→`/ɜː/`、`ow`→`/əʊ/`（美式 `/oʊ/`）、`ey`→`/eɪ/`（美式 `/e/`）。
- 带 r 双元音：`ih,r`→`/ɪə/`、`eh,r`→`/eə/`、`uh,r`→`/ʊə/`。
- 发音评分页有**英/美切换**（`usePronStyle`，localStorage，默认英式，与 Android 一致）；单词的 ipa/phonemes 也按风格选（英式用 `ipa_uk`/`phonemes_uk`）。

### 环境/链路类
- **改 `vite.config.ts` / 服务端 `main.py` 挂载后必须重启对应进程**：dev server 加 proxy、`/letter-clips` 挂载等，不重启不生效。手机访问的地址不变（IP 固定），但改代码后手机需**清缓存/硬刷新**。
- **百度 TTS 偶发返回极短坏音频（864 字节 ≈ 0.1s）**：`baidutts.py` 已加 `<1000 字节视为失败` 防护；**服务端冷启动初期 token 未就绪也可能返回坏音频**，改 TTS 后先等 `health ok` 稳定再验证。
- **https 页面不能请求 http 接口**（Mixed Content 被浏览器拦截）：dev 必须走 Vite proxy 同源 `/api/v1`，不能直接 fetch `http://192.168.1.10:8080`。
- **浏览器 autoplay 策略**：非用户手势的 `audio.play()` 会被拒（NotAllowedError）。默写/词语页自动朗读必须有「开始朗读」按钮解锁；改录音/朗读流程后注意手势链。
- **手机录音 getUserMedia 需 https 或 localhost**：dev 用自签 https，生产必须真 https。

### 前端 React 特有
- **StrictMode 双挂载**：组件 mount→unmount→remount，`useRef` 保留旧值。cleanup 置 false 的标志（如 `mountedRef`/`cycleRef`）必须在 useEffect **setup 阶段重置**，否则第二次挂载后功能永久失效（如「点击开始朗读没反应」）。
- **CSS scroll-snap 分页定位**：切页（字母/音素详情）加载完成后必须 `scrollTo(target * clientWidth)` 并用 `requestAnimationFrame` 等布局就绪，只 `setCurrent(idx)` 不滚动容器会导致永远停在第一屏（点 B 显示 A）。
- **全局 `button { width:100% }` 副作用**：App.css 有全局 button 样式，做横向排列的按钮（音素/字母 chip、声母韵母）必须覆盖 `width: auto`，否则每个占满一行。
- **全局 TTS `audioManager` 互斥**：所有音频播放（TTS/拼音部件/ipa）必须走 `audioManager`（同一时刻一个、切页中断、卸载中断）；组件卸载后 async 循环里的 `speak()` 必须被 `mountedRef` 拒绝，否则切页后仍继续播。
- **fetch 超时**：LLM 类接口（如 `/llm/sentence-generate`）要传 `timeoutMs`，失败降级，避免卡加载。

### 数据/模型类
- **词库等静态资源**：中文 `chinese_wordbank.json`、英语 `wordbank.json`/`english_vocabulary.json` 在 `web/public/`，改词库需同步复制 Android assets；前端 fetch 路径必须是绝对 `/web/xxx.json`。
- **家长年级配置**存 `training/plan` 的 `PlanItem.config.grades`（服务端 `PlanItemIn` 已支持 dict 透传），练习页用 `useFeatureGrades(featureId)` 读取过滤，改动需同步服务端模型。

### 修改流程约束
- 改 Python 服务端：先 `python -m py_compile` 语法检查 → 重启服务端 → 等 `health ok` → 实测对应接口。
- 改前端：`npx tsc -b` → `npm run lint` → `npm run build` → dev server 热更新 → 手机硬刷新验证。
- 遇到「0 分 / 无明细 / 无声」先查：是否模式选错（SOE）、是否重启生效（环境）、是否手势/混域（前端）、是否坏音频（TTS）。

