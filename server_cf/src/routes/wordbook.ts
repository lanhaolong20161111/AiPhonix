/** WordBook 路由 — /api/v1/wordbook（生词本：间隔重复 SRS）
 * - add：长按字/词加入（重复添加 times+1）
 * - list：全部生词（更新时间倒序）
 * - review：到期复习队列（next_review <= 今天，按 next_review 升序）
 * - rate：复习打卡（认识 → box+1 间隔拉长；不认识 → box 重置 1 明天再练）
 */
import { Hono } from "hono"
import { and, desc, eq, lte, sql } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { wordbookItem } from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()

/** SRS 间隔（天）：box 1-6 */
const BOX_INTERVALS = [1, 2, 4, 7, 15, 30]

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function addDays(days: number): string {
  const d = new Date(Date.now() + days * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** drizzle 行（驼峰）→ API snake_case */
function mapRow(r: typeof wordbookItem.$inferSelect) {
  return {
    id: r.id,
    user_id: r.userId,
    text: r.text,
    pinyin: r.pinyin,
    source: r.source,
    times: r.times,
    correct: r.correct,
    box: r.box,
    next_review: r.nextReview,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

async function requireUser(c: { req: { header: (n: string) => string | undefined } }) {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  return user ?? null
}

// POST /api/v1/wordbook/add  { text, pinyin?, source? }
router.post("/add", async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ detail: "未登录" }, 401)
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim().slice(0, 32)
  if (!text) return c.json({ detail: "缺少 text" }, 400)
  const pinyin = String(body?.pinyin ?? "").trim().slice(0, 64)
  const source = String(body?.source ?? "chat").trim().slice(0, 32) || "chat"
  const now = new Date().toISOString()

  await getDb()
    .insert(wordbookItem)
    .values({ userId: user.id, text, pinyin, source, times: 1, box: 1, nextReview: today(), createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [wordbookItem.userId, wordbookItem.text],
      set: {
        times: sql`${wordbookItem.times} + 1`,
        pinyin: sql`CASE WHEN ${pinyin} != '' THEN ${pinyin} ELSE ${wordbookItem.pinyin} END`,
        updatedAt: now,
      },
    })
    .run()
  return c.json({ status: "ok" })
})

// POST /api/v1/wordbook/add-many  { texts: string[], source? } — 批量加入（整块收词）
router.post("/add-many", async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ detail: "未登录" }, 401)
  const body = await c.req.json().catch(() => null)
  const rawTexts = Array.isArray(body?.texts) ? body.texts : []
  // 去重 + 截断 + 过滤空
  const texts: string[] = []
  const seen = new Set<string>()
  for (const t of rawTexts) {
    const s = (typeof t === "string" ? t : String(t ?? "")).trim().slice(0, 32)
    if (s && !seen.has(s)) {
      seen.add(s)
      texts.push(s)
    }
  }
  if (!texts.length) return c.json({ detail: "缺少 texts" }, 400)
  const source = String(body?.source ?? "recog_batch").trim().slice(0, 32) || "recog_batch"
  const now = new Date().toISOString()
  const todayStr = today()
  const db = getDb()
  for (const text of texts) {
    await db
      .insert(wordbookItem)
      .values({ userId: user.id, text, pinyin: "", source, times: 1, box: 1, nextReview: todayStr, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [wordbookItem.userId, wordbookItem.text],
        set: { times: sql`${wordbookItem.times} + 1`, updatedAt: now },
      })
      .run()
  }
  return c.json({ status: "ok", added: texts.length })
})

// GET /api/v1/wordbook/list
router.get("/list", async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ detail: "未登录" }, 401)
  const rows = await getDb()
    .select()
    .from(wordbookItem)
    .where(eq(wordbookItem.userId, user.id))
    .orderBy(desc(wordbookItem.updatedAt))
    .all()
  return c.json({ total: rows.length, items: rows.map(mapRow) })
})

// GET /api/v1/wordbook/review — 到期队列
router.get("/review", async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ detail: "未登录" }, 401)
  const t = today()
  const rows = await getDb()
    .select()
    .from(wordbookItem)
    .where(and(eq(wordbookItem.userId, user.id), lte(wordbookItem.nextReview, t)))
    .orderBy(wordbookItem.nextReview)
    .all()
  return c.json({ total: rows.length, items: rows.map(mapRow) })
})

// POST /api/v1/wordbook/rate  { id, correct } — 复习打卡
router.post("/rate", async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ detail: "未登录" }, 401)
  const body = await c.req.json().catch(() => null)
  const id = Number(body?.id ?? 0)
  const correct = Boolean(body?.correct)
  if (!id) return c.json({ detail: "缺少 id" }, 400)

  const row = await getDb()
    .select()
    .from(wordbookItem)
    .where(and(eq(wordbookItem.id, id), eq(wordbookItem.userId, user.id)))
    .get()
  if (!row) return c.json({ detail: "条目不存在" }, 404)

  const nextBox = correct ? Math.min(row.box + 1, BOX_INTERVALS.length) : 1
  const interval = BOX_INTERVALS[nextBox - 1]
  await getDb()
    .update(wordbookItem)
    .set({
      box: nextBox,
      correct: correct ? row.correct + 1 : row.correct,
      times: row.times + 1,
      nextReview: addDays(correct ? interval : 1),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(wordbookItem.id, id), eq(wordbookItem.userId, user.id)))
    .run()
  return c.json({ status: "ok", box: nextBox, next_review: addDays(correct ? interval : 1) })
})

// DELETE /api/v1/wordbook/:id
router.delete("/:id", async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ detail: "未登录" }, 401)
  const id = Number(c.req.param("id"))
  if (!id) return c.json({ detail: "缺少 id" }, 400)
  await getDb().delete(wordbookItem).where(and(eq(wordbookItem.id, id), eq(wordbookItem.userId, user.id))).run()
  return c.json({ status: "ok" })
})

export default router
