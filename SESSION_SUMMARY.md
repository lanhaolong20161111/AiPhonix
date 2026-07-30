# 会话总结 — 2026-07-21

> 本次会话主轴：讯飞语音评测（流式版）WebSocket 集成调试  
> **最终结果：✅ 全部通过 — 跟读评测正常返回评分**

---

## 1. 讯飞 ISE 集成 — 错误 48195 调试全程

### API 信息
- **端点**: `wss://ise-api.xfyun.cn/v2/open-ise`
- **鉴权**: HMAC-SHA256 签名 → Base64 → URL 编码 → 拼接到 URL 查询参数
- **参考文档**: https://www.xfyun.cn/doc/Ise/IseAPI.html

### 发现并修复的 Bug

| # | 问题 | 修复 |
|---|------|------|
| 1 | 鉴权 URL 组装错误：直接用 `wss://...` 字符串，缺少 `host`/`date` 参数 | 重写 `XfyunAuth.generateAuthUrl()`，按 Demo 格式拼接 `authorization`+`host`+`date` 三参数 |
| 2 | SSB 响应条件写反：`status:1`（中间结果）被当成错误 | 改为检查 `code==0 && data.data==null` 才视为 SSB 握手成功 |
| 3 | PCM 字节序：Android `AudioRecord` 输出 little-endian，讯飞 `audio/L16` 格式预期 big-endian | 添加 `pcmLeToBe()` 逐 sample 交换高低字节 |
| 4 | 音频帧瞬间全发，撑爆缓冲区 → 报错 | 改为逐帧 1280 字节、间隔 40ms 实时发送 |
| 5 | **text 字段被 Base64 编码**（关键 Bug）| 改为直接传 UTF-8 文本 `\uFEFFapple`（BOM头+文字），不加 Base64 |
| 6 | text 多加了 `\r\n`（Demo 中不存在）| 去掉 `\r\n`，格式回退到 `\uFEFFapple` |
| 7 | ssb 帧多加了 `category: "read_word"`（Demo 中没有）→ 待验证是否多余 | 当前保留，如仍报 48195 则去掉 |
| 8 | AUW 帧多加了 `common` 块（文档说"仅在首帧上传"）| AUW 帧仅保留 `business`+`data` |

### 最终可用帧格式

```json
// ssb 握手帧（Demo 同款，精简参数）
{
  "common": {"app_id": "de0d3a92"},
  "business": {
    "sub": "ise",
    "ent": "en_vip",
    "category": "read_word",
    "cmd": "ssb",
    "text": "\uFEFFapple",
    "tte": "utf-8",
    "auf": "audio/L16;rate=16000",
    "aue": "raw"
  },
  "data": {"status": 0, "data": ""}
}

// auw 音频帧（不含 common）
{
  "business": {"cmd": "auw", "aus": 1, "aue": "raw"},
  "data": {"status": 1, "data": "<base64(BE-PCM)>", "data_type": 1, "encoding": "raw"}
}
```

### 核心教训
- **text 格式**: `\uFEFFapple`（BOM头+纯文本），**不加 `\r\n`，不用 Base64**
- **PCM 字节序**: Android 小端 → 讯飞大端，必须 `pcmLeToBe()`
- **音频发送**: 逐帧 1280 字节 + 40ms 间隔，不能瞬间全发
- **AUW 帧**: 不加 `common`（文档规定"仅在首帧上传"）
- **鉴权 URL**: `host` + `date` + `authorization` 三参数拼接

### 关键文件

| 文件 | 说明 |
|------|------|
| `AiPhonix/app/.../xfyun/XfyunSpeechRepository.kt` | WebSocket 主逻辑：鉴权→ssb→auw→解析结果 |
| `AiPhonix/app/.../xfyun/XfyunAuth.kt` | HMAC-SHA256 签名 + URL 组装 |
| `AiPhonix/app/.../xfyun/XfyunCredentialsProvider.kt` | 从 BuildConfig 注入凭证 |
| `AiPhonix/app/.../xfyun/XfyunConfig.kt` | appId/apiKey/apiSecret 数据类 |

---

## 2. TTS（TextToSpeech）问题

### 症状
- `tt init failed status = -1`
- 设备提示"设备未安装语音引擎"

### 根因
OPPO 设备缺少英语 TTS 语音数据。Android 原生 `TextToSpeech` 引擎需要设备安装 Google TTS 或等效引擎 + 英语语音包。

### 已做修复
- `TtsEngine.kt`: awaitInit() + withTimeout(5000) 避免挂死
- `PronunciationViewModel.kt`: catch 块输出 `Log.e(TAG, ...)` 日志
- UI: 错误信息展示到 Snackbar

### 待解决
用户需在设备上安装 Google TTS 引擎和英语语音包。

---

## 3. 音频录制

- `AudioRecorder.kt`: 16kHz / 16-bit / Mono PCM
- 状态机: IDLE → RECORDING → RELEASED
- `PronunciationViewModel.startRecording()`: 启动录音 → 持续 read → stop 返回完整 `ByteArray`
- 运行时权限: `RECORD_AUDIO` 通过 `rememberLauncherForActivityResult` 请求

---

## 4. 项目记忆导出

为支持跨会话接力，已将关键上下文存入 Reasonix 项目记忆：

| 记忆文件 | 内容 |
|----------|------|
| `phase-1-ai伴我学发音-项目完成.md` | 架构总览、5 页面、API 状态、构建命令 |
| `xfyun-ise-integration-status.md` | 讯飞调试全记录（本次会话核心） |
| `fix-stop-crash-race.md` | 录音闪退修复方案（通用） |
| `log-after-operation.md` | 操作后必记日志（通用规范） |

---

## 5. 构建与部署

```powershell
# 编译
cd AiPhonix
.\gradlew.bat assembleDebug

# 安装
adb install -r app\build\outputs\apk\debug\app-debug.apk

# 拉日志
adb logcat -d -v time | Select-String "XfyunSpeech|PronVm|AudioRecorder"

# 截图
adb exec-out screencap -p > $env:USERPROFILE\Desktop\screen.png
```

- **构建状态**: BUILD SUCCESSFUL（零警告）
- **设备**: 4HPJM7W48XNR9XLV (OPPO)

---

## 6. 最终结果

| 指标 | 状态 |
|------|------|
| 讯飞跟读评测 | ✅ **通过** — 朗读 apple 正常返回评分 |
| TTS | 🔴 设备缺英语语音引擎（需用户安装 Google TTS） |
| 构建 | ✅ BUILD SUCCESSFUL（零警告） |
| ADB | ✅ 4HPJM7W48XNR9XLV (OPPO) |

---

## 7. 下一步建议

1. **TTS**: 用户在设备安装 Google TTS + 英语语音包
2. **DeepSeek LLM**: `deepseek-v4-flash` 已接入，真机验证 AI 反馈
3. **功能扩展**: 字母→发音映射、音素标签行高亮
4. **录制流程优化**: 录音时长提示、音量波形可视化
