/** 配置加载 — zod 解析 server_py/config.yaml，环境变量优先，完全对齐 Python config.py */
import { z } from "zod"
import { parse as parseYaml } from "yaml"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// server_py 绝对根目录（server_ts/src/env.ts 的上一级的上一级）
const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, "../..")
/** 已退役 PY 的遗留根：仅 OCR 桥接脚本等 Python 资产仍在此（数据/静态/配置已迁 shared/） */
export const LEGACY_PY_ROOT = join(ROOT, "server_py")
// 兼容别名，残余引用清零后删除
export const SERVER_PY_DIR = LEGACY_PY_ROOT

// 中立共享目录（2026-08-27 迁出 server_py；SQLite/上传/音频/静态/缓存）
export const DATA_DIR = join(ROOT, "shared", "data")
export const STATIC_DIR = join(ROOT, "shared", "static")
export const CACHE_DIR = join(ROOT, "shared", "cache")

const serverSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().default(8080),
})

const deepseekSchema = z.object({
  api_key: z.string().default(""),
  base_url: z.string().default("https://api.deepseek.com"),
  model: z.string().default("deepseek-v4-flash"),
  budget: z
    .object({
      max_cost_per_call: z.number().default(0.5),
      max_cost_per_day: z.number().default(5.0),
      max_input_chars: z.number().default(20000),
    })
    .default({}),
  // 兼容旧结构：budget 子段可能被提升为平铺字段
  max_cost_per_call: z.number().optional(),
  max_cost_per_day: z.number().optional(),
  max_input_chars: z.number().optional(),
}).transform((d) => ({
  api_key: d.api_key,
  base_url: d.base_url,
  model: d.model,
  max_cost_per_call: d.max_cost_per_call ?? d.budget.max_cost_per_call,
  max_cost_per_day: d.max_cost_per_day ?? d.budget.max_cost_per_day,
  max_input_chars: d.max_input_chars ?? d.budget.max_input_chars,
}))

const baiduTtsSchema = z.object({
  app_id: z.string().default(""),
  api_key: z.string().default(""),
  secret_key: z.string().default(""),
  cache_dir: z.string().default("cache/tts"),
})

/** 百度实时语音识别（/asr/stream 用 app_id + api_key；短语音识别复用 baidu_tts 的 key） */
const baiduAsrSchema = z.object({
  app_id: z.string().default(""),
  api_key: z.string().default(""),
})

const volcTtsSchema = z.object({
  api_key: z.string().default(""),
  /** seed-audio-1.0（默认，免费额度）| seed-tts-2.0（流式 Tina老师2.0，音色更自然） */
  engine: z.string().default("seed-audio-1.0"),
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
  vision_model: z.string().default(""),
})

const ppStructureSchema = z.object({
  token: z.string().default(""),
  job_url: z.string().default("https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"),
  model: z.string().default("PP-StructureV3"),
  poll_interval: z.number().default(5.0),
  max_wait: z.number().default(180.0),
  timeout: z.number().default(30.0),
})

const bigmodelSchema = z.object({
  api_key: z.string().default(""),
  base_url: z.string().default("https://open.bigmodel.cn/api"),
  model: z.string().default("glm-5.3-flash"),
})

/** App（小英）LLM 代理。口令可从 shared/config.yaml 的 `app_llm.token` 或环境变量 APP_LLM_TOKEN 给。 */
const appLlmSchema = z.object({
  /** 未配置或短于 16 字符 ⇒ 代理端点整体关闭（fail closed） */
  token: z.string().default(""),
})

const configSchema = z.object({
  server: serverSchema.default({}),
  deepseek: deepseekSchema.default({}),
  baidu_tts: baiduTtsSchema.default({}),
  baidu_asr: baiduAsrSchema.default({}),
  volc_tts: volcTtsSchema.default({}),
  tencent: tencentSchema.default({}),
  llm_prompts: llmPromptsSchema.default({}),
  ark_image: arkImageSchema.default({}),
  ark_chat: arkChatSchema.default({}),
  pp_structure: ppStructureSchema.default({}),
  bigmodel: bigmodelSchema.default({}),
  app_llm: appLlmSchema.default({}),
})

export type AppConfig = z.infer<typeof configSchema>

// 默认提示词（与 Python config.py 一致）
const DEFAULT_PROMPTS: Record<string, string> = {
  english_teaching:
    "你是一个儿童英语发音教学专家。你面对的是 6-12 岁的中国儿童。要求：使用简单、生动、鼓励性的儿童语言；回答不超过 3 句话；多用 emoji；使用简体中文；指出具体改进方法。",
  chinese_teaching: "你是一个只输出JSON的语文教学助手。",
  quiz_generate: "你是一个儿童英语教学专家，负责从动画字幕中提取适合中国儿童学习的英语材料。",
  word_suggestions: "",
  sentence_making: "",
  default: "你是 AiPhonix 教学助手，请用简体中文回答。",
}

/** 加载配置：读 server_py/config.yaml + 环境变量覆盖 */
export function loadConfig(): AppConfig {
  const raw: Record<string, unknown> = {}
  const cfgPath = process.env.CONFIG_PATH
    ? resolve(process.env.CONFIG_PATH)
    : join(ROOT, "shared", "config.yaml")
  if (existsSync(cfgPath)) {
    const text = readFileSync(cfgPath, "utf-8")
    const parsed = parseYaml(text)
    if (parsed && typeof parsed === "object") Object.assign(raw, parsed)
  }

  const cfg = configSchema.parse(raw)

  // 环境变量覆盖（对齐 Python）
  if (process.env.DEEPSEEK_API_KEY) cfg.deepseek.api_key = process.env.DEEPSEEK_API_KEY
  if (process.env.DEEPSEEK_BASE_URL) cfg.deepseek.base_url = process.env.DEEPSEEK_BASE_URL
  if (process.env.DEEPSEEK_MODEL) cfg.deepseek.model = process.env.DEEPSEEK_MODEL
  if (process.env.BAIDU_TTS_APP_ID) cfg.baidu_tts.app_id = process.env.BAIDU_TTS_APP_ID
  if (process.env.BAIDU_TTS_API_KEY) cfg.baidu_tts.api_key = process.env.BAIDU_TTS_API_KEY
  if (process.env.BAIDU_TTS_SECRET_KEY) cfg.baidu_tts.secret_key = process.env.BAIDU_TTS_SECRET_KEY
  if (process.env.BAIDU_ASR_APP_ID) cfg.baidu_asr.app_id = process.env.BAIDU_ASR_APP_ID
  if (process.env.BAIDU_ASR_API_KEY) cfg.baidu_asr.api_key = process.env.BAIDU_ASR_API_KEY
  if (process.env.VOLC_TTS_API_KEY) cfg.volc_tts.api_key = process.env.VOLC_TTS_API_KEY
  if (process.env.VOLC_TTS_ENGINE) cfg.volc_tts.engine = process.env.VOLC_TTS_ENGINE
  if (process.env.TENCENT_APP_ID) cfg.tencent.app_id = process.env.TENCENT_APP_ID
  if (process.env.TENCENT_SECRET_ID) cfg.tencent.secret_id = process.env.TENCENT_SECRET_ID
  if (process.env.TENCENT_SECRET_KEY) cfg.tencent.secret_key = process.env.TENCENT_SECRET_KEY
  if (process.env.ARK_API_KEY) {
    cfg.ark_image.api_key = process.env.ARK_API_KEY
    cfg.ark_chat.api_key = process.env.ARK_API_KEY
  }
  if (process.env.ARK_MODEL) cfg.ark_image.model = process.env.ARK_MODEL
  if (process.env.ARK_CHAT_MODEL) cfg.ark_chat.model = process.env.ARK_CHAT_MODEL
  if (process.env.ARK_VISION_MODEL) cfg.ark_chat.vision_model = process.env.ARK_VISION_MODEL
  if (process.env.PP_TOKEN) cfg.pp_structure.token = process.env.PP_TOKEN
  if (process.env.BIGMODEL_API_KEY) cfg.bigmodel.api_key = process.env.BIGMODEL_API_KEY
  // App 代理口令：config.yaml 的 app_llm.token 已被上面的 parse 读入，这里只做环境变量覆盖
  if (process.env.APP_LLM_TOKEN) cfg.app_llm.token = process.env.APP_LLM_TOKEN

  // 默认提示词补全
  const prompts = cfg.llm_prompts as Record<string, string>
  for (const [k, v] of Object.entries(DEFAULT_PROMPTS)) {
    if (!prompts[k]) prompts[k] = v
  }

  return cfg
}

// 单例
let _cfg: AppConfig | null = null
export function getConfig(): AppConfig {
  if (!_cfg) _cfg = loadConfig()
  return _cfg
}
