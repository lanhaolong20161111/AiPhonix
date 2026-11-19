# APP.md — AiPhonix

## 是什么

AI 语音学习主 App（字母 / 单词 / 发音 / 拼读），同时是一个**多后端 monorepo**。
Android 端加上 5 套后端实现与一套 Web 前端，是这个工作区里最大的项目。

## 快速启动

```powershell
cd D:\Code\apps\apps\android\aiphonix
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

已归档：`dist\aiphonix.apk`（35.5MB）、`dist\xiaoying.apk`（44.3MB，旧版小英）

## 目录地图（重要）

| 目录 | 作用 | 语言 |
|---|---|---|
| `app/` | **Android 主 App**（272 个 .kt，本项目主战场） | Kotlin/Compose |
| `web/` | Web 前端（162MB，含大量本地 e2e 脚本与截图） | TypeScript |
| `server_cf/` | Cloudflare Worker 后端（生产 Worker 所在） | TypeScript |
| `server_ts/` | Node/TS 后端 | TypeScript |
| `server_go/` | Go 后端 | Go |
| `server_py/` | Python 后端（LangGraph 练习链路） | Python |
| `cloudbase/` | CloudBase 迁移试验 | TypeScript |
| `shared/` | 多端共享资源与配置（`config.yaml` 含密钥，已忽略） | - |
| `overlay_tool/` | 悬浮窗子模块（**已被 .gitignore 排除**） | Kotlin |
| `letter_videos/` | 字母手写视频生成脚本（51 个 .py，媒体产物已排除） | Python |
| `docs/` | **15 份设计文档** —— 改行为前必读 | Markdown |
| `archived/`、`_proddist/`、`autostart_backup_*` | 历史归档，不参与开发 | - |

## 关键坐标（Android 端）

| 位置 | 作用 |
|---|---|
| `app/src/main/java/com/example/ai/MainActivity.kt` | 入口 |
| `app/src/main/assets/` | 词库、音素、IPA 音频 |
| `app/src/main/jniLibs/` | sherpa-onnx JNI（**已忽略，需本地提供**） |

- 包名 `com.example.ai`，minSdk 26 / targetSdk 36
- 单元测试：**38 个**（全项目最多）

## 这个仓库的特殊之处

**`.gitignore` 极其详尽**（400+ 行，中文注释）。它是多轮踩坑的产物，改它之前：

1. 先读注释——几乎每条都写了「为什么排除」。
2. 实测体积：`git ls-files` 目前约 1440 个文件 / **24.7MB**，这是健康值。
3. 曾被误提交的雷区：`shared/config.yaml`（6 个真实密钥）、`shared/data`（约 4GB）、
   `shared/static`（435MB）、`server_cf/static_assets/tts-cache`（113MB）。

**当前工作区状态**：为了控制体积，`shared/static`（434MB 视频/图片）、`shared/cache`、
`_cloudbase_stage`、`letter_videos` 下的 1269 个 png 帧与全部 mp4 已从本地副本清理。
这些都**未被 git 跟踪**，需要时从原目录
`C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix` 取回。

## 坑

- 五个后端并存，改接口要确认改的是哪一套；生产 Worker 是 `server_cf`。
- `shared/config.yaml` 是密钥文件，`.gitignore` 已排除，**不要**为了方便改成明文入库。
- `web/` 下几十个 `_*.cjs` / `_*.mjs` 是一次性 e2e 脚本，多数已被忽略，不要当成正式代码。
- `overlay_tool/` 被整体忽略，但被 `app/` 依赖时会导致构建失败，接手先确认本地是否有该目录。
- 首次构建会重新下载 Gradle 依赖与 sherpa-onnx 模型。
