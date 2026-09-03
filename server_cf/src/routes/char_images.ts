/** CharImages 路由 — /api/v1/char-images（索引/反馈走 D1，图片/音频走 R2）
 * Cloudflare 版：
 * - 2026-08-28 起 索引/反馈 由 R2 JSON 迁入 D1（migrations/0002）——UPSERT 原子化消写竞态、
 *   跨 isolate 读一致（不再有模块级"装载一次"缓存）。
 * - 图片/音频仍是 R2 对象（媒体不属 DB）。
 * ⚠️ pinyin-pro 在模块顶层 setTimeout（Workers 全局作用域禁止），必须动态 import。
 */
import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { charImageIndex, charImageFeedback } from "../db/schema.js"
import { dataPath } from "../lib/jsonfile.js"
import { exists, readBlob, writeBlob } from "../lib/storage.js"

import { requireAuth, resolveCurrentUser } from "../middleware/auth.js"

let pinyinMod: typeof import("pinyin-pro") | null = null
const loadPinyin = async (): Promise<typeof import("pinyin-pro")> => {
  pinyinMod ??= await import("pinyin-pro")
  return pinyinMod
}

const router = new Hono()
const IMAGE_DIR = dataPath("char_images")
const THUMB_DIR = dataPath("char_images_thumb")
const THUMB_1536_DIR = dataPath("char_images_1536")
const AUDIO_DIR = dataPath("char_audio")

const pinyinCache = new Map<string, string>()
const PINYIN_CACHE_MAX = 5000 // 防止无界增长撑爆 isolate 内存

const getPinyin = async (char: string): Promise<string> => {
  if (!char || !/[\u4e00-\u9fff]/.test(char)) return ""
  if (pinyinCache.has(char)) return pinyinCache.get(char)!
  try {
    const { pinyin } = await loadPinyin()
    const result = pinyin(char, { toneType: "symbol", type: "array" }).join(" ")
    if (pinyinCache.size >= PINYIN_CACHE_MAX) pinyinCache.clear()
    pinyinCache.set(char, result)
    return result
  } catch {
    return char
  }
}

/** 索引行 → API 原对象（extra 恢复未建模字段；pinyin 为空时置 undefined，由调用方补算；id 不外露） */
const mapIndexRow = (row: {
  id: number
  char: string
  grade: string
  semester: string
  type: string
  image: string
  pinyin: string
  extra: string
}): Record<string, unknown> => {
  let extra: Record<string, unknown> = {}
  try {
    extra = row.extra ? (JSON.parse(row.extra) as Record<string, unknown>) : {}
  } catch {
    /* 坏 extra 容错 */
  }
  const out: Record<string, unknown> = { ...extra }
  out.char = row.char
  out.image = row.image
  out.grade = row.grade
  out.semester = row.semester
  out.type = row.type
  out.pinyin = row.pinyin || undefined
  return out
}

/** 反馈行 → API 原对象（user_id=0 视为旧数据缺省，不输出） */
const mapFeedbackRow = (r: {
  userId: number
  char: string
  grade: string
  semester: string
  type: string
  learningStatus: string | null
  needsRegen: boolean
  timestamp: string
  extra: string
}): Record<string, unknown> => {
  let extra: Record<string, unknown> = {}
  try {
    extra = r.extra ? (JSON.parse(r.extra) as Record<string, unknown>) : {}
  } catch {
    /* 容错 */
  }
  const out: Record<string, unknown> = { ...extra }
  out.char = r.char
  if (r.grade) out.grade = r.grade
  if (r.semester) out.semester = r.semester
  if (r.type) out.type = r.type
  if (r.userId > 0) out.user_id = r.userId
  out.learning_status = r.learningStatus
  out.needs_regen = r.needsRegen
  out.timestamp = r.timestamp
  return out
}

// GET /api/v1/char-images
router.get("/", async (c) => {
  const grade = c.req.query("grade") ?? ""
  const semester = c.req.query("semester") ?? ""
  const type = c.req.query("type") ?? ""
  const q = c.req.query("q") ?? ""
  const limit = Number(c.req.query("limit") ?? 500)
  const conds = []
  if (grade) conds.push(eq(charImageIndex.grade, grade))
  if (semester) conds.push(eq(charImageIndex.semester, semester))
  if (type) conds.push(eq(charImageIndex.type, type))
  if (q) {
    const ql = q.toLowerCase()
    conds.push(
      sql`(lower(${charImageIndex.char}) LIKE ${`%${ql}%`} OR lower(${charImageIndex.image}) LIKE ${`%${ql}%`})`
    )
  }
  const db = getDb()
  // ORDER BY id = 原数组序（保 认/写 重字变体两条都在，且 slice(0, limit) 与旧行为一致）
  const rows = conds.length
    ? await db.select().from(charImageIndex).where(conds.length === 1 ? conds[0] : and(...conds)).orderBy(charImageIndex.id)
    : await db.select().from(charImageIndex).orderBy(charImageIndex.id)
  const result = rows.map((r) => mapIndexRow(r))
  const total = result.length
  const sliced = limit > 0 ? result.slice(0, limit) : result
  for (const item of sliced) {
    if (!item.pinyin) item.pinyin = await getPinyin(String(item.char ?? ""))
  }
  return c.json({ total, items: sliced })
})

// POST /api/v1/char-images/feedback（幂等合并 → D1 UPSERT 原子化，消读改写竞态）
router.post("/feedback", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ detail: "请求体为空" }, 400)
  const statusRaw: unknown = body?.learning_status
  const entry = {
    userId: user!.id,
    char: String(body?.char ?? ""),
    grade: String(body?.grade ?? ""),
    semester: String(body?.semester ?? ""),
    type: String(body?.type ?? ""),
    learningStatus: statusRaw == null ? null : String(statusRaw),
    needsRegen: Boolean(body?.needs_regen),
    timestamp: new Date().toISOString(),
  }
  await getDb()
    .insert(charImageFeedback)
    .values(entry)
    .onConflictDoUpdate({
      target: [
        charImageFeedback.userId,
        charImageFeedback.char,
        charImageFeedback.grade,
        charImageFeedback.semester,
        charImageFeedback.type,
      ],
      set: {
        // 对齐原语义：learning_status 非空才覆盖；needs_regen 取并集；timestamp 恒更新
        learningStatus: sql`CASE WHEN ${entry.learningStatus} IS NULL THEN ${charImageFeedback.learningStatus} ELSE ${entry.learningStatus} END`,
        needsRegen: sql`MAX(${charImageFeedback.needsRegen}, ${entry.needsRegen ? 1 : 0})`,
        timestamp: entry.timestamp,
      },
    })
    .run()
  return c.json({ status: "ok" })
})

// GET /api/v1/char-images/feedback（全站学习反馈：要求登录）
router.get("/feedback", requireAuth(), async (c) => {
  const user_id = Number(c.req.query("user_id") ?? 0)
  const limit = Number(c.req.query("limit") ?? 50)
  const offset = Number(c.req.query("offset") ?? 0)
  const rows = await getDb().select().from(charImageFeedback).orderBy(desc(charImageFeedback.timestamp)).all()
  let items = rows
    .filter((r) => user_id <= 0 || r.userId === user_id)
    .map((r) => mapFeedbackRow(r))
  const total = items.length
  items = [...items].sort((a, b) => String(b?.timestamp ?? "").localeCompare(String(a?.timestamp ?? "")))
  const stats = { correct: 0, wrong: 0, unsure: 0, unmarked: 0 }
  for (const x of items) {
    const s = x?.learning_status as string | null | undefined
    if (s && s in stats) stats[s as keyof typeof stats]++
    else stats.unmarked++
  }
  return c.json({ total, stats, items: items.slice(offset, offset + Math.max(1, Math.min(limit, 100000))) })
})

// GET /api/v1/char-images/{char}
router.get("/:char", async (c) => {
  const char = c.req.param("char")
  // 同字可能有多条（认 .png / 写 .jpg 变体），取最后一条对齐旧 indexMap「后者覆盖前者」语义
  const row = await getDb()
    .select()
    .from(charImageIndex)
    .where(eq(charImageIndex.char, char))
    .orderBy(desc(charImageIndex.id))
    .limit(1)
    .get()
  if (!row) return c.json({ detail: `汉字 '${char}' 没有图片` }, 404)
  const result = mapIndexRow(row)
  if (!result.pinyin) result.pinyin = await getPinyin(String(result.char ?? ""))
  return c.json(result)
})

// GET /api/v1/char-images/file/{filename}（?w=N → 预生成缩略图；图片很多的页面用它加速）
// 原图为 2048×2048 PNG (~3.3MB)，字卡只需 ~768px。
// 缩略图由 scripts/gen_char_thumbs_webp.py（768px WebP q82，优先）与 gen_char_thumbs.py
// （640px JPEG q88，兜底）离线批量生成（workerd 禁止运行时 WASM 编译），
// 存 R2 data/char_images_thumb/<原名>.webp|jpg，路由直读零 CPU；URL 含尺寸参数 → immutable 7 天。
router.get("/file/:filename", async (c) => {
  const filename = c.req.param("filename").split(/[\\/]/).pop() || ""
  const key = `${IMAGE_DIR}/${filename}`
  if (!(await exists(key))) return c.json({ detail: "图片不存在" }, 404)
  const w = Number(c.req.query("w") ?? 0)
  if (w > 0) {
    // w>=1024（「显示原图」中间档）：优先 1536px WebP，逐级回退 768px WebP → 640px JPEG → 原图
    // w<1024（字卡默认展示）：优先 768px WebP → 640px JPEG → 原图
    const candidates =
      w >= 1024
        ? [`${THUMB_1536_DIR}/${filename}.webp`, `${THUMB_DIR}/${filename}.webp`, `${THUMB_DIR}/${filename}.jpg`]
        : [`${THUMB_DIR}/${filename}.webp`, `${THUMB_DIR}/${filename}.jpg`]
    for (const key of candidates) {
      const blob = await readBlob(key)
      if (blob) {
        const type = key.endsWith(".webp") ? "image/webp" : "image/jpeg"
        return new Response(blob, {
          headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable" },
        })
      }
    }
    // 缩略图尚未生成（后台批处理补完中）→ 回退原图
  }
  const data = await readBlob(key)
  if (!data) return c.json({ detail: "图片不存在" }, 404)
  // 缓存头：热路径（字卡页一屏数百张图），图片内容不变让浏览器直接命中缓存
  return new Response(data, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } })
})

// POST /api/v1/char-images/audio（multipart: char + file）
router.post("/audio", requireAuth(), async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少参数" }, 400)
  const char = String(form.get("char") ?? "")
  const file = form.get("file")
  if (!char || !file || typeof file === "string") return c.json({ detail: "缺少 char 或音频文件" }, 400)
  const content = new Uint8Array(await (file as File).arrayBuffer())
  const safe = char.replace(/[/\\:]/g, "_")
  await writeBlob(`${AUDIO_DIR}/${safe}.mp3`, content, "audio/mpeg")
  return c.json({ status: "ok", filename: `${safe}.mp3` })
})

// GET /api/v1/char-images/audio/{char}/exists
router.get("/audio/:char/exists", async (c) => {
  const char = c.req.param("char")
  const safe = char.replace(/[/\\:]/g, "_")
  return c.json({ exists: await exists(`${AUDIO_DIR}/${safe}.mp3`) })
})

// GET /api/v1/char-images/audio/{filename}
router.get("/audio/:filename", async (c) => {
  const filename = c.req.param("filename").split(/[\\/]/).pop() || ""
  const key = `${AUDIO_DIR}/${filename}`
  if (!(await exists(key))) return c.json({ detail: "录音不存在" }, 404)
  const data = await readBlob(key)
  if (!data) return c.json({ detail: "录音不存在" }, 404)
  return new Response(data, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600" } })
})

export default router