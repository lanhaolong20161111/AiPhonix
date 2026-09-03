/** 首页入口点击频次统计 — /api/v1/visits（需登录，按用户隔离）
 * 对齐 server_cf/src/routes/visits.ts（D1 版）。
 */
import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { db } from "../db/index.js"
import { visitCounts } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"

const router = new Hono()

// GET /api/v1/visits → 当前用户各入口点击次数
router.get("/visits", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const rows = db.select().from(visitCounts).where(eq(visitCounts.userId, user!.id)).all()
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.route] = r.count
  return c.json({ counts })
})

// POST /api/v1/visits  body { route } → 该入口计数 +1
router.post("/visits", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const route = String(body?.route ?? "").trim()
  if (!route) return c.json({ detail: "缺少 route" }, 400)

  const now = new Date().toISOString()
  const existing = db
    .select()
    .from(visitCounts)
    .where(and(eq(visitCounts.userId, user!.id), eq(visitCounts.route, route)))
    .get()

  let count: number
  if (existing) {
    count = existing.count + 1
    db.update(visitCounts).set({ count, updatedAt: now }).where(eq(visitCounts.id, existing.id)).run()
  } else {
    count = 1
    db.insert(visitCounts).values({ userId: user!.id, route, count, updatedAt: now }).run()
  }
  return c.json({ route, count })
})

export default router
