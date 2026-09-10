# SESSION_HANDOFF_20260815

> 新会话先读这个文件。上一份交接：`SESSION_HANDOFF_20260811.md`（含更早状态：数学模块、服务端、模型、历史坑）。

## 当前状态（2026-08-15）

- **服务端**：运行中（`server_py`，uvicorn 8080）。启动方式必须用后台任务/开机自启 VBS，前台 bash 会被会话清理杀掉。
- **Android 客户端**：包 com.example.ai，Compose + Navigation 3。构建 `.\gradlew.bat :app:assembleDebug`；单测 `:app:testDebugUnitTest`（gradle daemon 会消失，冷启动 2 分钟+，用后台 + wait）。
- **设备**：`4HPJM7W48XNR9XLV`（adb 有 mDNS 残留多设备，一律 `adb -s 4HPJM7W48XNR9XLV`）。
- **电脑 IP**：192.168.1.10（DHCP 动态，App serverBase + network_security_config 两处要同步；路由器 MAC 绑定未做）。
- **模型**：config.yaml ark_chat 段，`deepseek-v4-flash-ga-260731`；识图 `doubao-seed-evolving`。

## 本会话完成（2026-08-14~15）

### 1. 🔴 移除 sherpa ASR（已全部完成 + 验证）
用户确认**全部移除** sherpa ASR，5 个模块的口述转文字改为「文本框 + 系统输入法语音输入」：

| 模块 | 改动 |
|---|---|
| **数学练习**（AiHomeworkPractice） | 移除 OralAsrEngine/startVoiceInput/stopVoiceInput/isRecording/asrReady/asrTranscription/onCleared 释放/麦克风按钮/权限；保留「🗣️ 说说你的思路」+ 文本框 + 提交评判 |
| **口述作文**（OralWriting） | 移除 asrEngine/initAsrEngine/startVoiceInput/stopVoiceInput/录音状态/onCleared；文本框提示「可点输入框用语音输入」，保留提交 |
| **文章跟读**（ArticleReading） | `toggleRecord`/`updateSummary` → `setSummaryText(index, text)`；ParagraphCard 改为 OutlinedTextField；删 recordingIndex/partialText/playingAudio/MediaPlayer/playSummaryAudio/stopAudio；Store 删 paragraphAudioPath/questionAudioPath/resolveAudio/audioDir |
| **文章问答**（ArticleQuiz） | `toggleRecord`/`updateAnswer` → `setAnswerText(index, text)`；QuestionCard 文本框替换麦克风；删 asrEngine/initAsrEngine/onCleared/recordingIndex/partialText |
| **AI 陪我练**（AiPracticeChat） | 删 asrEngine/startVoice/stopVoice/recording/partialText；输入框 placeholder 改「可点输入框用语音输入」；ViewModel 构造去掉 appContext；Navigation.kt 对应去掉 appContext 传参 |

**删除的 sherpa 包**（全部清理）：
- `app/src/main/java/com/k2fsa/**`（30 个源文件，含 OralAsrEngine/OnlineRecognizer/dictation 等）
- `app/src/main/jniLibs/`（libsherpa-onnx-jni.so + libonnxruntime.so，整个 jniLibs 目录已删）
- `app/src/main/assets/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/`（约 340MB 模型）

**注意**：`app/libs/` 下的 aar_classes/aar_extracted 是**腾讯 SOE aar 的解包产物，非 sherpa，保留**（但代码里实际 SOE 评分走服务端 HTTP 代理 `ScoreClient` → `/api/v1/soe/evaluate`，未直接引用 com.tencent.cloud.soe；build.gradle `fileTree(libs/*.aar)` 保留）。

**验证**：compileDebugKotlin ✅ / testDebugUnitTest ✅（全部通过）/ assembleDebug ✅。**APK 从 372.9MB → 33.4MB**。已安装到设备 `adb install -r` 成功。

**保留未动的麦克风功能**（是腾讯 SOE 发音评分，不是 sherpa）：拼音练习、AiChinese 段落评分、CharImage、SentencePractice、VideoPractice、AiHomework 的 isMicRecording/recordingWord/paragraphRecordingText。

### 2. 备份（进行中，未完成）
- 尝试用 `Compress-Archive` 打包 `AiPhonix_backup_20260814.zip`（源码+配置：app/web/server_py 源码/scripts/docs/docker-compose.yml/.env.example，排除构建产物/日志/数据库/大视频/密钥？）。
- **失败**：Compress-Archive 在 `app/build/intermediates/global_synthetics_project/...` 长路径/特殊字符文件报错中止（`CompressArchiveUnauthorizedAccessError`）。
- **未重试**。建议改用 `tar`（Windows 10+ 自带）排除 `app/build`、`.gradle`、`node_modules`、`server_py` 的 .log/app.db/*.apk/大 jpg，或先清 build 目录再压缩。
- 用户选的是「源码+配置」范围（非全量，server_py 有 3.9GB 含 370MB AiPhonix.apk、app.db、日志等，letter_videos 1.2GB）。

### 3. 架构讨论（Web 化，仅讨论未动手）
用户想转向 **Web 架构**：手机+平板浏览器为载体，电脑端也能用，后续可能用 React Native 写 App。
- 现状：`web/` 是 React 19 + Vite + TS 默认脚手架（只有一个 hero 页）；后端能力已服务化（SOE 评分/TTS/LLM 都走服务端）。
- 我的建议：方向合理（后端已就绪、时机好），但本质是**重写不是迁移**。建议先做 Web 最小闭环（1-2 个模块）验证手机+平板浏览器体验 + 录音打分链路，通过再铺开；不推荐原生/Web 双全量维护。RN 定位要提前定（若只需浏览器可用，PWA 即可，RN 可省）。
- **未产出方案文档**，等待用户决定是否要详细 Web 化方案。

## 坑（新踩）

- **Compress-Archive 遇 build 目录长路径/`$`特殊字符文件会整体失败**：备份前先排除 `app/build`、`.gradle` 等，或改用 tar。
- gradle daemon 消失、前台服务端被杀、adb 多设备、改 prompt 清缓存等沿用上一份交接。

## 待办（按用户明确提出的方向）

1. **🔴 完成备份**：重试 zip 打包（排除 build/.gradle/node_modules/日志/数据库/大视频），或先 `git stash`/提交再打 tag 兜底。
2. **🔴 Web 化（用户已表态想做，方向待确认细节）**：定夺是否出详细方案；Web 最小闭环验证点 = 网页输入→后端 LLM/TTS→展示 + 录音打分链路（MediaRecorder 格式是否被 SOE 代理接受）。
3. **搭积木学习（遗留，上份待办 #1）**：学生用组件搭线段图/圆圈图→LLM 审核。等待用户确认设计后实施。
4. **FeatureCatalogTest 11/2 失败**（既有）：确认 12 个功能项后更新测试。
5. **路由器 MAC 绑定**根治 IP 变更。
6. **识别页/练习页隐藏图**（SegmentDiagram/RelationGraph）是否最终移除，等搭积木方案确定。
