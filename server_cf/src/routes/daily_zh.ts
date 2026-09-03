/** 每日一练·语文配置 — /api/v1/daily-zh（按账号+日期，跨设备同步）
 * GET（可选鉴权）：返回今日 config；今日未设则返回最近一次 last 供前端预填草稿。
 * PUT（requireAuth）：upsert 当前账号+日期（body.date 缺省为东八区今天）。
 */
import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { dailyZhConfig } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"

const router = new Hono()

/** 东八区日期 YYYY-MM-DD（避免 UTC 跨天导致的 off-by-one） */
function cstDate(d = new Date()): string {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  const cst = new Date(utc + 8 * 3600000)
  return cst.toISOString().slice(0, 10)
}

interface DailyZhRow {
  chars: string
  words: string
  sentences: string
  essayTopic: string
  updatedAt: string
}

function toDto(r: {
  chars: string
  words: string
  sentences: string
  essayTopic: string
  updatedAt: string
}): DailyZhRow {
  return { chars: r.chars, words: r.words, sentences: r.sentences, essayTopic: r.essayTopic, updatedAt: r.updatedAt }
}

// GET /api/v1/daily-zh?date=YYYY-MM-DD
router.get("/", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"), true)
  if (!user) return c.json({ config: null, last: null, date: cstDate() })
  const date = c.req.query("date") || cstDate()
  const row = await getDb().select().from(dailyZhConfig)
    .where(and(eq(dailyZhConfig.userId, user.id), eq(dailyZhConfig.date, date))).get()
  if (row) return c.json({ config: toDto(row), last: null, date })
  // 当天没设 → 返回最近一次（供预填草稿，不自动落今日库）
  const last = await getDb().select().from(dailyZhConfig)
    .where(eq(dailyZhConfig.userId, user.id)).orderBy(desc(dailyZhConfig.date)).limit(1).get()
  return c.json({ config: null, last: last ? toDto(last) : null, date })
})

// PUT /api/v1/daily-zh
router.put("/", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== "object") return c.json({ detail: "请求体为空" }, 400)
  const date = String(body?.date || cstDate()).slice(0, 10)
  const values = {
    chars: String(body?.chars ?? ""),
    words: String(body?.words ?? ""),
    sentences: String(body?.sentences ?? ""),
    essayTopic: String(body?.essayTopic ?? ""),
    updatedAt: new Date().toISOString(),
  }
  const existing = await getDb().select().from(dailyZhConfig)
    .where(and(eq(dailyZhConfig.userId, user!.id), eq(dailyZhConfig.date, date))).get()
  if (existing) {
    await getDb().update(dailyZhConfig).set(values).where(eq(dailyZhConfig.id, existing.id)).run()
  } else {
    await getDb().insert(dailyZhConfig).values({ userId: user!.id, date, ...values }).run()
  }
  return c.json({ status: "ok", date, config: values })
})

export default router
