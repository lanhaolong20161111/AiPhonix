/**
 * Cloudflare Workers 绑定类型。
 * DB = D1（替代 better-sqlite3），FILES = R2（替代本地文件系统）。
 * 其余字段为 secrets（wrangler secret put / .dev.vars 注入），未设置时 undefined。
 */
export interface Bindings {
  DB: D1Database
  FILES: R2Bucket
  /** Workers Assets 绑定（web 静态资源；未命中时回落到 Worker） */
  ASSETS: Fetcher
  CORS_ALLOW_ORIGINS?: string
  JWT_SECRET?: string
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
  DEEPSEEK_MODEL?: string
  BAIDU_TTS_APP_ID?: string
  BAIDU_TTS_API_KEY?: string
  BAIDU_TTS_SECRET_KEY?: string
  /** 豆包 TTS（火山语音 openspeech.bytedance.com）：seed-audio-1.0 / seed-tts-2.0 共用同 key */
  VOLC_TTS_API_KEY?: string
  /** 豆包引擎：seed-audio-1.0（默认，免费额度）| seed-tts-2.0（流式 Tina老师2.0） */
  VOLC_TTS_ENGINE?: string
  /** 百度实时语音识别（WebSocket 鉴权用 AppID + API Key，见 asr.ts） */
  BAIDU_ASR_APP_ID?: string
  BAIDU_ASR_API_KEY?: string
  TENCENT_APP_ID?: string
  TENCENT_SECRET_ID?: string
  TENCENT_SECRET_KEY?: string
  ARK_API_KEY?: string
  ARK_MODEL?: string
  ARK_CHAT_MODEL?: string
  /** 多模态识图模型覆盖（不设则用 MULTIMODAL_MODEL 默认）。用于在不改代码的情况下对比/切换视觉模型。 */
  ARK_VISION_MODEL?: string
  /** PaddleOCR-VL（百度方舟托管文档 OCR）鉴权 token；不设则跳过该引擎，回退豆包。 */
  PADDLE_OCR_TOKEN?: string
  /** 识图主引擎选择：parse-image 默认 PaddleOCR-VL 优先（表格更准），失败/超时回退豆包。
   *  设为 "doubao" 则跳过 PaddleOCR 直走豆包（平板慢网 PaddleOCR 易超时场景）。其他/缺省值维持原行为。 */
  OCR_ENGINE?: string
  /** GLM 兜底（智谱 BigModel，DeepSeek 欠费/失败时启用；未设置则跳过兜底） */
  BIGMODEL_API_KEY?: string
  BIGMODEL_MODEL?: string
  /**
   * APK 下载页口令（`/dl/<口令>`）。**刻意用 secret 而不是 [vars]**：
   * 仓库推在 GitHub 上，口令进了 wrangler.toml 就等于公开，「不公开下载页」的前提就没了。
   * 未设置（或短于 12 字符）时整块下载路由**关闭**（fail closed）——避免「忘了配」变成默认公开。
   */
  DL_TOKEN?: string
  /**
   * App（小英）LLM 代理口令 —— `POST /api/v1/app-llm/chat/completions` 的 Bearer 值。
   * 与 [DL_TOKEN] 同理刻意用 secret 而非 [vars]（仓库推在 GitHub 上）。
   * 未设置或短于 16 字符时整块端点**关闭**（fail closed）。
   *
   * ⚠️ 这个口令会被编译进 APK，所以它是**一个可作废的开关**，不是密码学意义上的隔离；
   * 真正兜住滥用的是 `llm_budget_day` 那条与 web 端共用的日预算硬顶。
   */
  APP_LLM_TOKEN?: string
}
