/** 用户偏好 — /api/v1/prefs（需登录，按账户隔离、跨设备同步）
 * Cloudflare 版：db → await getDb()（D1），表运行时幂等自建。
 * 整包 JSON 存储 { voiceByModule, roleByModule, mnemonicVisible }，对齐 server_ts。
 */
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { getDb, sqlRun } from "../db/index.js"
import { userPrefs } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"

const router = new Hono()

// D1 表运行时幂等创建（避免依赖迁移流水线）
let tableReady: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = sqlRun(
      `CREATE TABLE IF NOT EXISTS user_prefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        prefs TEXT NOT NULL DEFAULT '{}',
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
  await ensureTable()
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const row = await getDb().select().from(userPrefs).where(eq(userPrefs.userId, user!.id)).get()
  return c.json({ prefs: row?.prefs ? safeParse(row.prefs) : {} })
})

// PUT /api/v1/prefs  body { prefs } → 与已存偏好合并后保存，返回合并结果
router.put("/prefs", requireAuth(), async (c) => {
  await ensureTable()
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => ({}))
  const incoming =
    body?.prefs && typeof body.prefs === "object" ? (body.prefs as Record<string, unknown>) : {}
  const now = new Date().toISOString()

  const existing = await getDb().select().from(userPrefs).where(eq(userPrefs.userId, user!.id)).get()
  const merged = existing?.prefs ? { ...safeParse(existing.prefs), ...incoming } : incoming
  const saved = JSON.stringify(merged)

  if (existing) {
    await getDb().update(userPrefs).set({ prefs: saved, updatedAt: now }).where(eq(userPrefs.userId, user!.id)).run()
  } else {
    await getDb().insert(userPrefs).values({ userId: user!.id, prefs: saved, updatedAt: now }).run()
  }
  return c.json({ prefs: merged })
})

export default router
