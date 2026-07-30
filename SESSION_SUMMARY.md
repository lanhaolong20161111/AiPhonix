# 会话总结 — 2026-07-30

## 完成的功能

### 🔐 用户系统（全新）
- **后端**: SQLAlchemy 2.0 异步引擎（SQLite/PostgreSQL 双支持），User + RefreshToken + Essay 三表
- **Auth API**: register / login / refresh / logout / users/me
- **Android**: TokenManager（SharedPreferences）+ LoginViewModel + LoginScreen（登录/注册切换）
- **认证拦截器**: OkHttp Interceptor 自动添加 `Authorization: Bearer <token>` header

### 🔤 字母发音功能
- `Letter.kt` 新增 `pronunciations: List<String>` 字段
- `wordbank.json` 26 个字母全部配好常用发音
- 用 FFmpeg 拼接生成 3 个新音标音频：`kw.aac`、`ks.aac`、`ju.aac`
- LetterScreen 新增可点击发音芯片（点击播放 `assets/ipa/*.aac`）

### ✍️ 口述作文（OralWriting）
- 服务端 5 个端点 + `essays.json` 题库
- 全段落独立卡片 + 独立麦克风输入
- 切换段落 500ms 过渡 + 自动停止录音
- 结果页显示原文 + 润饰版 + 反馈
- sherpa-onnx ASR 集成（本地流式语音识别）

### 🐳 Docker 部署
- Dockerfile + docker-compose.yml + .env.example + DEPLOY.md

## 修复的 Bug

| # | 问题 | 根因 |
|---|------|------|
| 1 | 看图识字录音按钮无效 | `_recordingChar != null`→StateFlow 对象永远非 null，应 `.value` |
| 2 | 播放按钮灰色 | 上传成功未更新 `_hasAudioSet` |
| 3 | 字母视频自动播放 | `playWhenReady = true`→`false` |
| 4 | 音标声音太小 | `MediaPlayer.setVolume()` 受限，改用 `LoudnessEnhancer` +2000mB |
| 5 | 口述作文 NetworkOnMainThread | 嵌套 `withContext(IO)` 未生效，应直接 `launch(Dispatchers.IO)` |
| 6 | 编译错误：companion 位置 | Kotlin 要求 `init` 块在 `companion object` 之前 |
| 7 | 类被提前关闭 | 多余 `}` 导致所有方法变文件级函数 |

## Git 提交
- Commit: `5f54fcc` → `feat: 用户系统 + 字母发音 + 口述作文 + 看图识字修复 + sherpa-onnx ASR`
- 62 个文件，+5319/-57 行
- 推送到 `origin/master`

## 待办（下一会话可继续）
- [ ] Android HomeScreen 添加注销按钮
- [ ] 句子练习功能（LLM 一问一答）
- [ ] 后端 LangGraph 集成
- [ ] 用户头像上传
- [ ] 家长/教师角色
