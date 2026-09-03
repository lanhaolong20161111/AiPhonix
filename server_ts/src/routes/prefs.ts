/** 用户偏好 — /api/v1/prefs（需登录，按账户隔离、跨设备同步）
 * 对齐 server_cf/src/routes/prefs.ts（D1 版）。
 * 表由 db/index.ts 的 sqlite.exec 幂等块创建（与 visit_counts 同机制）。
 */
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../db/index.js"
import { userPrefs } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"

const router = new Hono()

function safeParse(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {}
  try {
    const v = JSON.parse(s)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// GET /api/v1/prefs → 当前用户的偏好整包（无则返回 {}）
router.get("/prefs", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const row = db.select().from(userPrefs).where(eq(userPrefs.userId, user!.id)).get()
  return c.json({ prefs: row?.prefs ? safeParse(row.prefs) : {} })
})

// PUT /api/v1/prefs  body { prefs } → 与已存偏好合并后保存，返回合并结果
router.put("/prefs", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => ({}))
  const incoming =
    body?.prefs && typeof body.prefs === "object" ? (body.prefs as Record<string, unknown>) : {}
  const now = new Date().toISOString()

  const existing = db.select().from(userPrefs).where(eq(userPrefs.userId, user!.id)).get()
  const merged = existing?.prefs ? { ...safeParse(existing.prefs), ...incoming } : incoming
  const saved = JSON.stringify(merged)

  if (existing) {
    db.update(userPrefs).set({ prefs: saved, updatedAt: now }).where(eq(userPrefs.userId, user!.id)).run()
  } else {
    db.insert(userPrefs).values({ userId: user!.id, prefs: saved, updatedAt: now }).run()
  }
  return c.json({ prefs: merged })
})

export default router
