/**
 * App 端 LLM 代理 — `POST /api/v1/app-llm/chat/completions`
 *
 * ## 为什么存在
 * 小英（xiaoying）App 的 APK 要发出去给人装，客户端里不能烘焙任何 AI 供应商 key：
 * `unzip app.apk 'classes*.dex' && grep -a 'sk-'` 就能拿到明文 key，被刷的是供应商账单。
 * 所以客户端只带**用户自己的 JWT**（账号登录拿的），由服务端代理调用上游模型。
 *
 * ## 为什么 OpenAI 兼容
 * 客户端（Android 的 `LlmClient`）只改 baseUrl 与凭据，**请求体构造与响应解析一行都不用改**；
 * 将来要换模型、要加流式，协议也不用动。
 *
 * ## 三条安全边界（少任何一条，这就是一个免费 LLM 中转站）
 * 1. **账号鉴权** —— 凭 `Authorization: Bearer <JWT>` 解析当前用户（`resolveCurrentUser`），
 *    未登录/伪造 token 一律 401。不再有「编译进 APK 的口令」：口令随 APK 扩散的问题从根上消失。
 * 2. **白名单转发** —— 只有 `lib/appLlmGuard.ts` 放行的字段会进上游请求，
 *    尤其 **model 由服务端决定**：客户端传什么都无效，否则它能把便宜模型换成贵的，
 *    预算守卫的「单次最坏预估」也就按错误费率估了。
 * 3. **预算守卫** —— 复用 `lib/deepseek.ts` 的 `llm_budget_day`，与 web 端共用同一条
 *    日累计硬顶。所以「账号被偷」最多把当天额度提前用完，不会烧穿预算。
 *    调用日志 caller 带用户名，`/api/v1/ops` 里能精确看出是哪个账号在烧。
 */
import { Hono } from "hono"
import { getConfig } from "../env.js"
import { BudgetExceededError, chatForApp } from "../lib/deepseek.js"
import { normalizeAppLlmRequest } from "../lib/appLlmGuard.js"
import { resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()

/**
 * 请求体上限。真正的字段级上限在 appLlmGuard 里（合计 8000 字符），
 * 这里只是**在解析 JSON 之前**挡掉「故意发一个 50MB 的 body」这种廉价攻击——
 * 否则光是把它读进内存、交给 JSON.parse 就已经消耗掉这个请求的配额了。
 */
const MAX_BODY_BYTES = 64 * 1024

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
  // 账号鉴权：凭用户自己的 JWT（不再是编译进 APK 的口令）。
  // optional=true 让解析失败返回 null 而非抛错 —— 本路由自己转成 OpenAI 401 信封。
  const user = await resolveCurrentUser(c.req.header("Authorization"), true)
  if (!user) {
    return c.json(oaiError(401, "请先登录（账号未认证或登录已过期）", "invalid_api_key", "invalid_request_error"), 401)
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
      // caller 进 llm_call_log，便于在 /api/v1/ops 里把 App 的用量单独挑出来，
      // 并精确到账号（JWT 鉴权后每个请求都带着真实的 user）
      caller: `app:${user.username}`,
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
