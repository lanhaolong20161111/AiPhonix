/** Courseware 路由 — /api/v1/courseware（课件库：语/数/英课件图片）
 * Cloudflare 版：文件 → R2 data/uploads/（与 uploads 同目录，多模态直接可读）；
 * 语义对齐 server_ts 同名路由。 */
import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { courseware } from "../db/schema.js"
import { exists, readBlob, removeBlob, writeBlob } from "../lib/storage.js"
import { resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()
const UPLOAD_DIR = "data/uploads"
const MAX_FILE_MB = 20
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]
const MODULES = ["chinese", "math", "english"]

function validateModule(m: string): string {
  return MODULES.includes(m) ? m : ""
}

// GET /api/v1/courseware?module=chinese|math|english&limit=&offset=
router.get("/", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const module = validateModule(String(c.req.query("module") ?? "").trim())
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 100), 1), 300)
  const offset = Math.max(Number(c.req.query("offset") || 0), 0)
  const conditions = []
  if (module) conditions.push(eq(courseware.module, module))
  const rows = await getDb()
    .select()
    .from(courseware)
    .where(and(...conditions))
    .orderBy(desc(courseware.createdAt), desc(courseware.id))
    .limit(limit)
    .offset(offset)
    .all()
  const items = rows.map((r) => ({
    id: r.id,
    module: r.module,
    file_name: r.fileName,
    url: `/api/v1/courseware/file/${r.fileName}`,
    title: r.title,
    created_at: r.createdAt ? new Date(String(r.createdAt)).toISOString() : null,
  }))
  return c.json({ total: items.length, items })
})

// POST /api/v1/courseware（multipart: file + module + title）
router.post("/", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400)

  const module = validateModule(String(form.get("module") ?? "").trim())
  if (!module) return c.json({ detail: "科目必须为 chinese/math/english" }, 422)

  const data = new Uint8Array(await (file as File).arrayBuffer())
  if (data.length > MAX_FILE_MB * 1024 * 1024) {
    return c.json({ detail: `图片超过 ${MAX_FILE_MB}MB 限制` }, 413)
  }
  const title = String(form.get("title") ?? "").trim().slice(0, 256)
  const origName = (file as File).name || ""
  const ext = (origName.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? "").toLowerCase()
  const extWithDot = ext ? `.${ext}` : ".jpg"
  const finalExt = ALLOWED_EXT.includes(extWithDot) ? extWithDot : ".jpg"
  const fileName = `${crypto.randomUUID().replace(/-/g, "")}${finalExt}`

  const key = `${UPLOAD_DIR}/${fileName}`
  await writeBlob(key, data, "image/jpeg")

  const now = new Date().toISOString()
  const rec = await getDb()
    .insert(courseware)
    .values({
      module,
      fileName,
      title,
      createdAt: now,
      createdBy: user?.id ?? null,
    })
    .run()
  const recId = Number((rec.meta as { last_row_id?: number | bigint }).last_row_id)

  return c.json({
    id: recId,
    module,
    file_name: fileName,
    url: `/api/v1/courseware/file/${fileName}`,
    title,
    created_at: now,
  })
})

// DELETE /api/v1/courseware/:id（删记录并尝试删除文件）
router.delete("/:id", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const id = Number(c.req.param("id") ?? 0)
  if (!Number.isFinite(id) || id <= 0) return c.json({ detail: "非法 id" }, 400)
  const row = await getDb().select().from(courseware).where(eq(courseware.id, id)).get()
  if (!row) return c.json({ detail: "课件不存在" }, 404)
  await getDb().delete(courseware).where(eq(courseware.id, id)).run()
  if (row.fileName) {
    await removeBlob(`${UPLOAD_DIR}/${row.fileName}`).catch(() => {})
  }
  return c.json({ status: "ok" })
})

// GET /api/v1/courseware/file/{file_name}
// 不鉴权（与 char-images/file 同策略）：前端 <img src> 带不了 Authorization 头，
// 鉴权会导致缩略图 401 裂图；课件图与字卡图同为教学内容，公开只读无敏感信息。
router.get("/file/:fileName", async (c) => {
  const fileName = c.req.param("fileName").split(/[\\/]/).pop() || ""
  if (!fileName) return c.json({ detail: "文件不存在" }, 404)
  const key = `${UPLOAD_DIR}/${fileName}`
  if (!(await exists(key))) return c.json({ detail: "文件不存在" }, 404)
  const data = await readBlob(key)
  if (!data) return c.json({ detail: "文件不存在" }, 404)
  return new Response(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } })
})

export default router
