/**
 * 配置加载 — Cloudflare 版：从 Worker env bindings（secrets）读，不再读 config.yaml / process.env。
 * 保持 AppConfig 结构与 server_ts/src/env.ts 一致，下游路由代码零感知。
 */
import { z } from "zod"
import type { Bindings } from "./bindings.js"

// ── env 绑定 holder ────────────────────────────────────────────────
// Workers 的 env 只在 fetch(request, env, ctx) 里拿到，而 lib 层又是模块单例风格，
// 故在入口先 setEnv(env)。env 绑定（同一 D1/R2/密钥）跨请求恒定，模块级缓存安全。
// ⚠️ 安全网：若 env 引用发生变化（理论不应发生），打 warning 以便排查。
let ENV: Bindings | null = null

export function setEnv(env: Bindings): void {
  if (ENV && ENV !== env) {
    console.warn("[env] bindings 引用已变化，已更新（可能是 isolate 复用残留）")
  }
  ENV = env
}

export function getEnv(): Bindings {
  if (!ENV) throw new Error("[env] bindings 未初始化：请在 fetch 入口先 setEnv(env)")
  return ENV
}

// ── 配置 schema（对齐 server_ts） ──────────────────────────────────
const deepseekSchema = z.object({
  api_key: z.string().default(""),
  base_url: z.string().default("https://api.deepseek.com"),
  model: z.string().default("deepseek-v4-flash"),
  max_cost_per_call: z.number().default(0.5),
  max_cost_per_day: z.number().default(5.0),
  max_input_chars: z.number().default(20000),
})

const baiduTtsSchema = z.object({
  app_id: z.string().default(""),
  api_key: z.string().default(""),
  secret_key: z.string().default(""),
  cache_dir: z.string().default("cache/tts"),
})

const volcTtsSchema = z.object({
  api_key: z.string().default(""),
  /** seed-audio-1.0（默认，免费额度）| seed-tts-2.0（流式 Tina老师2.0，音色更自然） */
  engine: z.string().default("seed-audio-1.0"),
  cache_dir: z.string().default("cache/tts/volc"),
})

const baiduAsrSchema = z.object({
  app_id: z.string().default(""),
  api_key: z.string().default(""),
})

const tencentSchema = z.object({
  app_id: z.string().default(""),
  secret_id: z.string().default(""),
  secret_key: z.string().default(""),
})

const llmPromptsSchema = z.object({
  english_teaching: z.string().default(""),
  chinese_teaching: z.string().default(""),
  quiz_generate: z.string().default(""),
  word_suggestions: z.string().default(""),
  sentence_making: z.string().default(""),
  default: z.string().default(""),
})

const arkImageSchema = z.object({
  api_key: z.string().default(""),
  model: z.string().default("doubao-image-pro-32k"),
  endpoint: z.string().default("https://open.volcengineapi.com"),
})

const arkChatSchema = z.object({
  api_key: z.string().default(""),
  /** 文本任务统一豆包（免费量大）；识图也用它。⚠️ 须带日期版本号 -260628 */
  model: z.string().default("doubao-seed-2-1-turbo-260628"),
  /** 多模态识图模型；留空则用 ark.ts 的 MULTIMODAL_MODEL 默认。
   * 当前统一 doubao-seed-2-1-turbo-260628。 */
  vision_model: z.string().default(""),
})

const bigmodelSchema = z.object({
  api_key: z.string().default(""),
  model: z.string().default("glm-5.3-flash"),
  base_url: z.string().default("https://open.bigmodel.cn/api/paas"),
})

const configSchema = z.object({
  deepseek: deepseekSchema.default({}),
  baidu_tts: baiduTtsSchema.default({}),
  volc_tts: volcTtsSchema.default({}),
  baidu_asr: baiduAsrSchema.default({}),
  tencent: tencentSchema.default({}),
  llm_prompts: llmPromptsSchema.default({}),
  ark_image: arkImageSchema.default({}),
  ark_chat: arkChatSchema.default({}),
  bigmodel: bigmodelSchema.default({}),
})

export type AppConfig = z.infer<typeof configSchema>

// ── 默认提示词（与 server_ts / Python config.py 一致） ─────────────
const DEFAULT_PROMPTS: Record<string, string> = {
  english_teaching:
    "你是一个儿童英语发音教学专家。你面对的是 6-12 岁的中国儿童。要求：使用简单、生动、鼓励性的儿童语言；回答不超过 3 句话；多用 emoji；使用简体中文；指出具体改进方法。",
  chinese_teaching: "你是一个只输出JSON的语文教学助手。",
  quiz_generate: "你是一个儿童英语教学专家，负责从动画字幕中提取适合中国儿童学习的英语材料。",
  word_suggestions: "",
  sentence_making: "",
  default: "你是 AiPhonix 教学助手，请用简体中文回答。",
}

/**
 * 清洗 secret：去掉首尾空白、包裹/残留引号、以及 `#` 注释。
 * 防把整行配置（如 `xxx # 火山引擎免费 token（日期 用户提供）`）误粘进 secret，
 * 导致 Authorization 头带非 ASCII 注释、服务端返回 401「API key 格式不正确」。
 */
export function cleanSecret(v: string): string {
  let s = v.trim()
  const hash = s.indexOf("#")
  if (hash >= 0) s = s.slice(0, hash)
  s = s.trim()
  s = s.replace(/^["']+|["']+$/g, "")
  return s.trim()
}

/** 从 env bindings 组装配置（secrets 未设置时回退默认值） */
export function loadConfig(env: Bindings): AppConfig {
  const cfg = configSchema.parse({})

  if (env.DEEPSEEK_API_KEY) cfg.deepseek.api_key = cleanSecret(env.DEEPSEEK_API_KEY)
  if (env.DEEPSEEK_BASE_URL) cfg.deepseek.base_url = env.DEEPSEEK_BASE_URL.trim()
  if (env.DEEPSEEK_MODEL) cfg.deepseek.model = env.DEEPSEEK_MODEL.trim()
  if (env.BAIDU_TTS_APP_ID) cfg.baidu_tts.app_id = cleanSecret(env.BAIDU_TTS_APP_ID)
  if (env.BAIDU_TTS_API_KEY) cfg.baidu_tts.api_key = cleanSecret(env.BAIDU_TTS_API_KEY)
  if (env.BAIDU_TTS_SECRET_KEY) cfg.baidu_tts.secret_key = cleanSecret(env.BAIDU_TTS_SECRET_KEY)
  if (env.VOLC_TTS_API_KEY) cfg.volc_tts.api_key = cleanSecret(env.VOLC_TTS_API_KEY)
  if (env.VOLC_TTS_ENGINE) cfg.volc_tts.engine = env.VOLC_TTS_ENGINE.trim()
  if (env.BAIDU_ASR_APP_ID) cfg.baidu_asr.app_id = cleanSecret(env.BAIDU_ASR_APP_ID)
  if (env.BAIDU_ASR_API_KEY) cfg.baidu_asr.api_key = cleanSecret(env.BAIDU_ASR_API_KEY)
  if (env.TENCENT_APP_ID) cfg.tencent.app_id = cleanSecret(env.TENCENT_APP_ID)
  if (env.TENCENT_SECRET_ID) cfg.tencent.secret_id = cleanSecret(env.TENCENT_SECRET_ID)
  if (env.TENCENT_SECRET_KEY) cfg.tencent.secret_key = cleanSecret(env.TENCENT_SECRET_KEY)
  if (env.ARK_API_KEY) {
    const arkKey = cleanSecret(env.ARK_API_KEY)
    cfg.ark_image.api_key = arkKey
    cfg.ark_chat.api_key = arkKey
  }
  if (env.ARK_MODEL) cfg.ark_image.model = env.ARK_MODEL.trim()
  if (env.ARK_CHAT_MODEL) cfg.ark_chat.model = env.ARK_CHAT_MODEL.trim()
  if (env.ARK_VISION_MODEL) cfg.ark_chat.vision_model = env.ARK_VISION_MODEL.trim()
  if (env.BIGMODEL_API_KEY) cfg.bigmodel.api_key = cleanSecret(env.BIGMODEL_API_KEY)
  if (env.BIGMODEL_MODEL) cfg.bigmodel.model = env.BIGMODEL_MODEL.trim()

  // 默认提示词补全
  const prompts = cfg.llm_prompts as Record<string, string>
  for (const [k, v] of Object.entries(DEFAULT_PROMPTS)) {
    if (!prompts[k]) prompts[k] = v
  }

  return cfg
}

// 单例缓存 + TTL：secret 轮换后最多 60 秒生效（无需等 isolate 重启）
let _cfg: AppConfig | null = null
let _cfgTs = 0
const CFG_TTL_MS = 60_000
export function getConfig(): AppConfig {
  const now = Date.now()
  if (!_cfg || now - _cfgTs > CFG_TTL_MS) {
    _cfg = loadConfig(getEnv())
    _cfgTs = now
  }
  return _cfg
}

/** 允许测试/热重载时清除缓存 */
export function resetConfig(): void {
  _cfg = null
  _cfgTs = 0
}
