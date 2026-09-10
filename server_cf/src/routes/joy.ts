/** 记忆快乐本 — /api/v1/joy
 * 认字/练词的今日字词 → LLM 生成一段生动有趣的文段（便于高效记忆），
 * 按 账号+日期 持久化到 D1（同一天重复生成 = upsert 覆盖，不留历史垃圾）。
 *
 * 标注方案：文段存纯文本（title + text），前端按 chars/words 原文匹配高亮，
 * 不依赖 LLM 输出标记（更可靠）。chars/words 存逗号/顿号分隔原文。
 *
 * LLM 走 getArk().chat + model_override multimodalModel（=doubao-seed-2-1-turbo-260628，
 * disable_thinking）——与 daily_en/fillPolyphones 同款已验证链路；失败返回 502，前端可降级提示。
 */
import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { memoryJoyEntry } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"
import { getArk, multimodalModel } from "../lib/ark.js"
import { ruleCheckSentence, generateWithGuard } from "../lib/sentenceGuard.js"

const router = new Hono()

/** 东八区日期 YYYY-MM-DD（避免 UTC 跨天导致的 off-by-one） */
function cstDate(d = new Date()): string {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  const cst = new Date(utc + 8 * 3600000)
  return cst.toISOString().slice(0, 10)
}

interface JoyRow {
  id: number
  date: string
  scope: string
  chars: string
  words: string
  title: string
  text: string
  createdAt: string
}

function toDto(r: {
  id: number
  date: string
  scope: string
  chars: string
  words: string
  title: string
  text: string
  createdAt: string | Date
}): JoyRow {
  return {
    id: r.id,
    date: r.date,
    scope: r.scope ?? "all",
    chars: r.chars,
    words: r.words,
    title: r.title,
    text: r.text,
    createdAt: String(r.createdAt ?? ""),
  }
}

/** 逗号/顿号/空白拆分并去重（保持顺序） */
function splitTargets(s: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of String(s ?? "").split(/[,，、;；\s]+/)) {
    const x = t.trim()
    if (x && !seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}

function extractJson(raw: string): string {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const a = s.indexOf("{")
  const b = s.lastIndexOf("}")
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  return s
}

// GET /api/v1/joy/list — 该账号全部文段，按日期倒序（记忆快乐本首页）
router.get("/list", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  if (!user) return c.json({ detail: "需要登录" }, 401)
  const rows = await getDb().select().from(memoryJoyEntry)
    .where(eq(memoryJoyEntry.userId, user.id))
    .orderBy(desc(memoryJoyEntry.date), desc(memoryJoyEntry.id))
    .all()
  return c.json({ total: rows.length, entries: rows.map(toDto) })
})

// GET /api/v1/joy?date=YYYY-MM-DD — 取某天的文段（没有则 null）
router.get("/", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"), true)
  if (!user) return c.json({ entry: null })
  const date = c.req.query("date") || cstDate()
  // 同一天可能有多条（scope=all/char/word），取最新一条
  const row = await getDb().select().from(memoryJoyEntry)
    .where(and(eq(memoryJoyEntry.userId, user.id), eq(memoryJoyEntry.date, date)))
    .orderBy(desc(memoryJoyEntry.id)).limit(1).get()
  return c.json({ entry: row ? toDto(row) : null })
})

// POST /api/v1/joy/generate — body: { date?, chars, words, scope? }
// scope: 'all'=混合（默认，兼容旧客户端）| 'char'=认字页只传今日字 | 'word'=练词页只传今日词。
// 同 账号+日期+scope 已有 → 直接返回缓存；否则 LLM 生成并 upsert。
router.post("/generate", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  if (!user) return c.json({ detail: "需要登录" }, 401)
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== "object") return c.json({ detail: "请求体为空" }, 400)
  const date = String(body?.date || cstDate()).slice(0, 10)
  const scope = body?.scope === "char" || body?.scope === "word" ? String(body.scope) : "all"
  const chars = splitTargets(String(body?.chars ?? "")).join("、")
  const words = splitTargets(String(body?.words ?? "")).join("、")
  const targets = [...splitTargets(chars), ...splitTargets(words)].filter((t) => t.length > 0)
  if (targets.length === 0) return c.json({ detail: "缺少今日字/词" }, 400)

  // 已有缓存（同日期+同 scope）直接返回；除非客户端强制重新生成
  const existing = await getDb().select().from(memoryJoyEntry)
    .where(and(
      eq(memoryJoyEntry.userId, user.id),
      eq(memoryJoyEntry.date, date),
      eq(memoryJoyEntry.scope, scope),
    )).get()
  const force = body?.force === true || body?.force === "true"
  if (existing && !force) return c.json({ entry: toDto(existing), cached: true })

  // LLM 生成一段生动有趣的短故事/文段，自然融入全部字词；生成后走规则审核（全部字词必现 + 长度 + 无重复），
  // 不通过自动重试（最多 3 次尝试，重试带上次不通过原因），全不过不入库。
  const genPrompt = (feedback: string) =>
    "你是儿童语文老师。把下面这些汉字和词语编成一段生动有趣、朗朗上口的短文或小故事，方便小学生高效记忆。\n" +
    "要求：\n" +
    "1) 给出的每一个字、每一个词都必须自然出现至少一次，不要遗漏；\n" +
    "2) 语言活泼有画面感，适合 6-9 岁孩子，长度 80-160 字；\n" +
    "3) 语法通顺、语义合理，不要生硬编造或前后矛盾；\n" +
    "4) 只输出严格 JSON（不要解释、不要代码围栏）：{\"title\": \"3-8字的小标题\", \"text\": \"文段正文\"}。\n" +
    (feedback ? `5) 上次生成未通过审核，原因：${feedback}。请据此修正后重新生成。\n` : "") +
    `今日汉字：${chars || "（无）"}\n今日词语：${words || "（无）"}`

  const verify = async (out: { title: string; text: string }) => {
    // 规则审核（免费、快）：全部字词必现 + 长度合理 + 无重复（防乱编核心）。
    // 小故事是低风险趣味文段，规则 + 生成 prompt 已足够，不再单独调 LLM 审核语法/语义，
    // 省一次 LLM 往返，速度近乎减半（用户反馈「每日一练加载太慢」）。
    const rule = ruleCheckSentence(out.text, targets, { min: 20, max: 300, allTargets: true })
    if (!rule.ok) return { ok: false, reason: rule.reasons.join("；") }
    return { ok: true, reason: "" }
  }

  let title = ""
  let text = ""
  try {
    const out = await generateWithGuard(
      async (feedback) => {
        const raw = await getArk().chat({
          prompt: genPrompt(feedback),
          system_prompt: "你是一个只输出JSON的小学语文老师。",
          max_tokens: 1024,
          model_override: multimodalModel(),
          disable_thinking: true,
          timeout_ms: 40_000,
        })
        if (!raw) return { title: "", text: "" }
        try {
          const parsed = JSON.parse(extractJson(raw)) as { title?: unknown; text?: unknown }
          return { title: String(parsed?.title ?? "").trim(), text: String(parsed?.text ?? "").trim() }
        } catch {
          return { title: "", text: "" }
        }
      },
      verify,
    )
    title = out.title
    text = out.text
  } catch (e) {
    console.warn(`[joy] 生成未通过审核(${date}): ${(e as Error).message}`)
    return c.json({ detail: "生成内容未通过审核，请重试" }, 422)
  }
  if (!text) return c.json({ detail: "生成失败，请重试" }, 502)

  // upsert（同 日期+scope 覆盖）
  const values = { userId: user.id, date, scope, chars, words, title, text }
  if (existing) {
    await getDb().update(memoryJoyEntry).set(values).where(eq(memoryJoyEntry.id, existing.id)).run()
  } else {
    await getDb().insert(memoryJoyEntry).values(values).run()
  }
  const row = await getDb().select().from(memoryJoyEntry)
    .where(and(
      eq(memoryJoyEntry.userId, user.id),
      eq(memoryJoyEntry.date, date),
      eq(memoryJoyEntry.scope, scope),
    )).get()
  return c.json({ entry: row ? toDto(row) : null, cached: false })
})

// DELETE /api/v1/joy/:id — 删除某条文段（记忆快乐本长按/按钮删除）
router.delete("/:id", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  if (!user) return c.json({ detail: "需要登录" }, 401)
  const id = Number(c.req.param("id"))
  if (!Number.isFinite(id)) return c.json({ detail: "非法 id" }, 400)
  await getDb().delete(memoryJoyEntry).where(and(eq(memoryJoyEntry.id, id), eq(memoryJoyEntry.userId, user.id))).run()
  return c.json({ status: "ok" })
})

export default router
