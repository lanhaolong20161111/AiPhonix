/** DeepSeek/Ark LLM 服务 — Cloudflare 版：D1（async）持久化预算/日志，其余语义与 server_ts 一致
 *
 * - 预算守卫（付费链路）：输入长度 / 日累计费用 / 单次预估费用（D1 持久化）
 * - 调用日志（llm_call_log 表，上限 100000 条）
 * - 付费 DeepSeek：fetch 120s 超时；空 content 且 finish_reason=length 时放宽 max_tokens 重试一次
 * - 免费 Ark：跳过预算守卫，费用恒为 0
 * - 原 server_ts 的「历史 JSON → SQLite 一次性导入」在 Cloud 版已无意义（数据已迁 D1），删除
 */
import { getConfig } from "../env.js"
import { getArk } from "./ark.js"
import { eq, asc, sql } from "drizzle-orm"
import { getDb, sqlFirst, sqlRun } from "../db/index.js"
import { llmCallLog, llmBudgetDay } from "../db/schema.js"

export class BudgetExceededError extends Error {
  status: number
  budget: boolean
  constructor(message = "今日 AI 额度已用完") {
    super(message)
    this.status = 429
    this.budget = true
  }
}

const COST_PER_M_INPUT = 0.5
const COST_PER_M_OUTPUT = 2.0
/** GLM-5.3-Flash 估算费率（元/百万 tokens）——按智谱 flash 档位保守估计，可在实际账单核对后调整 */
const GLM_COST_PER_M_INPUT = 0.2
const GLM_COST_PER_M_OUTPUT = 0.2
const MAX_LOGS = 100000

// ── 调用日志（D1 行式追加）──

export interface LLMCallLog {
  time: string
  caller: string
  model: string
  system_prompt: string
  user_prompt: string
  prompt_tokens: number
  comp_tokens: number
  total_tokens: number
  cost_yuan: number
  duration_ms: number
  success: boolean
  error: string
}

let _logCount: number | null = null

async function ensureLogCount(): Promise<number> {
  if (_logCount === null) {
    const r = await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM llm_call_log")
    _logCount = r?.n ?? 0
  }
  return _logCount
}

async function appendLog(log: LLMCallLog): Promise<void> {
  await getDb().insert(llmCallLog)
    .values({
      time: log.time,
      caller: log.caller,
      model: log.model,
      systemPrompt: log.system_prompt,
      userPrompt: log.user_prompt,
      promptTokens: log.prompt_tokens,
      compTokens: log.comp_tokens,
      totalTokens: log.total_tokens,
      costYuan: log.cost_yuan,
      durationMs: log.duration_ms,
      success: log.success,
      error: log.error,
    })
    .run()
  _logCount = (_logCount ?? 0) + 1
  // 超上限时修剪最旧的（低频触发）
  if (_logCount > MAX_LOGS + 1000) {
    await sqlRun(
      `DELETE FROM llm_call_log WHERE id <= (SELECT IFNULL(MAX(id),0) FROM llm_call_log) - ${MAX_LOGS}`
    )
    const r = await sqlFirst<{ n: number }>("SELECT COUNT(*) AS n FROM llm_call_log")
    _logCount = r?.n ?? 0
  }
}

export async function getCallLogs(): Promise<LLMCallLog[]> {
  const rows = await getDb().select().from(llmCallLog).orderBy(asc(llmCallLog.id)).limit(MAX_LOGS).all()
  return rows.map((r) => ({
    time: r.time,
    caller: r.caller,
    model: r.model,
    system_prompt: r.systemPrompt,
    user_prompt: r.userPrompt,
    prompt_tokens: r.promptTokens,
    comp_tokens: r.compTokens,
    total_tokens: r.totalTokens,
    cost_yuan: r.costYuan,
    duration_ms: r.durationMs,
    success: Boolean(r.success),
    error: r.error,
  }))
}

export async function clearCallLogs(): Promise<void> {
  await getDb().delete(llmCallLog).run()
  _logCount = 0
}

// ── 日累计预算（D1 持久化，跨重启且单一事实来源）──

interface DayCost {
  date: string
  total_cost: number
  calls: number
}

function today(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

export async function getDayCost(): Promise<DayCost> {
  const d = today()
  const row = await getDb().select().from(llmBudgetDay).where(eq(llmBudgetDay.date, d)).get()
  if (!row) return { date: d, total_cost: 0, calls: 0 }
  return { date: d, total_cost: row.totalCost, calls: row.calls }
}

async function recordCost(cost: number): Promise<void> {
  const d = today()
  await getDb().insert(llmBudgetDay)
    .values({ date: d, totalCost: cost, calls: 1 })
    .onConflictDoUpdate({
      target: llmBudgetDay.date,
      set: {
        totalCost: sql`${llmBudgetDay.totalCost} + ${cost}`,
        calls: sql`${llmBudgetDay.calls} + 1`,
      },
    })
    .run()
}

// ── 预算守卫（纯函数，供单测；chat() 在走付费链路前调用）──

export interface BudgetLimits {
  max_input_chars: number
  max_cost_per_day: number
  max_cost_per_call: number
}

/** 三段守卫：输入长度 / 日累计费用 / 单次最坏预估。超限抛 BudgetExceededError（全局 429）。 */
export function checkBudget(
  inputLen: number,
  maxTokens: number,
  dayTotalCost: number,
  limits: BudgetLimits
): void {
  if (inputLen > limits.max_input_chars) {
    throw new BudgetExceededError(
      `budget: input ${inputLen} chars exceeds limit ${limits.max_input_chars}`
    )
  }
  if (dayTotalCost >= limits.max_cost_per_day) {
    throw new BudgetExceededError(
      `budget: daily cost ${dayTotalCost.toFixed(4)} yuan exceeds limit ${limits.max_cost_per_day}`
    )
  }
  const estCost = (inputLen * COST_PER_M_INPUT + maxTokens * COST_PER_M_OUTPUT) / 1_000_000
  if (estCost > limits.max_cost_per_call) {
    throw new BudgetExceededError(
      `budget: estimated cost ${estCost.toFixed(4)} yuan exceeds per-call limit ${limits.max_cost_per_call}`
    )
  }
}

// ── 时间/工具 ──

function localIso(): string {
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? "+" : "-"
  const abs = Math.abs(off)
  const hh = String(Math.floor(abs / 60)).padStart(2, "0")
  const mm = String(abs % 60).padStart(2, "0")
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${hh}${mm}`
}

interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

/** 调用 DeepSeek OpenAI 兼容 API（带超时） */
async function openaiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  chatPath = "/v1/chat/completions",
  extraBody?: Record<string, unknown>
): Promise<{
  content: string
  finish_reason: string
  prompt_tokens: number
  comp_tokens: number
}> {
  const url = baseUrl.replace(/\/+$/, "") + chatPath
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false, ...extraBody }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    throw new Error(`LLM API ${res.status}: ${await res.text().catch(() => "")}`)
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    finish_reason: data.choices?.[0]?.finish_reason ?? "",
    prompt_tokens: data.usage?.prompt_tokens ?? 0,
    comp_tokens: data.usage?.completion_tokens ?? 0,
  }
}

export interface ChatOptions {
  /**
   * true = 只走免费 Ark 一条链路：失败立即返回 ""，不叠加付费 DeepSeek / GLM 兜底。
   * 适用对延迟敏感、可接受降级（失败走前端降级提示）的轻内容场景（如儿歌/字谜）。
   * 默认 false（保持原行为：Ark → DeepSeek → GLM 逐级兜底）。
   */
  arkOnly?: boolean
}

/** 通用聊天调用：免费 Ark 豆包优先（跳过预算守卫，费用 0），失败回退付费 DeepSeek（预算守卫+计费）→ GLM 兜底。
 * arkOnly=true 时仅走免费 Ark 一条链（儿歌/字谜等生成型内容的成本闸门），失败快速返回空。 */
export async function chat(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2048,
  caller = "",
  disableThinking = false,
  options: ChatOptions = {}
): Promise<string> {
  const cfg = getConfig()
  const start = Date.now()

  const baseLog: LLMCallLog = {
    time: localIso(),
    caller,
    model: cfg.deepseek.model,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    prompt_tokens: 0,
    comp_tokens: 0,
    total_tokens: 0,
    cost_yuan: 0,
    duration_ms: 0,
    success: false,
    error: "",
  }

  // ── 免费优先：火山 Ark（豆包，全文本统一）可用则每次先走免费链路，跳过预算守卫 ──
  if (cfg.ark_chat.api_key) {
    const log: LLMCallLog = { ...baseLog, model: cfg.ark_chat.model }
    try {
      const content = await getArk().chat({
        prompt: userPrompt,
        system_prompt: systemPrompt,
        max_tokens: maxTokens,
        disable_thinking: disableThinking,
      })
      if (!content) {
        log.error = "empty content"
        await finishLog(log, start)
        throw new Error("Ark 免费模型返回空内容")
      }
      log.success = true
      log.cost_yuan = 0
      await finishLog(log, start)
      return content
    } catch (e) {
      log.error = String((e as Error).message ?? e)
      await finishLog(log, start)
      if (options.arkOnly) {
        // arkOnly：免费链路失败立即返回，不叠加付费回退（快速失败）
        console.warn(`[llm] Ark 免费调用失败(${caller}): ${log.error}（arkOnly，不再回退）`)
        return ""
      }
      console.warn(`[llm] Ark 免费调用失败(${caller}): ${log.error}，回退 DeepSeek`)
    }
  } else if (options.arkOnly) {
    const log: LLMCallLog = { ...baseLog, error: "未配置 ARK_API_KEY（arkOnly 模式）" }
    await finishLog(log, start)
    return ""
  }

  // ── 付费链路：DeepSeek（预算守卫 + 计费） ──
  const log: LLMCallLog = { ...baseLog, model: cfg.deepseek.model }

  try {
    const dayCost = await getDayCost()
    checkBudget(systemPrompt.length + userPrompt.length, maxTokens, dayCost.total_cost, cfg.deepseek)
  } catch (e) {
    log.error = String((e as Error).message ?? e)
    await finishLog(log, start)
    // 预算超限：明确拒绝服务（429），不再回退到无日上限的付费 GLM，避免真金白银损失。
    // 其余（网络/空内容等）失败仍走 GLM 兜底作为质量降级。
    if (e instanceof BudgetExceededError || (e as { budget?: boolean }).budget) {
      throw e
    }
    const glm = await tryGlmFallback(systemPrompt, userPrompt, maxTokens, caller, log.error)
    if (glm !== null) return glm
    throw e
  }

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]
    let content = ""
    let promptTokens = 0
    let compTokens = 0
    for (const attempt of [0, 1]) {
      const r = await openaiCompatible(
        cfg.deepseek.base_url,
        cfg.deepseek.api_key,
        cfg.deepseek.model,
        messages,
        attempt === 0 ? maxTokens : maxTokens * 2 + 512,
        0.7,
        undefined,
        // 关闭思考（deepseek-v4 系列是思考模型，默认带思维链慢且吞 token）
        disableThinking ? { thinking: { type: "disabled" } } : undefined
      )
      content = r.content
      promptTokens = r.prompt_tokens
      compTokens = r.comp_tokens
      if (content) break
      if (attempt === 0 && r.finish_reason === "length") {
        console.warn(`[llm] DeepSeek 输出被 max_tokens=${maxTokens} 截断，放宽重试（caller=${caller}）`)
        continue
      }
      break
    }

    log.prompt_tokens = promptTokens
    log.comp_tokens = compTokens
    log.total_tokens = promptTokens + compTokens
    log.cost_yuan = (promptTokens / 1_000_000) * COST_PER_M_INPUT + (compTokens / 1_000_000) * COST_PER_M_OUTPUT

    if (!content) {
      log.error = "empty content"
      await finishLog(log, start)
      // 空内容（思考模型吞 token 等）同样走 GLM 兜底，不让对话拿空回复
      const glm = await tryGlmFallback(systemPrompt, userPrompt, maxTokens, caller, "DeepSeek 空内容")
      if (glm !== null) return glm
      return ""
    }
    log.success = true
    log.error = ""
    await finishLog(log, start)
    await recordCost(log.cost_yuan)
    return content
  } catch (e) {
    log.error = String((e as Error).message ?? e)
    await finishLog(log, start)
    const glm = await tryGlmFallback(systemPrompt, userPrompt, maxTokens, caller, log.error)
    if (glm !== null) return glm
    throw e
  }
}

export async function finishLog(log: LLMCallLog, start: number): Promise<void> {
  log.duration_ms = Date.now() - start
  await appendLog(log)
}

async function tryGlmFallback(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  caller: string,
  cause: string
): Promise<string | null> {
  const cfg = getConfig()
  if (!cfg.bigmodel.api_key) {
    console.warn(`[llm] GLM 兜底未配置 BIGMODEL_API_KEY，跳过（caller=${caller}，原因: ${cause}）`)
    return null
  }
  const start = Date.now()
  const log: LLMCallLog = {
    time: localIso(),
    caller,
    model: cfg.bigmodel.model,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    prompt_tokens: 0,
    comp_tokens: 0,
    total_tokens: 0,
    cost_yuan: 0,
    duration_ms: 0,
    success: false,
    error: "",
  }
  try {
    const r = await openaiCompatible(
      cfg.bigmodel.base_url,
      cfg.bigmodel.api_key,
      cfg.bigmodel.model,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // GLM-5.3-Flash 是常思考模型（无法关闭），思维链会消耗 token：给足余量并用 low 档
      Math.max(maxTokens * 2, maxTokens + 1024),
      0.7,
      "/v4/chat/completions",
      { thinking: { level: "low" } }
    )
    log.prompt_tokens = r.prompt_tokens
    log.comp_tokens = r.comp_tokens
    log.total_tokens = r.prompt_tokens + r.comp_tokens
    log.cost_yuan =
      (r.prompt_tokens / 1_000_000) * GLM_COST_PER_M_INPUT +
      (r.comp_tokens / 1_000_000) * GLM_COST_PER_M_OUTPUT
    log.duration_ms = Date.now() - start
    if (!r.content) {
      log.error = "empty content"
      await finishLog(log, start)
      console.warn(`[llm] GLM 兜底返回空内容（caller=${caller}）`)
      return null
    }
    log.success = true
    log.error = ""
    await finishLog(log, start)
    await recordCost(log.cost_yuan)
    console.warn(`[llm] GLM 兜底成功（caller=${caller}, model=${cfg.bigmodel.model}, cost=${log.cost_yuan.toFixed(4)}元）`)
    return r.content
  } catch (e) {
    log.error = String((e as Error).message ?? e)
    log.duration_ms = Date.now() - start
    await finishLog(log, start)
    console.warn(`[llm] GLM 兜底失败（caller=${caller}）: ${log.error}`)
    return null
  }
}