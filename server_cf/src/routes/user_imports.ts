/** UserImports 路由 — /api/v1/user-imports（对齐 Python routes/user_imports.py）
 * Cloudflare 版：db → await getDb()（D1），语义对齐 server_ts。
 */
import { Hono } from "hono"
import { and, desc, eq, ne } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { userImports } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"

const router = new Hono()

const nowIso = () => new Date().toISOString()

const toDict = (r: {
  id: number
  kind: string
  text: string
  pinyin: string
  meaning: string
  tags: string
  payload: string
  status: string
  createdAt: string | Date | number | null
}) => ({
  id: r.id,
  kind: r.kind,
  text: r.text,
  pinyin: r.pinyin,
  meaning: r.meaning,
  tags: r.tags ? JSON.parse(r.tags) : [],
  payload: r.payload,
  status: r.status,
  created_at: r.createdAt ? new Date(String(r.createdAt)).toISOString() : "",
})

// POST /api/v1/user-imports/batch
router.post("/batch", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const items = Array.isArray(body?.items) ? body.items : []
  if (items.length === 0) return c.json({ status: "ok", added: 0, updated: 0, total: 0 })

  let added = 0
  let updated = 0
  for (const item of items) {
    const text = String(item?.text ?? "").trim()
    if (!text) continue
    const kind = String(item?.kind ?? "word")
    const existing = await getDb()
      .select()
      .from(userImports)
      .where(and(eq(userImports.userId, user!.id), eq(userImports.kind, kind), eq(userImports.text, text)))
      .get()
    const tagsJson = Array.isArray(item.tags) && item.tags.length ? JSON.stringify(item.tags) : ""

    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: nowIso() }
      if (item?.pinyin) updates.pinyin = String(item.pinyin)
      if (item?.meaning) updates.meaning = String(item.meaning)
      if (tagsJson) updates.tags = tagsJson
      if (item?.payload) updates.payload = String(item.payload)
      updates.status = item?.status || "active"
      await getDb().update(userImports).set(updates).where(eq(userImports.id, existing.id)).run()
      updated++
    } else {
      const now = nowIso()
      await getDb().insert(userImports)
        .values({
          userId: user!.id,
          kind,
          text,
          pinyin: String(item?.pinyin ?? ""),
          meaning: String(item?.meaning ?? ""),
          tags: tagsJson,
          payload: String(item?.payload ?? ""),
          status: String(item?.status ?? "active"),
          createdAt: now,
          updatedAt: now,
        })
        .run()
      added++
    }
  }

  // 回读 id 映射
  const allRows = await getDb().select().from(userImports).where(eq(userImports.userId, user!.id)).all()
  const idByKey = new Map<string, string>()
  for (const r of allRows) idByKey.set(`${r.kind}\u0000${r.text}`, String(r.id))

  const totalRows = await getDb()
    .select({ id: userImports.id })
    .from(userImports)
    .where(and(eq(userImports.userId, user!.id), ne(userImports.status, "deleted")))
    .all()

  const respItems = items
    .filter((it: { text?: string }) => (it?.text ?? "").trim())
    .map((it: { kind?: string; text?: string }) => {
      const text = String(it?.text ?? "").trim()
      return { id: idByKey.get(`${it?.kind ?? ""}\u0000${text}`) ?? "", kind: it?.kind ?? "", text }
    })

  return c.json({ status: "ok", added, updated, total: totalRows.length, items: respItems })
})

// GET /api/v1/user-imports
router.get("/", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const kind = c.req.query("kind")
  const conditions = [eq(userImports.userId, user!.id), ne(userImports.status, "deleted")]
  if (kind) conditions.push(eq(userImports.kind, kind))
  const rows = await getDb()
    .select()
    .from(userImports)
    .where(and(...conditions))
    .orderBy(desc(userImports.createdAt))
    .all()
  return c.json({ status: "ok", items: rows.map(toDict) })
})

// DELETE /api/v1/user-imports/{id}
router.delete("/:id", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const id = Number(c.req.param("id"))
  if (Number.isNaN(id)) return c.json({ detail: "记录不存在" }, 404)
  const row = await getDb().select().from(userImports).where(and(eq(userImports.id, id), eq(userImports.userId, user!.id))).get()
  if (!row) return c.json({ detail: "记录不存在" }, 404)
  await getDb().delete(userImports).where(eq(userImports.id, id)).run()
  return c.json({ status: "deleted" })
})

export default router
