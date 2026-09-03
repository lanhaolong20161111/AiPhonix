/** 每日一练·英语 — /api/v1/daily-en
 * 1) 配置 CRUD（按账号+日期，跨设备同步；镜像 daily_zh）
 * 2) 单词内容 /daily-en/word-info：LLM 造 2 个例句 + 中文释义（缓存 daily_en_content kind=word）
 * 3) 句子内容 /daily-en/sentence-info：LLM 翻译 + 常用中文场景（缓存 kind=sentence）
 * 4) 图片查找 /daily-en/image：english_image_index 精确匹配，无则 image:null（前端不显示）
 * 5) 图片文件 /daily-en/file/:filename：R2 english_images 直读
 *
 * LLM 调用统一走 getArk().chat(..., { model_override: doubao-seed-2-1-turbo-260628, disable_thinking: true })
 * （纯文本、短 JSON 任务快且可靠，避开 deepseek 思维链吞 token 导致空内容；与 ai_chinese.fillPolyphones 一致）。
 */
import { Hono } from "hono"
import { and, desc, eq, sql } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { dailyEnConfig, dailyEnContent, englishImageIndex, charImageIndex } from "../db/schema.js"
import { resolveCurrentUser, requireAuth } from "../middleware/auth.js"
import { getArk, multimodalModel } from "../lib/ark.js"
import { dataPath } from "../lib/jsonfile.js"
import { exists, readBlob } from "../lib/storage.js"

const router = new Hono()

const EN_IMAGE_DIR = dataPath("english_images")
// 看图识字图库（英词/英句图量多：533+202）：english_image_index 命中不了时回退到这里
const CHAR_IMAGE_DIR = dataPath("char_images")

/** 图片类型 → 看图识字图库的 type 值 */
const EN_TYPE_OF_KIND: Record<string, string> = { word: "英词", sentence: "英句" }

function cstDate(d = new Date()): string {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  const cst = new Date(utc + 8 * 3600000)
  return cst.toISOString().slice(0, 10)
}

interface DailyEnRow {
  words: string
  sentences: string
  updatedAt: string
}

function toDto(r: { words: string; sentences: string; updatedAt: string }): DailyEnRow {
  return { words: r.words, sentences: r.sentences, updatedAt: r.updatedAt }
}

// ── 1) 配置 CRUD ──

// GET /api/v1/daily-en?date=YYYY-MM-DD
router.get("/", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"), true)
  if (!user) return c.json({ config: null, last: null, date: cstDate() })
  const date = c.req.query("date") || cstDate()
  const row = await getDb().select().from(dailyEnConfig)
    .where(and(eq(dailyEnConfig.userId, user.id), eq(dailyEnConfig.date, date))).get()
  if (row) return c.json({ config: toDto(row), last: null, date })
  const last = await getDb().select().from(dailyEnConfig)
    .where(eq(dailyEnConfig.userId, user.id)).orderBy(desc(dailyEnConfig.date)).limit(1).get()
  return c.json({ config: null, last: last ? toDto(last) : null, date })
})

// PUT /api/v1/daily-en
router.put("/", requireAuth(), async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== "object") return c.json({ detail: "请求体为空" }, 400)
  const date = String(body?.date || cstDate()).slice(0, 10)
  const values = {
    words: String(body?.words ?? ""),
    sentences: String(body?.sentences ?? ""),
    updatedAt: new Date().toISOString(),
  }
  const existing = await getDb().select().from(dailyEnConfig)
    .where(and(eq(dailyEnConfig.userId, user!.id), eq(dailyEnConfig.date, date))).get()
  if (existing) {
    await getDb().update(dailyEnConfig).set(values).where(eq(dailyEnConfig.id, existing.id)).run()
  } else {
    await getDb().insert(dailyEnConfig).values({ userId: user!.id, date, ...values }).run()
  }
  return c.json({ status: "ok", date, config: values })
})

// ── LLM JSON 解析工具 ──

function extractJson(raw: string): string {
  let s = raw.trim()
  // 去 ```json ... ``` 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 取首个 { 到末尾最后一个 }
  const a = s.indexOf("{")
  const b = s.lastIndexOf("}")
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  return s
}

// ── 2) 单词内容（LLM 造 2 句 + 中文释义） ──

// GET /api/v1/daily-en/word-info?word=apple
router.get("/word-info", async (c) => {
  const word = (c.req.query("word") ?? "").trim()
  if (!word) return c.json({ detail: "缺少 word" }, 400)
  const key = word.toLowerCase()

  // 缓存命中
  const cached = await getDb().select().from(dailyEnContent)
    .where(and(eq(dailyEnContent.kind, "word"), eq(dailyEnContent.text, key))).get()
  if (cached?.content) {
    try { return c.json({ word, ...JSON.parse(cached.content), cached: true }) } catch { /* 落到重新生成 */ }
  }

  const system = [
    "你是面向小学生的儿童英语老师。",
    "给定英文单词，输出严格 JSON（不要解释、不要代码围栏）：",
    '{ "translation": "中文释义", "meaning": "一句话中文简明释义/词性",',
    '  "sentences": [ { "en": "例句英文(简单,适合小学生)", "zh": "例句中文翻译" }, ... ] }',
    "生成恰好 2 个日常实用、简单易懂的例句。",
  ].join("\n")
  const user = word

  let parsed: { translation?: string; meaning?: string; sentences?: Array<{ en: string; zh: string }> } = {}
  try {
    // 强制用已验证可用的豆包 doubao-seed-2-1-turbo-260628（纯文本、disable_thinking，避免思维链吞 token 致空内容）
    const raw = await getArk().chat({
      prompt: user,
      system_prompt: system,
      max_tokens: 800,
      model_override: multimodalModel(),
      disable_thinking: true,
      timeout_ms: 40_000,
    })
    if (raw) parsed = JSON.parse(extractJson(raw))
  } catch (e) {
    console.warn(`[daily-en] word-info LLM 失败(${word}): ${(e as Error).message}`)
  }

  const content = {
    translation: parsed.translation ?? "",
    meaning: parsed.meaning ?? "",
    sentences: Array.isArray(parsed.sentences)
      ? parsed.sentences.slice(0, 2).map((s) => ({ en: String(s?.en ?? ""), zh: String(s?.zh ?? "") }))
      : [],
  }
  // 仅当生成到有效内容才落库缓存（避免空结果被永久缓存、挡住后续重试）
  const hasContent = !!(content.translation || content.meaning || content.sentences.length)
  if (hasContent) {
    await getDb().insert(dailyEnContent).values({
      kind: "word", text: key, content: JSON.stringify(content), createdAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [dailyEnContent.kind, dailyEnContent.text],
      set: { content: JSON.stringify(content), createdAt: new Date().toISOString() },
    }).run()
  }

  return c.json({ word, ...content, cached: false })
})

// ── 3) 句子内容（翻译 + 常用中文场景） ──

// GET /api/v1/daily-en/sentence-info?sentence=...
router.get("/sentence-info", async (c) => {
  const sentence = (c.req.query("sentence") ?? "").trim()
  if (!sentence) return c.json({ detail: "缺少 sentence" }, 400)
  const key = sentence.toLowerCase()

  const cached = await getDb().select().from(dailyEnContent)
    .where(and(eq(dailyEnContent.kind, "sentence"), eq(dailyEnContent.text, key))).get()
  if (cached?.content) {
    try { return c.json({ sentence, ...JSON.parse(cached.content), cached: true }) } catch { /* 重新生成 */ }
  }

  const system = [
    "你是面向小学生的儿童英语老师。",
    "给定一句英文，输出严格 JSON（不要解释、不要代码围栏）：",
    '{ "translation": "整句中文翻译", "scene": "这句话常用的中文场景说明(简短,说明在什么情况下常说这句话)" }',
  ].join("\n")
  const user = sentence

  let parsed: { translation?: string; scene?: string } = {}
  try {
    const raw = await getArk().chat({
      prompt: user,
      system_prompt: system,
      max_tokens: 600,
      model_override: multimodalModel(),
      disable_thinking: true,
      timeout_ms: 40_000,
    })
    if (raw) parsed = JSON.parse(extractJson(raw))
  } catch (e) {
    console.warn(`[daily-en] sentence-info LLM 失败(${sentence}): ${(e as Error).message}`)
  }

  const content = {
    translation: parsed.translation ?? "",
    scene: parsed.scene ?? "",
  }
  // 仅当生成到有效内容才落库缓存
  const hasContent = !!(content.translation || content.scene)
  if (hasContent) {
    await getDb().insert(dailyEnContent).values({
      kind: "sentence", text: key, content: JSON.stringify(content), createdAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [dailyEnContent.kind, dailyEnContent.text],
      set: { content: JSON.stringify(content), createdAt: new Date().toISOString() },
    }).run()
  }

  return c.json({ sentence, ...content, cached: false })
})

// ── 4) 图片查找（数据库里没有 → image:null） ──

// GET /api/v1/daily-en/image?text=apple
router.get("/image", async (c) => {
  const text = (c.req.query("text") ?? "").trim()
  if (!text) return c.json({ image: null })
  const kind = (c.req.query("kind") === "sentence" ? "sentence" : "word")
  const key = text.toLowerCase()
  const db = getDb()

  // ① 专表 english_image_index（运营灌图优先；当前基本为空）
  const row = await db.select().from(englishImageIndex)
    .where(and(eq(englishImageIndex.kind, kind), eq(englishImageIndex.text, key))).get()
  if (row?.image) return c.json({ image: row.image })

  // ② 回退看图识字图库 char_image_index（type=英词/英句，含 533 英词 + 202 英句，文件在 R2 data/char_images/）
  const enType = EN_TYPE_OF_KIND[kind]
  if (enType) {
    // 图库 char 按小写归一存储（英词）；英句可能带大小写/标点 → LOWER 匹配
    const alt = await db.select().from(charImageIndex)
      .where(and(
        eq(charImageIndex.type, enType),
        sql`LOWER(${charImageIndex.char}) = ${key}`,
      )).get()
    if (alt?.image) return c.json({ image: alt.image })
  }
  return c.json({ image: null })
})

// ── 5) 图片文件直读（R2 english_images；缺失时回退 char_images 图库） ──

// GET /api/v1/daily-en/file/:filename
router.get("/file/:filename", async (c) => {
  const filename = c.req.param("filename").split(/[\\/]/).pop() || ""
  if (!filename) return c.json({ detail: "文件名缺失" }, 400)
  // ① 专表目录 english_images
  let key = `${EN_IMAGE_DIR}/${filename}`
  if (await exists(key)) {
    const data = await readBlob(key)
    if (data) return imgResponse(data, filename)
  }
  // ② 回退看图识字图库 char_images（英词/英句图实际存放在此）
  key = `${CHAR_IMAGE_DIR}/${filename}`
  if (await exists(key)) {
    const data = await readBlob(key)
    if (data) return imgResponse(data, filename)
  }
  return c.json({ detail: "图片不存在" }, 404)
})

function imgResponse(data: ArrayBuffer | Blob, filename: string): Response {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const mime =
    ext === "webp" ? "image/webp" :
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
    ext === "gif" ? "image/gif" :
    "image/png"
  return new Response(data, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=604800, immutable" },
  })
}

export default router
