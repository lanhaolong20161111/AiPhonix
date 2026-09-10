/** 火山引擎 ARK 免费 LLM — Cloudflare 版：图片从 R2 读取（async），openai SDK 调用不变 */
import OpenAI from "openai"
import { readBlob, exists, toBase64 } from "./storage.js"
import { preprocessForVision } from "./image.js"
import { cleanSecret, getConfig, getEnv } from "../env.js"

const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
// 文本分析默认模型（豆包免费量大；识图/排版等需多模态的用 MULTIMODAL_MODEL 覆盖）。
// ⚠️ 火山方舟模型端点 ID 必须带日期版本号：doubao-seed-2-1-turbo-260628（裸名 doubao-seed-2-1-turbo 会 404 "does not exist"）。
export const DEFAULT_MODEL = "doubao-seed-2-1-turbo-260628"
// ARK 单次请求默认超时：排版输出长 JSON 易超 30s，提到 60s 减少无谓超时回退。
// 调用方可在 ArkChatOptions.timeout_ms 按场景覆盖。
const ARK_TIMEOUT_MS = 60_000
// 多模态识图模型（纯文本模型不支持 image 输入，识图时用此覆盖）
// 2026-09-01：旧视觉模型实测慢或超时，已弃用；统一 doubao-seed-2.1-turbo。
// ⚠️ 火山方舟视觉模型端点 ID 必须带日期版本号：doubao-seed-2-1-turbo-260628（裸名 doubao-seed-2-1-turbo 会 404 "does not exist"）。
export const MULTIMODAL_MODEL = "doubao-seed-2-1-turbo-260628"

/** 当前生效的多模态识图模型：优先取环境变量 ARK_VISION_MODEL，未设则用默认。
 * 目的：换视觉模型不必改代码，改一个变量即可；可在 staging 先对比速度与质量再决定是否上生产。
 * 全项目统一使用 doubao-seed-2-1-turbo-260628（旧视觉模型均已弃用）。
 * ⚠️ 端点名必须带日期后缀，否则火山方舟返回 404。 */
export function multimodalModel(): string {
  try {
    const m = getConfig().ark_chat.vision_model
    if (m && m.trim()) return m.trim()
  } catch {
    // env 未初始化（单测等场景）时回退默认
  }
  return MULTIMODAL_MODEL
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
}

export interface ArkChatOptions {
  prompt: string
  system_prompt?: string
  /** R2 key（本地绝对路径/相对路径会自动归一化） */
  image_paths?: string[]
  max_tokens?: number
  model_override?: string
  disable_thinking?: boolean
  /** 单次请求超时（ms），默认 ARK_TIMEOUT_MS。识图/长 JSON 排版可放宽。 */
  timeout_ms?: number
}

export interface ArkService {
  enabled: boolean
  chat(opts: ArkChatOptions): Promise<string>
  chatStream(opts: ArkChatOptions): AsyncIterable<string>
}

function extOf(path: string): string {
  const m = path.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ""
}

export function createArkService(apiKey?: string, model?: string): ArkService {
  const cfg = getConfig()
  const key = apiKey || cfg.ark_chat.api_key || cleanSecret(getEnv().ARK_API_KEY || "") || ""
  const defaultModel = model || cfg.ark_chat.model || DEFAULT_MODEL
  const client = new OpenAI({ apiKey: key, baseURL: BASE_URL })
  if (!key) {
    return { enabled: false, chat: async () => { throw new Error("服务端未配置 ARK_API_KEY") }, chatStream: async function* () {} }
  }

  /** 有图片时返回 content 数组（多模态），否则返回纯文本字符串 */
  async function buildUserContent(prompt: string, imagePaths: string[]): Promise<string | Array<Record<string, unknown>>> {
    const valid: string[] = []
    for (const p of imagePaths || []) {
      if (p && (await exists(p))) valid.push(p)
    }
    if (!valid.length) return prompt
    const content: Record<string, unknown>[] = [{ type: "text", text: prompt }]
    for (const path of valid) {
      let buf: Uint8Array
      const mime = MIME_BY_EXT[extOf(path)] || "image/jpeg"
      try {
        // 识图提速：长边1440 + jpeg80 预处理，砍掉大图 visual token（Worker 用 @jsquash 等价 sharp）
        const processed = await preprocessForVision(path)
        buf = new Uint8Array(processed)
      } catch (e) {
        console.warn("[ark] 识图预处理失败,回退原图:", (e as Error).message)
        const raw = await readBlob(path)
        if (!raw) continue
        buf = new Uint8Array(raw)
      }
      const b64 = toBase64(buf)
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } })
    }
    return content.length > 1 ? content : prompt
  }

  async function buildMessages(opts: ArkChatOptions): Promise<Record<string, unknown>[]> {
    const messages: Record<string, unknown>[] = []
    if (opts.system_prompt) messages.push({ role: "system", content: opts.system_prompt })
    messages.push({ role: "user", content: await buildUserContent(opts.prompt, opts.image_paths || []) })
    return messages
  }

  async function buildBody(opts: ArkChatOptions, maxTokens: number): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      model: opts.model_override || defaultModel,
      messages: await buildMessages(opts),
      max_tokens: maxTokens,
    }
    if (opts.disable_thinking) body.thinking = { type: "disabled" }
    return body
  }

  async function chat(opts: ArkChatOptions): Promise<string> {
    if (!key) throw new Error("服务端未配置 ARK_API_KEY（火山引擎免费 token）")
    const maxTokens = opts.max_tokens ?? 2048
    const perCallTimeout = opts.timeout_ms ?? ARK_TIMEOUT_MS
    const model = opts.model_override || defaultModel
    const hasImage = (opts.image_paths || []).length > 0
    const tStart = Date.now()
    let text = ""
    for (const attempt of [0, 1] as const) {
      const tokens = attempt === 0 ? maxTokens : maxTokens * 3
      const tAttempt = Date.now()
      const completion = await client.chat.completions.create(
        (await buildBody(opts, tokens)) as never,
        // 非流式单次请求超时（chatStream 不受影响）
        { timeout: perCallTimeout }
      )
      const ms = Date.now() - tAttempt
      text = completion.choices?.[0]?.message?.content ?? ""
      const finish = String(completion.choices?.[0]?.finish_reason ?? "")
      const truncated = finish === "length"
      // 耗时打点：attempt=1 表示首次输出被 max_tokens 截断、已触发 max_tokens*3 的完整重跑
      //（第一次的耗时全部白费），调大调用方 max_tokens 可消除。
      console.log(
        `[ark] attempt=${attempt} model=${model} image=${hasImage ? 1 : 0} max_tokens=${tokens} ms=${ms} finish=${finish} chars=${text.length}`
      )
      if (text && !truncated) break
      if (attempt === 0) continue
      break
    }
    console.log(`[ark] done total=${Date.now() - tStart}ms model=${model} image=${hasImage ? 1 : 0} chars=${text.length}`)
    return text || ""
  }

  async function* chatStream(opts: ArkChatOptions): AsyncIterable<string> {
    if (!key) throw new Error("服务端未配置 ARK_API_KEY（火山引擎免费 token）")
    const maxTokens = opts.max_tokens ?? 2048
    const stream: AsyncIterable<{ choices?: { delta?: { content?: string | null } }[] }> =
      (await client.chat.completions.create({
        ...((await buildBody(opts, maxTokens)) as object),
        stream: true,
      } as never)) as unknown as AsyncIterable<{ choices?: { delta?: { content?: string | null } }[] }>
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) yield delta
      }
    } catch (e) {
      // 火山 ARK 流式收尾会提前关闭 keep-alive 连接 -> SDK 抛 Premature close；
      // 此时内容已完整收集（循环内已消费），视为正常结束而非失败。
      const msg = String((e as Error).message ?? e)
      if (msg.includes("Premature close")) return
      throw e
    }
  }

  return { enabled: !!key, chat, chatStream }
}

// 每次调用按当前 config/secret 现取（createArkService 内部已读 getConfig()/getEnv()），
// 不再模块级缓存旧实例——secret 轮换后随 getConfig 的 60s TTL 生效。
export function getArk(): ArkService {
  return createArkService()
}
