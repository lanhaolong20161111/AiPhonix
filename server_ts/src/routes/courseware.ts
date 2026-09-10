/** Courseware 路由 — /api/v1/courseware（课件库：语/数/英课件图片）
 * 与 uploads 图片同目录存储（DATA_DIR/uploads），多模态 /ai-chat/ask 可直接消费；
 * 语义对齐 server_cf 同名路由。 */
import { Hono } from "hono"
import { randomUUID } from "node:crypto"
import { writeFile, mkdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { and, desc, eq } from "drizzle-orm"
import { db } from "../db/index.js"
import { courseware } from "../db/schema.js"
import { DATA_DIR } from "../env.js"
import { resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()
const UPLOAD_DIR = join(DATA_DIR, "uploads")
const MAX_FILE_MB = 20
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]
const MODULES = ["chinese", "math", "english"]

function validateModule(m: string): string {
  return MODULES.includes(m) ? m : ""
}

// GET /api/v1/courseware?module=chinese|math|english&limit=&offset=
router.get("/", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const module = validateModule(String(c.req.query("module") ?? "").trim())
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 100), 1), 300)
  const offset = Math.max(Number(c.req.query("offset") || 0), 0)
  const conditions = []
  if (module) conditions.push(eq(courseware.module, module))
  const rows = db
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

  const data = Buffer.from(await (file as File).arrayBuffer())
  if (data.length > MAX_FILE_MB * 1024 * 1024) {
    return c.json({ detail: `图片超过 ${MAX_FILE_MB}MB 限制` }, 413)
  }
  const title = String(form.get("title") ?? "").trim().slice(0, 256)
  const origName = (file as File).name || ""
  const ext = (origName.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? "").toLowerCase()
  const extWithDot = ext ? `.${ext}` : ".jpg"
  const finalExt = ALLOWED_EXT.includes(extWithDot) ? extWithDot : ".jpg"
  const fileName = `${randomUUID().toString().replace(/-/g, "")}${finalExt}`

  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(join(UPLOAD_DIR, fileName), data)

  const now = new Date().toISOString()
  const rec = db
    .insert(courseware)
    .values({
      module,
      fileName,
      title,
      createdAt: now,
      createdBy: user?.id ?? null,
    })
    .returning({ id: courseware.id })
    .get()

  return c.json({
    id: rec.id,
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
  const row = db.select().from(courseware).where(eq(courseware.id, id)).get()
  if (!row) return c.json({ detail: "课件不存在" }, 404)
  db.delete(courseware).where(eq(courseware.id, id)).run()
  const path = join(UPLOAD_DIR, row.fileName)
  if (existsSync(path)) {
    try {
      await unlink(path)
    } catch {
      /* 文件删除失败不阻塞 */
    }
  }
  return c.json({ status: "ok" })
})

// GET /api/v1/courseware/file/{file_name}
// 不鉴权（与 char-images/file 同策略）：前端 <img src> 带不了 Authorization 头，
// 鉴权会导致缩略图 401 裂图；课件图与字卡图同为教学内容，公开只读无敏感信息。
router.get("/file/:fileName", async (c) => {
  const fileName = c.req.param("fileName").split(/[\\/]/).pop() || ""
  if (!fileName) return c.json({ detail: "文件不存在" }, 404)
  const path = join(UPLOAD_DIR, fileName)
  if (!existsSync(path)) return c.json({ detail: "文件不存在" }, 404)
  const data = readFileSync(path)
  return new Response(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } })
})

export default router
