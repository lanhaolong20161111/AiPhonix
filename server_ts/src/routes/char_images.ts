/** CharImages 路由 — /api/v1/char-images（读写索引/反馈/图片/音频，pinyin-pro 生成拼音） */
import { Hono } from "hono"
import { pinyin } from "pinyin-pro"
import { existsSync, writeFileSync, mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { readJson, writeJson, dataPath } from "../lib/jsonfile.js"

import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
const INDEX_FILE = dataPath("char_image_index.json")
const IMAGE_DIR = dataPath("char_images")
const FEEDBACK_FILE = dataPath("char_image_feedback.json")
const AUDIO_DIR = dataPath("char_audio")

let index: any[] = []
let indexMap = new Map<string, any>()
const pinyinCache = new Map<string, string>()

const loadIndex = () => {
  index = []
  indexMap = new Map()
  mkdirSync(IMAGE_DIR, { recursive: true })
  const data = readJson<{ items?: any[] } | any[]>(INDEX_FILE, [])
  const raw = Array.isArray(data) ? data : data?.items ?? []
  for (const item of raw) {
    if (!item?.char) continue
    index.push(item)
    indexMap.set(item.char, item)
  }
}
loadIndex()

const getPinyin = (char: string): string => {
  if (!char || !/[\u4e00-\u9fff]/.test(char)) return ""
  if (pinyinCache.has(char)) return pinyinCache.get(char)!
  try {
    const result = pinyin(char, { toneType: "symbol", type: "array" }).join(" ")
    pinyinCache.set(char, result)
    return result
  } catch {
    return char
  }
}

const saveIndex = () => {
  mkdirSync(dirname(INDEX_FILE), { recursive: true })
  writeJson(INDEX_FILE, { version: 1, total: index.length, items: index })
}

// GET /api/v1/char-images
router.get("/", (c) => {
  const grade = c.req.query("grade") ?? ""
  const semester = c.req.query("semester") ?? ""
  const type = c.req.query("type") ?? ""
  const q = c.req.query("q") ?? ""
  const limit = Number(c.req.query("limit") ?? 500)
  let result = index
  if (grade) result = result.filter((e) => e.grade === grade)
  if (semester) result = result.filter((e) => e.semester === semester)
  if (type) result = result.filter((e) => e.type === type)
  if (q) {
    const ql = q.toLowerCase()
    result = result.filter((e) => String(e.char ?? "").toLowerCase().includes(ql) || String(e.image ?? "").toLowerCase().includes(ql))
  }
  const total = result.length
  if (limit > 0) result = result.slice(0, limit)
  for (const item of result) {
    if (!item.pinyin) item.pinyin = getPinyin(item.char ?? "")
  }
  return c.json({ total, items: result })
})

// POST /api/v1/char-images/feedback（幂等合并）
router.post("/feedback", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ detail: "请求体为空" }, 400)
  const entry = {
    user_id: Number(body?.user_id ?? 0),
    char: String(body?.char ?? ""),
    grade: String(body?.grade ?? ""),
    semester: String(body?.semester ?? ""),
    type: String(body?.type ?? ""),
    learning_status: body?.learning_status ?? null,
    needs_regen: Boolean(body?.needs_regen),
    timestamp: new Date().toISOString(),
  }
  const feedbacks = readJson<any[]>(FEEDBACK_FILE, [])
  const existing = feedbacks.find(
    (x) =>
      Number(x?.user_id ?? 0) === entry.user_id &&
      x?.char === entry.char &&
      x?.grade === entry.grade &&
      x?.semester === entry.semester &&
      x?.type === entry.type
  )
  if (existing) {
    if (entry.learning_status !== null) existing.learning_status = entry.learning_status
    existing.needs_regen = Boolean(existing.needs_regen) || entry.needs_regen
    existing.timestamp = entry.timestamp
    if (existing.user_id === undefined) existing.user_id = entry.user_id
  } else {
    feedbacks.push(entry)
  }
  writeJson(FEEDBACK_FILE, feedbacks)
  return c.json({ status: "ok" })
})

// GET /api/v1/char-images/feedback（全站学习反馈：要求登录）
router.get("/feedback", requireAuth(), (c) => {
  let items = readJson<any[]>(FEEDBACK_FILE, [])
  const user_id = Number(c.req.query("user_id") ?? 0)
  const limit = Number(c.req.query("limit") ?? 50)
  const offset = Number(c.req.query("offset") ?? 0)
  if (user_id > 0) items = items.filter((x) => Number(x?.user_id ?? 0) === user_id)
  const total = items.length
  items = [...items].sort((a, b) => String(b?.timestamp ?? "").localeCompare(String(a?.timestamp ?? "")))
  const stats = { correct: 0, wrong: 0, unsure: 0, unmarked: 0 }
  for (const x of items) {
    const s = x?.learning_status
    if (s in stats) stats[s as keyof typeof stats]++
    else stats.unmarked++
  }
  return c.json({ total, stats, items: items.slice(offset, offset + Math.max(1, Math.min(limit, 100000))) })
})

// GET /api/v1/char-images/{char}
router.get("/:char", (c) => {
  const char = c.req.param("char")
  const entry = indexMap.get(char)
  if (!entry) return c.json({ detail: `汉字 '${char}' 没有图片` }, 404)
  const result = { ...entry }
  if (!("pinyin" in result)) result.pinyin = getPinyin(result.char ?? "")
  return c.json(result)
})

// GET /api/v1/char-images/file/{filename}
router.get("/file/:filename", async (c) => {
  const filename = c.req.param("filename").split(/[\\/]/).pop() || ""
  const path = join(IMAGE_DIR, filename)
  if (!existsSync(path)) return c.json({ detail: "图片不存在" }, 404)
  // 异步读：热路径（字卡页一屏数百张图），同步 IO 会阻塞事件循环拖慢全部请求
  return new Response(await readFile(path), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } })
})

// POST /api/v1/char-images/audio（multipart: char + file）
router.post("/audio", requireAuth(), async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少参数" }, 400)
  const char = String(form.get("char") ?? "")
  const file = form.get("file")
  if (!char || !file || typeof file === "string") return c.json({ detail: "缺少 char 或音频文件" }, 400)
  const content = Buffer.from(await (file as File).arrayBuffer())
  mkdirSync(AUDIO_DIR, { recursive: true })
  const safe = char.replace(/[/\\:]/g, "_")
  writeFileSync(join(AUDIO_DIR, `${safe}.mp3`), content)
  return c.json({ status: "ok", filename: `${safe}.mp3` })
})

// GET /api/v1/char-images/audio/{char}/exists
router.get("/audio/:char/exists", (c) => {
  const char = c.req.param("char")
  const safe = char.replace(/[/\\:]/g, "_")
  return c.json({ exists: existsSync(join(AUDIO_DIR, `${safe}.mp3`)) })
})

// GET /api/v1/char-images/audio/{filename}
router.get("/audio/:filename", async (c) => {
  const filename = c.req.param("filename").split(/[\\/]/).pop() || ""
  const path = join(AUDIO_DIR, filename)
  if (!existsSync(path)) return c.json({ detail: "录音不存在" }, 404)
  return new Response(await readFile(path), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600" } })
})

import { dirname } from "node:path"

export default router
