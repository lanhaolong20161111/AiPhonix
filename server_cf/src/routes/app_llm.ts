/**
 * App 端 LLM 代理 — `POST /api/v1/app-llm/chat/completions`
 *
 * ## 为什么存在
 * 小英（xiaoying）正式版的 APK 里烘焙了 DeepSeek key，而 APK 是要发出去给人装的二进制：
 * `unzip app.apk 'classes*.dex' && grep -a 'sk-'` 就能拿到明文 key。
 * 把 key 换成「一个随时可作废的访问口令」之后，最坏情况只是**换口令**，
 * 不必去 DeepSeek 后台轮换 key，也不会有账单被别人刷走。
 *
 * ## 为什么 OpenAI 兼容
 * 客户端（Android 的 `LlmClient`）只改 baseUrl 与凭据，**请求体构造与响应解析一行都不用改**；
 * 将来要换模型、要加流式，协议也不用动。
 *
 * ## 三条安全边界（少任何一条，这就是一个免费 LLM 中转站）
 * 1. **口令 fail closed** —— 服务端没配口令（或短于 16 字符）时整块端点关闭。
 *    这样「忘了配 secret」的结果是「不能用」，而不是「对全世界开放」。
 * 2. **白名单转发** —— 只有 `lib/appLlmGuard.ts` 放行的字段会进上游请求，
 *    尤其 **model 由服务端决定**：客户端传什么都无效，否则它能把便宜模型换成贵的，
 *    预算守卫的「单次最坏预估」也就按错误费率估了。
 * 3. **预算守卫** —— 复用 `lib/deepseek.ts` 的 `llm_budget_day`，与 web 端共用同一条
 *    日累计硬顶。所以「App 被刷」最多把当天额度提前用完，不会烧穿预算。
 *
 * ⚠️ 诚实地说：口令本身会随 APK 一起被人拿到（它就是编译进客户端的），
 * 所以它**不是**密码学意义上的隔离，而是一个「可作废的开关」。真正扛住滥用的
 * 是第 3 条预算硬顶。这一点在给用户的说明里不能含糊。
 */
import { Hono } from "hono"
import { getConfig } from "../env.js"
import { BudgetExceededError, chatForApp } from "../lib/deepseek.js"
import { normalizeAppLlmRequest } from "../lib/appLlmGuard.js"

const router = new Hono()

/** 口令最短长度。短于它就当作「没配」⇒ 整块关闭（fail closed）。 */
const MIN_TOKEN_CHARS = 16

/**
 * 请求体上限。真正的字段级上限在 appLlmGuard 里（合计 8000 字符），
 * 这里只是**在解析 JSON 之前**挡掉「故意发一个 50MB 的 body」这种廉价攻击——
 * 否则光是把它读进内存、交给 JSON.parse 就已经消耗掉这个请求的配额了。
 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * 口令校验。与下载页 `/dl/*` 同一套做法：定长比较，
 * 不给「靠响应时间逐字节猜口令」留路（口令虽长，多写这几行不值一提）。
 */
function tokenOk(input: string): boolean {
  const want = (getConfig().app_llm.token ?? "").trim()
  if (want.length < MIN_TOKEN_CHARS) return false
  if (input.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= input.charCodeAt(i) ^ want.charCodeAt(i)
  return diff === 0
}

function bearer(header: string | undefined): string {
  if (!header) return ""
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : ""
}

/**
 * 错误一律用 **OpenAI 的错误信封**，而不是本项目惯用的 `{detail}`。
 *
 * 这是刻意的：本端点的契约就是「OpenAI 兼容」，标准客户端（openai-js / openai-python）
 * 只认 `error.message`；给 `{detail}` 会让它们把一次 401 报成「响应解析失败」。
 * 代价是与全局 `onError` 的 `{detail}` 不一致 —— 所以本路由**自己接管所有异常**，
 * 一个都不漏给全局处理器（预算超限也在本路由内转成 `insufficient_quota`）。
 */
function oaiError(status: number, message: string, code: string, type: string) {
  return { error: { message, type, code, status } }
}

/** OpenAI 的 id 习惯是 `chatcmpl-` + 随机串 */
function newId(): string {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return raw.replace(/-/g, "").slice(0, 24)
}

router.post("/app-llm/chat/completions", async (c) => {
  if (!tokenOk(bearer(c.req.header("Authorization")))) {
    return c.json(oaiError(401, "访问口令无效（或服务端未配置口令）", "invalid_api_key", "invalid_request_error"), 401)
  }

  const declared = Number(c.req.header("Content-Length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return c.json(oaiError(413, `请求体超过 ${MAX_BODY_BYTES} 字节`, "request_too_large", "invalid_request_error"), 413)
  }

  const body = await c.req.json().catch(() => null)
  const norm = normalizeAppLlmRequest(body)
  if (!norm.ok) {
    return c.json(
      oaiError(norm.error.status, norm.error.message, norm.error.code, "invalid_request_error"),
      norm.error.status
    )
  }
  const req = norm.value

  try {
    const r = await chatForApp({
      messages: req.messages,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      thinking: req.thinking,
      responseFormat: req.responseFormat,
      // caller 进 llm_call_log，便于在 /api/v1/ops 里把 App 的用量单独挑出来
      caller: "app_xiaoying",
    })
    return c.json({
      id: `chatcmpl-${newId()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: r.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: r.content },
          finish_reason: r.finish_reason || "stop",
        },
      ],
      usage: {
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.comp_tokens,
        total_tokens: r.prompt_tokens + r.comp_tokens,
      },
    })
  } catch (e) {
    // 预算超限：用 OpenAI 对「额度耗尽」的同一个 code，客户端可据此分支提示
    if (e instanceof BudgetExceededError || (e as { budget?: boolean }).budget) {
      return c.json(
        oaiError(429, "今日 AI 额度已用完，请明天再试", "insufficient_quota", "insufficient_quota"),
        429
      )
    }
    const msg = String((e as Error).message ?? e).slice(0, 300)
    return c.json(oaiError(502, `上游调用失败：${msg}`, "upstream_error", "api_error"), 502)
  }
})

export default router
