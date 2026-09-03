/** DeepSeek/Ark LLM 服务 — 免费 Ark doubao 优先，失败回退付费 DeepSeek（对齐 Python services/deepseek.py）
 *
 * 完整实现：
 * - 预算守卫（付费链路）：输入长度（system+user 求和）/ 日累计费用（持久化，重启不丢）/ 单次预估费用
 * - 调用日志（data/llm_call_logs.json，上限 100000 条）
 * - 日累计费用持久化（data/llm_budget.json，按日期重置）
 * - 付费 DeepSeek：fetch 120s 超时；空 content 且 finish_reason=length 时放宽 max_tokens 重试一次
 * - 免费 Ark：跳过预算守卫，费用恒为 0
 */
import { getConfig, DATA_DIR } from "../env.js"
import { getArk } from "./ark.js"
import { join } from "node:path"
import { existsSync, readFileSync, renameSync } from "node:fs"
import { eq, asc, sql } from "drizzle-orm"
import { db, sqlite } from "../db/index.js"
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
/** GLM-5.3-Flash 估算费率（元/百万 tokens）——对齐 server_cf 兜底链路 */
const GLM_COST_PER_M_INPUT = 0.2
const GLM_COST_PER_M_OUTPUT = 0.2
const MAX_LOGS = 100000

// ── 调用日志（SQLite 行式追加；原 llm_call_logs.json 已废弃，杜绝全量重写放大）──

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

let _logCount = (sqlite.prepare("SELECT COUNT(*) AS n FROM llm_call_log").get() as { n: number }).n

function appendLog(log: LLMCallLog): void {
  db.insert(llmCallLog)
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
  _logCount++
  // 超上限时整段修剪最旧的（低频触发，WAL 下毫秒级）
  if (_logCount > MAX_LOGS + 1000) {
    sqlite.exec(
      `DELETE FROM llm_call_log WHERE id <= (SELECT IFNULL(MAX(id),0) FROM llm_call_log) - ${MAX_LOGS}`
    )
    _logCount = (sqlite.prepare("SELECT COUNT(*) AS n FROM llm_call_log").get() as { n: number }).n
  }
}

export function getCallLogs(): LLMCallLog[] {
  const rows = db.select().from(llmCallLog).orderBy(asc(llmCallLog.id)).limit(MAX_LOGS).all()
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

export function clearCallLogs(): void {
  db.delete(llmCallLog).run()
  _logCount = 0
}

// ── 日累计预算（SQLite 持久化；原 llm_budget.json 已废弃，跨重启且单一事实来源）──

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

export function getDayCost(): DayCost {
  const d = today()
  const row = db.select().from(llmBudgetDay).where(eq(llmBudgetDay.date, d)).get()
  if (!row) return { date: d, total_cost: 0, calls: 0 }
  return { date: d, total_cost: row.totalCost, calls: row.calls }
}

function recordCost(cost: number): void {
  const d = today()
  db.insert(llmBudgetDay)
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

// ── 历史遗留 JSON → SQLite 一次性导入（幂等：仅当两处都为新数据时跳过）──
;(() => {
  try {
    // llm_budget.json：取文件里的当日花费，若库中尚无该日记录则并入
    const budgetFile = join(DATA_DIR, "llm_budget.json")
    if (existsSync(budgetFile)) {
      const data = JSON.parse(readFileSync(budgetFile, "utf8")) as Partial<DayCost> | null
      if (data?.date === today()) {
        const has = db.select().from(llmBudgetDay).where(eq(llmBudgetDay.date, data.date)).get()
        if (!has && Number(data.total_cost ?? 0) > 0) {
          db.insert(llmBudgetDay)
            .values({ date: data.date, totalCost: Number(data.total_cost), calls: Number(data.calls ?? 0) })
            .onConflictDoNothing()
            .run()
          console.log("[llm] 已从 llm_budget.json 迁移当日预算到 SQLite")
        }
        renameSync(budgetFile, budgetFile + ".imported-bak")
      }
    }
    // llm_call_logs.json：表空时整体导入（保持时间顺序）
    const logsFile = join(DATA_DIR, "llm_call_logs.json")
    if (existsSync(logsFile) && _logCount === 0) {
      const arr = JSON.parse(readFileSync(logsFile, "utf8"))
      if (Array.isArray(arr) && arr.length) {
        const stmt = sqlite.prepare(
          `INSERT INTO llm_call_log (time,caller,model,system_prompt,user_prompt,prompt_tokens,comp_tokens,total_tokens,cost_yuan,duration_ms,success,error)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        const tx = sqlite.transaction((items: Partial<LLMCallLog>[]) => {
          for (const it of items) {
            stmt.run(
              String(it.time ?? ""), String(it.caller ?? ""), String(it.model ?? ""),
              String(it.system_prompt ?? ""), String(it.user_prompt ?? ""),
              Number(it.prompt_tokens ?? 0), Number(it.comp_tokens ?? 0), Number(it.total_tokens ?? 0),
              Number(it.cost_yuan ?? 0), Number(it.duration_ms ?? 0), it.success ? 1 : 0, String(it.error ?? "")
            )
          }
        })
        tx(arr as Partial<LLMCallLog>[])
        console.log(`[llm] 已从 llm_call_logs.json 迁移 ${arr.length} 条调用日志到 SQLite`)
      }
      renameSync(logsFile, logsFile + ".imported-bak")
      _logCount = (sqlite.prepare("SELECT COUNT(*) AS n FROM llm_call_log").get() as { n: number }).n
    }
  } catch (e) {
    console.warn(`[llm] 历史 JSON 迁移失败(不阻塞启动): ${(e as Error).message}`)
  }
})()

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

/** 调用 DeepSeek OpenAI 兼容 API（带超时），返回 {content, finish_reason, prompt_tokens, comp_tokens} */
async function openaiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  chatPath = "/v1/chat/completions",
  extraBody?: Record<string, unknown>
): Promise<{ content: string; finish_reason: string; prompt_tokens: number; comp_tokens: number }> {
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

/**
 * 通用聊天调用：免费 Ark doubao 优先（跳过预算守卫，费用 0），失败回退付费 DeepSeek（预算守卫 + 计费）。
 * 超预算抛 BudgetExceededError（触发全局 429）。
 */
export interface ChatOptions {
  /**
   * true = 只走免费 Ark 一条链路：失败立即返回 ""，不叠加付费 DeepSeek / GLM 兜底。
   * 适用对延迟敏感、可接受降级（失败走前端降级提示）的轻内容场景（如儿歌/字谜）。
   * 默认 false（保持原行为：Ark → DeepSeek → GLM 逐级兜底，对齐 server_cf）。
   */
  arkOnly?: boolean
}

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

  // ── 免费优先：火山 Ark 可用则走免费链路（跳过预算守卫，cost=0） ──
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
        finishLog(log, start)
        throw new Error("Ark 免费模型返回空内容")
      }
      log.success = true
      log.cost_yuan = 0
      finishLog(log, start)
      return content
    } catch (e) {
      log.error = String((e as Error).message ?? e)
      finishLog(log, start)
      if (options.arkOnly) {
        console.warn(`[llm] Ark 免费调用失败(${caller}): ${log.error}（arkOnly，不再回退）`)
        return ""
      }
      console.warn(`[llm] Ark 免费调用失败(${caller}): ${log.error}，回退 DeepSeek`)
    }
  } else if (options.arkOnly) {
    const log: LLMCallLog = { ...baseLog, error: "未配置 ARK_API_KEY（arkOnly 模式）" }
    finishLog(log, start)
    return ""
  }

  // ── 付费链路：DeepSeek（预算守卫 + 计费） ──
  const log: LLMCallLog = { ...baseLog, model: cfg.deepseek.model }

  // 三段守卫（输入长度/日累计/单次预估），超限抛 BudgetExceededError
  try {
    checkBudget(systemPrompt.length + userPrompt.length, maxTokens, getDayCost().total_cost, cfg.deepseek)
  } catch (e) {
    log.error = String((e as Error).message ?? e)
    finishLog(log, start)
    // 预算超限：明确拒绝服务（429），不回退到无日上限的付费 GLM，避免真金白银损失
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
        0.7
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
      finishLog(log, start)
      // 空内容（思考模型吞 token 等）同样走 GLM 兜底，不让对话拿空回复
      const glm = await tryGlmFallback(systemPrompt, userPrompt, maxTokens, caller, "DeepSeek 空内容")
      if (glm !== null) return glm
      return ""
    }
    log.success = true
    log.error = ""
    finishLog(log, start)
    recordCost(log.cost_yuan)
    return content
  } catch (e) {
    log.error = String((e as Error).message ?? e)
    finishLog(log, start)
    const glm = await tryGlmFallback(systemPrompt, userPrompt, maxTokens, caller, log.error)
    if (glm !== null) return glm
    throw e
  }
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
    await finishLog(log, start)
    console.warn(`[llm] GLM 兜底失败（caller=${caller}）: ${log.error}`)
    return null
  }
}

function finishLog(log: LLMCallLog, start: number): void {
  log.duration_ms = Date.now() - start
  appendLog(log)
}
