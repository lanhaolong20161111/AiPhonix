/** 火山引擎 ARK 免费 LLM — openai SDK（chat.completions 兼容 API，多模态识图 + 文本推理 + 流式）
 *
 * 统一接入已验证的火山 ARK 模型：
 *  - 文本默认（全文本统一）：doubao-seed-2-1-turbo-260628（豆包，免费量大；纯文本/识图均可）
 *
 * 对齐 Python services/free_llm.py。原手写 fetch /responses 已改为 openai SDK。
 * 注意：流式结束时火山 ARK 会提前关闭 keep-alive 连接，SDK 偶发抛 "Premature close"，
 * 但内容已完整收集（非丢失），chatStream 已对这种情况做容错处理。
 */
import OpenAI from "openai"
import { readFileSync, existsSync } from "node:fs"
import { extname } from "node:path"
import { getConfig } from "../env.js"
import { preprocessForVision } from "./image.js"

const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
// 文本分析默认模型（豆包免费量大；识图/排版等需多模态的用 MULTIMODAL_MODEL 覆盖）。
// ⚠️ 火山方舟模型端点 ID 必须带日期版本号：doubao-seed-2-1-turbo-260628（裸名 doubao-seed-2-1-turbo 会 404 "does not exist"）。
export const DEFAULT_MODEL = "doubao-seed-2-1-turbo-260628"
// 多模态识图模型（纯文本模型不支持 image 输入，识图时用此覆盖）
export const MULTIMODAL_MODEL = "doubao-seed-2-1-turbo-260628"

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
  image_paths?: string[]
  max_tokens?: number
  model_override?: string
  disable_thinking?: boolean
}

export interface ArkService {
  enabled: boolean
  /** 非流式文本/识图调用，返回完整文本（keep-alive 收尾问题不涉及流式，直接返回） */
  chat(opts: ArkChatOptions): Promise<string>
  /** 流式调用，逐段 yield 文本；收尾的 Premature close 已容错（内容完整则视为正常结束） */
  chatStream(opts: ArkChatOptions): AsyncIterable<string>
}

export function createArkService(apiKey?: string, model?: string): ArkService {
  const cfg = getConfig()
  const key = apiKey || cfg.ark_chat.api_key || process.env.ARK_API_KEY || ""
  const defaultModel = model || cfg.ark_chat.model || DEFAULT_MODEL
  const client = new OpenAI({ apiKey: key, baseURL: BASE_URL })
  if (!key) {
    return { enabled: false, chat: async () => { throw new Error("服务端未配置 ARK_API_KEY") }, chatStream: async function* () {} }
  }

  /** 有图片时返回 content 数组（多模态），否则返回纯文本字符串 */
  async function buildUserContent(prompt: string, imagePaths: string[]): Promise<string | Array<Record<string, unknown>>> {
    const valid = (imagePaths || []).filter((p) => p && existsSync(p))
    if (!valid.length) return prompt
    const content: Record<string, unknown>[] = [{ type: "text", text: prompt }]
    for (const path of valid) {
      let buf: Buffer
      try {
        // 识图提速：长边1440 + jpeg80 预处理，砍掉大图 visual token
        buf = await preprocessForVision(path)
      } catch (e) {
        console.warn("[ark] 识图预处理失败,回退原图:", (e as Error).message)
        buf = readFileSync(path)
      }
      const b64 = buf.toString("base64")
      const ext = extname(path).slice(1).toLowerCase()
      const mime = MIME_BY_EXT[ext] || "image/jpeg"
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } })
    }
    return content
  }

  function buildMessages(opts: ArkChatOptions): Promise<Record<string, unknown>[]> {
    const messages: Record<string, unknown>[] = []
    if (opts.system_prompt) messages.push({ role: "system", content: opts.system_prompt })
    // buildUserContent 是 async，必须 await，否则 content 是 Promise 对象（序列化后为 {}）导致 400
    return buildUserContent(opts.prompt, opts.image_paths || []).then((content) => {
      messages.push({ role: "user", content })
      return messages
    })
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
    let text = ""
    for (const attempt of [0, 1] as const) {
      const completion = await client.chat.completions.create(
        (await buildBody(opts, attempt === 0 ? maxTokens : maxTokens * 3)) as never
      )
      text = completion.choices?.[0]?.message?.content ?? ""
      const finish = String(completion.choices?.[0]?.finish_reason ?? "")
      const truncated = finish === "length"
      if (text && !truncated) break
      if (attempt === 0) continue
      break
    }
    return text || ""
  }

  async function* chatStream(opts: ArkChatOptions): AsyncIterable<string> {
    if (!key) throw new Error("服务端未配置 ARK_API_KEY（火山引擎免费 token）")
    const maxTokens = opts.max_tokens ?? 2048
    // 显式标注流式返回类型，避免 openai SDK 重载在 spread 下推断不出 asyncIterator
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

// 单例
let _ark: ArkService | null = null
export function getArk(): ArkService {
  if (!_ark) _ark = createArkService()
  return _ark
}
