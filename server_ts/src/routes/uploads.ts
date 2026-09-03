/** Uploads 路由 — /api/v1/uploads（对齐 Python routes/uploads.py，无认证） */
import { Hono } from "hono"
import { randomUUID } from "node:crypto"
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { readFileSync, existsSync } from "node:fs"
import { desc, eq } from "drizzle-orm"
import { db } from "../db/index.js"
import { uploadRecords } from "../db/schema.js"
import { DATA_DIR } from "../env.js"
import { autoOrient } from "../lib/image.js"
import { ocrChain } from "../lib/ocr.js"

import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
const UPLOAD_DIR = join(DATA_DIR, "uploads")
const MAX_FILE_MB = 20
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]

const nowIso = () => new Date().toISOString()

// 后台 OCR 识别（腾讯云 → 百度 fallback 链）：不阻塞上传响应，完成后回写 upload_records.ocr_text
function backgroundOcr(recordId: number, path: string): void {
  ocrChain(path)
    .then((text) => {
      try {
        db.update(uploadRecords).set({ ocrText: text }).where(eq(uploadRecords.id, recordId)).run()
        console.info(`[uploads] OCR 完成 record=${recordId} len=${text.length}`)
      } catch (e) {
        console.warn(`[uploads] OCR 结果写库失败 record=${recordId}: ${(e as Error).message}`)
      }
    })
    .catch((e) => {
      console.warn(`[uploads] OCR 失败 record=${recordId}: ${(e as Error).message}`)
    })
}

// POST /api/v1/uploads/photo（multipart: file + note + origin + uploader）
router.post("/photo", requireAuth(), async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400)

  const data = Buffer.from(await (file as File).arrayBuffer())
  if (data.length > MAX_FILE_MB * 1024 * 1024) {
    return c.json({ detail: `图片超过 ${MAX_FILE_MB}MB 限制` }, 413)
  }
  const note = String(form.get("note") ?? "").slice(0, 500)
  const origin = String(form.get("origin") ?? "").slice(0, 256)
  const uploader = String(form.get("uploader") ?? "").slice(0, 64)

  const origName = (file as File).name || ""
  const ext = (origName.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? "").toLowerCase()
  const extWithDot = ext ? `.${ext}` : ".jpg"
  const finalExt = ALLOWED_EXT.includes(extWithDot) ? extWithDot : ".jpg"
  const fileName = `${randomUUID().toString().replace(/-/g, "")}${finalExt}`

  await mkdir(UPLOAD_DIR, { recursive: true })
  const path = join(UPLOAD_DIR, fileName)
  await writeFile(path, data)
  // EXIF 方向校正（sharp），返回校正后的路径
  const oriented = await autoOrient(path)

  const now = nowIso()
  const rec = db
    .insert(uploadRecords)
    .values({
      kind: "photo",
      fileName,
      content: "",
      note,
      ocrText: "",
      source: "web",
      uploader,
      origin,
      createdAt: now,
    })
    .returning({ id: uploadRecords.id })
    .get()

  // 后台 OCR 识别（不阻塞上传响应）
  backgroundOcr(rec.id, oriented)

  return c.json({
    id: rec.id,
    kind: "photo",
    file_name: fileName,
    url: `/api/v1/uploads/file/${fileName}`,
    note,
    origin,
    status: "ok",
  })
})

// POST /api/v1/uploads/text
router.post("/text", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本内容为空" }, 422)
  const now = nowIso()
  const rec = db
    .insert(uploadRecords)
    .values({
      kind: "text",
      fileName: "",
      content: String(body?.text ?? "").slice(0, 10000),
      ocrText: "",
      note: String(body?.note ?? "").slice(0, 500),
      source: "web",
      uploader: String(body?.uploader ?? "").slice(0, 64),
      origin: String(body?.origin ?? "").slice(0, 256),
      createdAt: now,
    })
    .returning({ id: uploadRecords.id })
    .get()
  return c.json({
    id: rec.id,
    kind: "text",
    content: String(body?.text ?? ""),
    note: String(body?.note ?? ""),
    origin: String(body?.origin ?? ""),
    status: "ok",
  })
})

// GET /api/v1/uploads（列出全部上传：要求登录）
router.get("/", requireAuth(), async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 50), 1), 200)
  const offset = Math.max(Number(c.req.query("offset") || 0), 0)
  const rows = db
    .select()
    .from(uploadRecords)
    .orderBy(desc(uploadRecords.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
  const items = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    file_name: r.fileName,
    url: r.fileName ? `/api/v1/uploads/file/${r.fileName}` : "",
    content: r.content,
    ocr_text: r.ocrText,
    note: r.note,
    source: r.source,
    uploader: r.uploader,
    origin: r.origin,
    created_at: r.createdAt ? new Date(String(r.createdAt)).toISOString() : null,
  }))
  return c.json({ total: items.length, items })
})

// GET /api/v1/uploads/file/{file_name}（读取任意上传图片：要求登录）
router.get("/file/:fileName", requireAuth(), async (c) => {
  const fileName = c.req.param("fileName").split(/[\\/]/).pop() || ""
  const path = join(UPLOAD_DIR, fileName)
  if (!existsSync(path)) return c.json({ detail: "文件不存在" }, 404)
  const data = readFileSync(path)
  return new Response(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } })
})

export default router
