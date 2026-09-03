/** 首页入口点击频次统计 — /api/v1/visits（需登录，按用户隔离）
 * Cloudflare 版：db → await getDb()（D1），表运行时幂等自建。
 */
import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { getDb, sqlRun } from "../db/index.js"
import { visitCounts } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"

const router = new Hono()

// D1 表运行时幂等创建（避免依赖迁移流水线）
let tableReady: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = sqlRun(
      `CREATE TABLE IF NOT EXISTS visit_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        route TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at NUMERIC NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )`,
    )
      .then(() => undefined)
      .catch((e) => {
        tableReady = null
        throw e
      })
  }
  return tableReady
}

// GET /api/v1/visits
router.get("/visits", requireAuth(), async (c) => {
  await ensureTable()
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const rows = await getDb().select().from(visitCounts).where(eq(visitCounts.userId, user!.id)).all()
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.route] = r.count
  return c.json({ counts })
})

// POST /api/v1/visits
router.post("/visits", requireAuth(), async (c) => {
  await ensureTable()
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const route = String(body?.route ?? "").trim()
  if (!route) return c.json({ detail: "缺少 route" }, 400)

  const now = new Date().toISOString()
  const existing = await getDb()
    .select()
    .from(visitCounts)
    .where(and(eq(visitCounts.userId, user!.id), eq(visitCounts.route, route)))
    .get()

  let count: number
  if (existing) {
    count = existing.count + 1
    await getDb().update(visitCounts).set({ count, updatedAt: now }).where(eq(visitCounts.id, existing.id)).run()
  } else {
    count = 1
    await getDb().insert(visitCounts).values({ userId: user!.id, route, count, updatedAt: now }).run()
  }
  return c.json({ route, count })
})

export default router
