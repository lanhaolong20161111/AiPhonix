/** Training 路由 — /api/v1/training/plan|progress（需认证，按用户隔离） */
import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { db } from "../db/index.js"
import { trainingPlans, practiceSessions } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"

const router = new Hono()
const nowIso = () => new Date().toISOString()

// GET /api/v1/training/plan
router.get("/plan", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const row = db.select().from(trainingPlans).where(eq(trainingPlans.userId, user!.id)).get()
  if (!row) return c.json({ plan: null })
  return c.json({ plan: JSON.parse(row.itemsJson) })
})

// PUT /api/v1/training/plan
router.put("/plan", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ detail: "请求体为空" }, 400)
  const now = nowIso()
  const itemsJson = JSON.stringify(body)
  const existing = db.select().from(trainingPlans).where(eq(trainingPlans.userId, user!.id)).get()
  if (existing) {
    db.update(trainingPlans)
      .set({ itemsJson, updatedAt: now })
      .where(eq(trainingPlans.userId, user!.id))
      .run()
  } else {
    db.insert(trainingPlans)
      .values({ userId: user!.id, title: String(body?.title ?? "今日任务"), itemsJson, createdAt: now, updatedAt: now })
      .run()
  }
  return c.json({ status: "ok", plan: body })
})

// POST /api/v1/training/progress（幂等 upsert by user+plan_item_id+date）
router.post("/progress", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  if (!body?.plan_item_id) return c.json({ detail: "缺少 plan_item_id" }, 400)
  const date = String(body?.date ?? new Date().toISOString().slice(0, 10))
  const now = nowIso()
  const existing = db
    .select()
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, user!.id),
        eq(practiceSessions.planItemId, String(body.plan_item_id)),
        eq(practiceSessions.date, date)
      )
    )
    .get()
  const values = {
    feature: String(body?.feature ?? ""),
    status: "done",
    count: Number(body?.count ?? 0),
    correct: body?.correct !== undefined && body?.correct !== null ? Number(body.correct) : null,
    score: body?.score !== undefined && body?.score !== null ? Number(body.score) : null,
    durationMs: Number(body?.duration_ms ?? 0),
    metricsJson: JSON.stringify(body?.metrics ?? {}),
    updatedAt: now,
  }
  if (existing) {
    db.update(practiceSessions).set(values).where(eq(practiceSessions.id, existing.id)).run()
  } else {
    db.insert(practiceSessions)
      .values({ userId: user!.id, planItemId: String(body.plan_item_id), date, ...values, createdAt: now })
      .run()
  }
  return c.json({ status: "ok", date })
})

// GET /api/v1/training/progress
router.get("/progress", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const date = c.req.query("date")
  const start = c.req.query("start")
  const end = c.req.query("end")
  const conditions = [eq(practiceSessions.userId, user!.id)]
  if (date) conditions.push(eq(practiceSessions.date, date))
  if (start) conditions.push(eq(practiceSessions.date, start))
  if (end) conditions.push(eq(practiceSessions.date, end))
  const rows = db.select().from(practiceSessions).where(and(...conditions)).all()
  const sessions = rows.map((r) => ({
    plan_item_id: r.planItemId,
    feature: r.feature,
    date: r.date,
    status: r.status,
    count: r.count,
    correct: r.correct,
    score: r.score,
    duration_ms: r.durationMs,
    metrics: r.metricsJson ? JSON.parse(r.metricsJson) : {},
  }))
  return c.json({ total: sessions.length, sessions })
})

export default router
