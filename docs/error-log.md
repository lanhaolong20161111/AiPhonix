# 项目犯错日志

> 按时间倒序记录所有调试过程中遇到的故障、根因和修复方案。

---

## 1. 腾讯 SOE 鉴权 4002 — Go SDK URL 编码 BUG

**症状**：`POST /api/v1/soe/evaluate` 返回 `code: 4002, message: 鉴权失败`
**根因**：官方 Go SDK `tencentcloud-speech-sdk-go v1.0.25` 的 `Start()` 方法中：
```go
serverURL = serverURL[strings.Index(serverURL, "?"):]           // "?secretid=xxx&..."
serverURL = fmt.Sprintf("...?%s", url.PathEscape(serverURL))     // "%3Fsecretid%3Dxxx%26..."
```
`url.PathEscape` 将 `?` 编码为 `%3F`，导致服务器收到的第一个参数 key 为 `?secretid` 而非 `secretid`，签名验证失败。
**修复**：重写 `tencentsoe.go` — 用标准 `url.Values.Encode()` + 原始 `gorilla/websocket` 直接连接。

---

## 2. wordbank.json 被覆盖导致白屏崩溃

**症状**：启动 App 白屏闪退
```
MissingFieldException: Fields [ipa, letter, phonemes] are required...Word
```
**根因**：`scripts/build_wordbank.py` 输出到 `app/src/main/assets/wordbank.json`，覆盖了原始文件（24KB）。原文件结构为 `Word(text, ipa, letter, phonemes)`，用于 `HomeViewModel` → `ContentRepositoryImpl`。
**修复**：从备份恢复原文件，我生成的文件改名 `chinese_wordbank.json`。

---

## 3. SOE 死锁 — Write 后永远等不到结果

**症状**：SOE 评测永远不返回结果（此前密钥正确时）
**根因**：代码流程 `Write → 等 done → Stop`，但 `done` 只在服务器发回最终结果时触发，而最终结果需要 `Stop()` 发送结束消息才能收到。死锁。
**修复**：改为 `Write → Stop（触发结束消息并等待结果）→ 读 result`。

---

## 4. 桌面 Java API 用在 Android 上

**症状**：编译通过但运行时崩溃
**根因**：`ProxySpeechRepository.kt` 使用了 `javax.sound.sampled.AudioSystem` 和 `TargetDataLine`，这些是桌面 Java API，Android 没有。
**修复**：改用 `android.media.AudioRecord`。

---

## 5. 客户端直持腾讯 SOE API Key

**症状**：API Key 暴露在客户端 APK 中
**根因**：`TencentSpeechRepository` 使用 `TAIOralController` 直连腾讯，AppContainer 通过 `BuildConfig.TC_APP_ID/SECRET_ID/SECRET_KEY` 注入密钥。
**修复**：创建 `ProxySpeechRepository` — 本地录音 → base64 → POST 服务端 → 返回评分。AppContainer 改为使用 `ProxySpeechRepository`。

---

## 6. DeepSeek API Key 未注入 APK

**症状**：总是降级到 MockLLM
**根因**：`deepseek.local.properties` 在构建时被读取，但文件中没有实际 key 或 BuildConfig 字段未正确生成。
**修复**：通过 `app/build.gradle.kts` 的 `buildConfigField` 注入，结合 `ds()` 辅助函数从 `deepseek.local.properties` 读取。

---

## 7. DeepSeek JSON 截断

**症状**：题库生成只返回几道题或空数组
**根因**：`maxTokens=2000` 不够，`deepseek-v4-flash` 是推理模型，需要额外 token 用于思考过程。
**修复**：提升到 4000（后改为 8192），减少每轮题目数。

---

## 8. reasoning_content 为空

**症状**：DeepSeek 返回 HTTP 200 但 `content` 字段为空
**根因**：`deepseek-v4-flash` 是推理模型，答案放在 `reasoning_content` 而非 `content`。
**修复**：`parseResponse()` 先读 `content`，为空则读 `reasoning_content`。

---

## 9. 切换视频字幕残留

**症状**：切换到新视频后仍显示旧视频的字幕
**根因**：未在 `loadVideo()` 中清空 `currentSubtitle`。
**修复**：`loadVideo()` 开头设置 `currentSubtitle = null` 和 `practiceText = null`，字幕由播放时间戳驱动显示。

---

## 10. Quiz 空列表崩溃

**症状**：`NoSuchElementException: List is empty`
**根因**：`items.first()` 在空列表时调用。
**修复**：改为 `items.isEmpty()` 检查，显示友善提示。

---

## 11. Map<String, Any> 不能反序列化

**症状**：LLM 返回的 JSON 总是解析为空列表
**根因**：`Map<String, Any>` 不能被 `kotlinx.serialization` 反序列化。
**修复**：改用 `JsonElement`/`JsonObject`/`jsonPrimitive` 手动逐字段提取。

---

## 12. AnimatedContent 字幕动画残留

**症状**：旧字幕文字在新字幕显示前短暂闪烁
**根因**：`AnimatedContent` 的有过渡动画导致旧内容残留。
**修复**：改用普通 `Text`，无动画直接切换。

---

## 13. 进度条浮标超出边界

**症状**：蓝色浮标在最左侧时超出进度条一截
**根因**：`Slider` 的 thumb 有内边距，轨道未覆盖到最左端。
**修复**：将进度条 Row 加 `padding(horizontal=8.dp)` 对齐，去掉追手浮标，左边时间标签变蓝加粗。

---

## 14. PowerShell `&&` 不支持

**症状**：`cmd1 && cmd2` 报错
**根因**：PowerShell 不使用 `&&`，而是 `;`（无条件执行）或 `if ($?) { ... }`。
**修复**：全部改用 `;` 连接命令。

---

## 15. Go 语言不在 PATH 中

**症状**：`go build` 找不到命令
**根因**：Go 1.26 通过 winget 安装到 `E:\Go\bin`，但未加入系统 PATH。
**修复**：每次命令前加 `$env:Path += ";E:\Go\bin"`，用户后续手动添加了 PATH。

---

## 16. UTF-8 BOM 导致 JSON 解析失败

**症状**：服务端返回 `"请提供 char 字段"`，明明请求体中包含 `char`
**根因**：PowerShell 的 `[System.IO.File]::WriteAllText` 默认写入 UTF-8 BOM（`EF BB BF`），Go 的 JSON 解析器不识别 BOM。
**修复**：使用 `[System.Text.UTF8Encoding]::new($false)` 参数写入无 BOM 的 UTF-8。

---

## 17. PowerShell curl 是别名

**症状**：`curl -X POST ...` 报错 `找不到与参数名称"X"匹配的参数`
**根因**：PowerShell 中 `curl` 是 `Invoke-WebRequest` 的别名，不是真正的 curl.exe。
**修复**：用 `curl.exe`（全路径）或 `Invoke-RestMethod`。

---

## 18. 中文引号在 Go 字符串中编译错误

**症状**：`go build` 报 `syntax error: unexpected literal`
**根因**：Go 字符串中使用了中文引号 `"`（U+201C）和 `"`（U+201D），被 Go 编译器误解。
**修复**：改用「」或空格分隔。

---

## 19. Python GBK 编码错误

**症状**：`UnicodeEncodeError: 'gbk' codec can't encode character '\u2705'`
**根因**：PowerShell 输出编码为 GBK，无法输出 emoji。
**修复**：设置 `$env:PYTHONIOENCODING="utf-8"`，去掉 emoji 用纯文字。

---

## 20. 分包时间戳叠加溢出

**症状**：SRT 字幕时间戳出现 `27539:10:45,000` 等异常值
**根因**：`split_temp.py` 的 offset 逻辑错误，累加了不应累加的时间偏移。
**修复**：重写 `split_temp.py`，separator_s 独立处理，不再叠加偏移。

---

## 21. yt-dlp 格式选择错误

**症状**：B站视频下载失败
**根因**：B站视频流和音频流分离，`-f 0+1` 不适用。
**修复**：使用 `-f "bv*+ba"` 自动选择最佳视频+音频流。

---

## 22. 构建超时 (Gradle WaitDelay)

**症状**：`.\gradlew assembleDebug` 退出码非零但实际构建成功
**根因**：Gradle daemon 启动慢，超过工具默认超时，但构建仍成功完成。
**修复**：忽略退出码，检查 APK 文件是否存在确认构建成功。

---

## 23. 键盘遮挡输入框

**症状**：考试模式下输入法遮挡提交按钮
**根因**：Compose 未适配 IME 内边距。
**修复**：主 Column 添加 `Modifier.imePadding()`。

---

## 24. 答案提前泄露

**症状**：第一次答错就显示正确答案
**根因**：`WordResult` 展示中无条件显示了 `正确: X`。
**修复**：去掉自动暴露答案，只有点提示按钮后才显示。

---

## 26. 百度 TTS Access Token 解析 BUG

**症状**：`POST /api/v1/tts/synthesize` 返回 `"获取百度 token 失败"`，但实际上 access_token 已成功返回
**根因**：`baidutts.go` 用 `fmt.Sscanf` + `strings.TrimRight` 解析 JSON：
```go
fmt.Sscanf(string(body), `{"access_token":"%s`, &token)
token = strings.TrimRight(token, "\"}")
```
`%s` 读到空格才停，JSON 无空格就把整个剩余 JSON 全吞了。`TrimRight` 只去掉末尾 `"}`，token 后面挂着 `","expires_in":2592000,...`。
**修复**：改用标准 `json.Unmarshal` 解析 `access_token` 字段。

---

## 27. Android 明文 HTTP 被网络安全策略拦截

**症状**：`cleartext communication to 192.168.1.7 not permitted by network security policy`
**根因**：Android 9+ 默认禁止明文 HTTP 流量，App 通过 HTTP 访问局域网服务器被拦截。
**修复**：创建 `res/xml/network_security_config.xml`，放行 `192.168.1.7`、`localhost`、`127.0.0.1`、`10.0.2.2` 等本地 IP。在 `AndroidManifest.xml` 添加 `android:networkSecurityConfig="@xml/network_security_config"`。

---

## 28. ProxySpeechRepository 音素/单词分数为空

**症状**：英文评测不显示逐音素得分
**根因**：`requestServerEval()` 中 `phonemeScores` 和 `wordScores` 被写死为 `emptyList()`，服务端返回的 `words` 数组被忽略。
**修复**：解析服务端返回的 `words` 数组，每个 word 的 `phone_infos` 映射为 `PhonemeScore`，每个 word 映射为 `WordScore`。

---

## 29. 句子评测 RefText 超限（code=4104）

**症状**：视频跟读评测返回 `code=4104 请求参数RefText的字数超过最大限制`
**根因**：字幕句子（如 `"How do you do? Nice to meet you."`）远超腾讯 SOE 的 RefText 限制（`16k_en` 约 200 字符）。
**修复**：
1. 截断 — RefText 超过 180 字符自动截断
2. 自动切换 EvalMode — 含空格的句子用 **EvalMode=1**（句子模式），单单词用 **EvalMode=0**（词模式）

---

## 30. 中文模块拼音数据缺失

**症状**：认字练习点击「提交」无反应，实际 `submitPinyin()` 已执行但 `currentPinyin` 返回空字符串
**根因**：`chinese_wordbank.json` 中 1849 个汉字全部没有 `pinyin` 字段（默认值 `""`）。`submitPinyin()` 比较时双方都为空，永远答不对。
**修复**：运行 `add_pinyin.py` 用 `pypinyin` 库为所有字词生成拼音（带声调数字），多音字保留。

---

## 31. Recording 竞态 / StandaloneCoroutine was cancelled

**症状**：录音 `cancel()` 后 `deferred.completeExceptionally(CancellationException)` 与后续 `complete(result)` 冲突，日志出现 `StandaloneCoroutine was cancelled`
**根因**：`cancel()` 后 `stopStreamingEvaluation()` 立即读 buffer 发请求，但录音协程还在写 buffer（`AudioRecord.read()` 阻塞），竞态。`CancellationException` 被 catch 后 `deferred.completeExceptionally()` 与后续正常完成冲突。
**修复**：
1. 添加 `AtomicBoolean stopped` 标志，录音循环同时检查 `isActive && !stopped.get()`
2. `CancellationException` 单独处理不 complete deferred
3. `completeDeferred()` 安全包装，检查 `isCompleted` 防止重复 complete
4. 所有 `deferred.complete*` 前检查 `isCompleted`

---

## 32. Navigation 3 中 viewModel 作用域不可访问

**症状**：`Unresolved reference 'startVoiceEvaluation'`
**根因**：Navigation 3 的 `entry<Recognition>` 内使用 `viewModel = viewModel { ... }` 时，`viewModel` 变量在 `onStartRecording` lambda 中不可解析——左侧是参数名、右侧是函数调用。
**修复**：先提取变量：`val recognitionVm = viewModel { ... }`，再用 `recognitionVm.startVoiceEvaluation()`。

---

## 33. Gradle 配置缓存不检测 assets 变化

**症状**：修改 `assets/chinese_wordbank.json` 后构建仍 `FROM-CACHE/UP-TO-DATE`，APK 不更新
**根因**：Gradle 配置缓存认为 assets 输入未变。即使删除 `app/build`，根目录 `.gradle` 配置缓存仍复用。
**修复**：`Remove-Item -Recurse -Force ".gradle"` 清除配置缓存，或用 `--no-configuration-cache` 构建。

---

## 34. 介母判定规则错误（多次修正）

**症状**：`系(xi)` 显示三个框（误判有介母），`国(guo)` 显示两个框（漏判介母），`切(qie)` 介母判定反复
**根因**：介母规则不清晰，经历了三个版本的错误修正。
- v1: `len(rest) > 1 && "iuv".contains(rest[0])` — 太宽松，`xi` 的 `i` 被误判为介母
- v2: `len(rest) >= 3` — 太严格，`guo` 的 `u` 漏判  
- v3: **小学标准规则** — 介母 i 搭配: `ia/iao/ian/iang/iong`；介母 u 搭配: `ua/uai/uan/uang/uo`；介母 ü 搭配: `van/vong`
  - `iu`、`ui`、`ie`、`ue` 均为复韵母，无介母
  - `yuan` 为整体认读音节（16 个之一）
  - `yan`、`wan` 为零声母三拼音，y/w→i/u 作介母处理
**修复**：服务端 `pinyin.go`、客户端 `PinyinPart.kt`、`RecognitionScreen.kt` 三处统一使用小学标准规则。

---

## 35. WordSuggestionCache 死锁

**症状**：`POST /api/v1/llm/word-suggestions` 超时无响应
**根因**：`Set()` 持有 `sync.Mutex` 锁后调用 `save()`，`save()` 又试图锁同一个 Mutex → 死锁（Go Mutex 不可重入）。
**修复**：`save()` 内部不加锁，调用方 `Set()` 在释放锁后再调 `save()`。

---

## 36. TTS 多音字读音不正确

**症状**：多音字（如 好 hao3/hao4）TTS 发音可能与考题不一致
**根因**：TTS 传单字，百度 API 使用最常见读音，可能与多音字的特定声调不符。
**修复**：服务端 `updateTtsHint()` 从字库词表选第一个包含该字的词语作为 TTS 提示（`好` → `美好`），客户端 `onPlayTts` 改用提示词，百度 TTS 根据上下文自动选择正确读音。大字下方不再显示拼音（拼音是考查内容）。
