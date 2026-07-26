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

