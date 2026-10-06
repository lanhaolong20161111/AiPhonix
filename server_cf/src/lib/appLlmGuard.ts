/**
 * App 端 LLM 代理的**请求校验（纯函数，零依赖）**。
 *
 * 为什么单独一个文件：路由层要 import deepseek/db（有副作用、要 D1），而下面这段
 * 「客户端到底能提什么」是**安全边界**，必须能被便宜地、无副作用地反复单测。
 *
 * 🔴 校验原则：**客户端的输入一律不可信，且只有这里显式放行的字段才会进上游请求。**
 *    客户端传 `model` / `stream` / `n` / `tools` / `frequency_penalty` …… 全部丢弃。
 *    尤其是 `model`：如果照转，客户端就能把服务端配的便宜模型换成更贵的，
 *    预算守卫的「单次最坏预估」也就按错误费率估了。
 */

export interface AppLlmLimits {
  /** messages 条数上限。正常只有 2 条（system + user），8 条已足够多轮 */
  maxMessages: number
  /** 单条 content 的字符上限 */
  maxContentChars: number
  /** 全部 content 合计字符上限 —— 预算守卫按这个数估算输入成本 */
  maxInputChars: number
  /** 未指定 max_tokens 时的默认值 */
  defaultMaxTokens: number
  /** max_tokens 硬上限，越界**钳制**而非报错 */
  maxMaxTokens: number
  /** temperature 上限，越界钳制 */
  maxTemperature: number
  /**
   * 未指定 thinking 时的默认开关。
   * 默认 **disabled**：这是给小学生的即时语音问答，实测关掉思考后
   * reasoning token 归零、成本 487→228 token、耗时 2.03s→1.57s，而内容质量不变。
   */
  defaultThinking: "disabled" | "enabled"
}

export const APP_LLM_LIMITS: AppLlmLimits = {
  maxMessages: 8,
  maxContentChars: 4000,
  maxInputChars: 8000,
  defaultMaxTokens: 512,
  maxMaxTokens: 2048,
  maxTemperature: 1.5,
  defaultThinking: "disabled",
}

export type AppLlmRole = "system" | "user" | "assistant"

export interface AppLlmMessage {
  role: AppLlmRole
  content: string
}

export interface AppLlmRequest {
  messages: AppLlmMessage[]
  maxTokens: number
  temperature: number
  /** 只保留 type —— 这是唯一直接决定「烧不烧思考 token」的开关 */
  thinking: { type: "disabled" | "enabled" }
  /** 只有 json_object 会被转发（json_schema 需要服务端校验 schema，这里不做） */
  responseFormat?: { type: "json_object" }
  /** 合计输入字符数，供预算守卫使用 */
  inputChars: number
}

export interface AppLlmRejection {
  status: 400 | 422
  message: string
  /** OpenAI 的错误码习惯 */
  code: string
}

export type AppLlmNormalizeResult =
  | { ok: true; value: AppLlmRequest }
  | { ok: false; error: AppLlmRejection }

const ROLES: readonly AppLlmRole[] = ["system", "user", "assistant"]

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function reject(status: 400 | 422, message: string, code = "invalid_request_error"): AppLlmNormalizeResult {
  return { ok: false, error: { status, message, code } }
}

/** 只认这几个字面量；其它值（含对象、数组、乱填的字符串）一律视为「没提」 */
function pickThinking(raw: unknown, fallback: "disabled" | "enabled"): { type: "disabled" | "enabled" } {
  const t = (raw as { type?: unknown } | null | undefined)?.type
  if (t === "disabled" || t === "enabled") return { type: t }
  return { type: fallback }
}

function pickResponseFormat(raw: unknown): { type: "json_object" } | undefined {
  const t = (raw as { type?: unknown } | null | undefined)?.type
  return t === "json_object" ? { type: "json_object" } : undefined
}

/**
 * 归一化 + 校验。返回的 `value` 可以直接拼进上游请求体。
 *
 * 为什么把「钳制」和「拒绝」分开：
 * - **越界类**（max_tokens 填了 99999、temperature 填了 5）⇒ **钳制**。客户端填大是常见失误，
 *   为它让整条请求失败，用户体验上很蠢，而且钳到硬上限后成本本来就已封顶。
 * - **结构类**（messages 不是数组、role 不认识、content 不是非空字符串）⇒ **拒绝**。
 *   这类输入说明调用方根本不是我们的客户端，继续下去只会把脏数据送给上游。
 */
export function normalizeAppLlmRequest(
  body: unknown,
  limits: AppLlmLimits = APP_LLM_LIMITS
): AppLlmNormalizeResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return reject(400, "请求体必须是一个 JSON 对象")
  }
  const b = body as Record<string, unknown>

  const rawMessages = b.messages
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return reject(400, "messages 必须是非空数组")
  }
  if (rawMessages.length > limits.maxMessages) {
    return reject(422, `messages 最多 ${limits.maxMessages} 条`)
  }

  const messages: AppLlmMessage[] = []
  let inputChars = 0
  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i] as Record<string, unknown> | null
    if (m === null || typeof m !== "object" || Array.isArray(m)) {
      return reject(422, `messages[${i}] 必须是一个对象`)
    }
    const role = m.role
    if (typeof role !== "string" || !ROLES.includes(role as AppLlmRole)) {
      return reject(422, `messages[${i}].role 只能是 system / user / assistant`)
    }
    const content = m.content
    if (typeof content !== "string" || content.trim() === "") {
      return reject(422, `messages[${i}].content 必须是非空字符串（多模态数组不支持）`)
    }
    if (content.length > limits.maxContentChars) {
      return reject(422, `messages[${i}].content 超过 ${limits.maxContentChars} 字符`)
    }
    inputChars += content.length
    messages.push({ role: role as AppLlmRole, content })
  }
  if (inputChars > limits.maxInputChars) {
    return reject(422, `全部 messages 合计超过 ${limits.maxInputChars} 字符`)
  }

  const mtRaw = b.max_tokens
  const mt =
    typeof mtRaw === "number" && Number.isFinite(mtRaw)
      ? Math.floor(mtRaw)
      : limits.defaultMaxTokens
  const maxTokens = clamp(mt, 1, limits.maxMaxTokens)

  const tRaw = b.temperature
  const temperature =
    typeof tRaw === "number" && Number.isFinite(tRaw) ? clamp(tRaw, 0, limits.maxTemperature) : 0.7

  return {
    ok: true,
    value: {
      messages,
      maxTokens,
      temperature,
      thinking: pickThinking(b.thinking, limits.defaultThinking),
      responseFormat: pickResponseFormat(b.response_format),
      inputChars,
    },
  }
}
