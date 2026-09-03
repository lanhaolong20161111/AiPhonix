/** ai_chinese/ai_chinese_questions —— 按域自主路由拆出（路径/响应逐字节不变）。Cloudflare 版。
 * 共享目录与小工具在 lib/aiChineseContext.ts；提示词在 lib/prompts.ts。
 * 差异：db→getDb() 全 await；readCache/writeCache 变 async；缓存 key 用 POSIX 拼接。 */
import { Hono } from "hono"
import { getDb } from "../db/index.js"
import { chineseEssayKnowledge, chineseQuestionItems, chineseReadingItems, chineseRecitationItems } from "../db/schema.js"
import { parseJsonObj, readCache, writeCache } from "../lib/aiShared.js"
import { BudgetExceededError, chat as deepseekChat } from "../lib/deepseek.js"
import { CHINESE_ESSAY_ENRICH_PROMPT, CHINESE_ESSAY_PROMPT, CHINESE_QUESTIONS_EXTRACT_PROMPT, CHINESE_QUESTIONS_GENERATE_PROMPT, CHINESE_READING_PROMPT } from "../lib/prompts.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { and, desc, eq, or, sql } from "drizzle-orm"
import { createHash } from "node:crypto"
import { CACHE_DIR, chatJson, loadJsonArr, strList } from "../lib/aiChineseContext.js"

const QUESTION_CATEGORIES = ["字音", "字词书写", "词语运用", "句子", "积累背诵", "阅读理解", "写作表达", "单元任务", "综合"]

const router = new Hono()

router.get("/ai-chinese/recitations", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const unit = String(c.req.query("unit") ?? "")
  const kind = String(c.req.query("kind") ?? "")
  const q = String(c.req.query("q") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500)
  const conditions = []
  if (unit) conditions.push(eq(chineseRecitationItems.unit, unit))
  if (kind) conditions.push(eq(chineseRecitationItems.kind, kind))
  if (q) conditions.push(or(
    sql`${chineseRecitationItems.content} LIKE ${`%${q}%`}`,
    sql`${chineseRecitationItems.title} LIKE ${`%${q}%`}`
  ))
  const rows = await getDb()
    .select()
    .from(chineseRecitationItems)
    .where(and(...conditions))
    .orderBy(chineseRecitationItems.id)
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({
    id: r.id, unit: r.unit, title: r.title, author: r.author,
    kind: r.kind, content: r.content, source_ref: r.sourceRef,
    page: r.page, image_path: r.imagePath,
  })))
})

router.post("/ai-chinese/reading-extract", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  const prompt = CHINESE_READING_PROMPT.replace("{text}", text.slice(0, 4000))
  // BudgetExceededError 不捕获 → 全局 429
  const data = await chatJson("你是一个只输出JSON的小学语文教研员。", prompt, 2048, "ai_chinese_reading",
    (d) => Array.isArray(d.items))
  const items: { passage: string; question: string; type: string; answer: string }[] = []
  for (const it of Array.isArray(data.items) ? data.items as unknown[] : []) {
    if (it && typeof it === "object" && String((it as Record<string, unknown>).question ?? "").trim()) {
      items.push({
        passage: String((it as Record<string, unknown>).passage ?? "").trim(),
        question: String((it as Record<string, unknown>).question).trim(),
        type: String((it as Record<string, unknown>).type ?? "其他").trim(),
        answer: String((it as Record<string, unknown>).answer ?? "").trim(),
      })
    }
  }
  return c.json({ items: items.slice(0, 10) })
})

router.get("/ai-chinese/reading-items", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const unit = String(c.req.query("unit") ?? "")
  const lesson = String(c.req.query("lesson") ?? "")
  const qtype = String(c.req.query("qtype") ?? "")
  const q = String(c.req.query("q") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 500)
  const conditions = []
  if (unit) conditions.push(eq(chineseReadingItems.unit, unit))
  if (lesson) conditions.push(eq(chineseReadingItems.lesson, lesson))
  if (qtype) conditions.push(eq(chineseReadingItems.questionType, qtype))
  if (q) conditions.push(sql`${chineseReadingItems.question} LIKE ${`%${q}%`}`)
  const rows = await getDb()
    .select()
    .from(chineseReadingItems)
    .where(and(...conditions))
    .orderBy(desc(chineseReadingItems.id))
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({
    id: r.id, unit: r.unit, lesson: r.lesson, category: r.category,
    page: r.page, passage: (r.passage || "").slice(0, 2000), question: (r.question || "").slice(0, 2000),
    question_type: r.questionType, answer: (r.answer || "").slice(0, 500),
  })))
})

router.post("/ai-chinese/questions-extract", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  const prompt = CHINESE_QUESTIONS_EXTRACT_PROMPT.replace("{text}", text.slice(0, 4000))
  // BudgetExceededError 不捕获 → 全局 429
  const data = await chatJson("你是一个只输出JSON的小学语文教研员。", prompt, 4096, "ai_chinese_qextract",
    (d) => Array.isArray(d.items))
  const items: { category: string; question: string; answer: string }[] = []
  for (const it of Array.isArray(data.items) ? data.items as unknown[] : []) {
    if (it && typeof it === "object" && String((it as Record<string, unknown>).question ?? "").trim()) {
      let cat = String((it as Record<string, unknown>).category ?? "综合").trim()
      if (!QUESTION_CATEGORIES.includes(cat)) cat = "综合"
      items.push({ category: cat, question: String((it as Record<string, unknown>).question).trim(), answer: String((it as Record<string, unknown>).answer ?? "").trim() })
    }
  }
  return c.json({ items: items.slice(0, 20) })
})

router.post("/ai-chinese/questions-generate", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const examplesRaw: unknown[] = Array.isArray(body?.examples) ? body.examples : []
  const examples = examplesRaw.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 4)
  if (!examples.length) return c.json({ detail: "缺少示例题目" }, 422)
  const count = Math.max(1, Math.min(Number(body?.count ?? 3) || 3, 8))
  let cat = String(body?.category ?? "字音")
  if (!QUESTION_CATEGORIES.includes(cat)) cat = "综合"
  const unit = String(body?.unit ?? "（未分类）")
  const lesson = String(body?.lesson ?? "")
  const prompt = CHINESE_QUESTIONS_GENERATE_PROMPT
    .replace("{category}", cat).replace("{count}", String(count))
    .replace("{examples}", examples.join("\n"))
    .replace("{unit}", unit).replace("{lesson}", lesson)
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的小学语文出题老师。", prompt, 4096, "ai_chinese_qgen", true)
  const items: { category: string; question: string; answer: string }[] = []
  const data = parseJsonObj(reply)
  if (data && Array.isArray(data.items)) {
    for (const it of data.items as unknown[]) {
      if (it && typeof it === "object" && String((it as Record<string, unknown>).question ?? "").trim()) {
        items.push({ category: cat, question: String((it as Record<string, unknown>).question).trim(), answer: String((it as Record<string, unknown>).answer ?? "").trim() })
      }
    }
  }
  return c.json({ items: items.slice(0, count) })
})

router.get("/ai-chinese/questions", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const category = String(c.req.query("category") ?? "")
  const unit = String(c.req.query("unit") ?? "")
  const lesson = String(c.req.query("lesson") ?? "")
  const source = String(c.req.query("source") ?? "")
  const q = String(c.req.query("q") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 500)
  const conditions = []
  if (category) conditions.push(eq(chineseQuestionItems.category, category))
  if (unit) conditions.push(eq(chineseQuestionItems.unit, unit))
  if (lesson) conditions.push(eq(chineseQuestionItems.lesson, lesson))
  if (source) conditions.push(eq(chineseQuestionItems.source, source))
  if (q) conditions.push(sql`${chineseQuestionItems.question} LIKE ${`%${q}%`}`)
  const rows = await getDb()
    .select()
    .from(chineseQuestionItems)
    .where(and(...conditions))
    .orderBy(desc(chineseQuestionItems.id))
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({
    id: r.id, category: r.category, question: (r.question || "").slice(0, 2000), answer: (r.answer || "").slice(0, 500),
    unit: r.unit, lesson: r.lesson, page: r.page, source: r.source,
  })))
})

router.post("/ai-chinese/essay-enrich", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  const prompt = CHINESE_ESSAY_ENRICH_PROMPT.replace("{text}", text.slice(0, 4000))
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的小学作文教研员。", prompt, 2048, "ai_chinese_essay_enrich", true)
  const data = parseJsonObj(reply) ?? {}
  return c.json({
    model_essay: String(data.model_essay ?? "").trim(),
    good_words: strList(data.good_words, 10),
  })
})

router.post("/ai-chinese/essay-extract", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  const prompt = CHINESE_ESSAY_PROMPT.replace("{text}", text.slice(0, 4000))
  // BudgetExceededError 不捕获 → 全局 429
  const data = await chatJson("你是一个只输出JSON的小学作文教研员。", prompt, 2048, "ai_chinese_essay",
    (d) => Boolean(d.title || d.requirement || d.guide || d.topic))
  return c.json({
    unit: String(data.unit ?? "").trim() || "未分类",
    title: String(data.title ?? "").trim(),
    topic: String(data.topic ?? "").trim(),
    requirement: String(data.requirement ?? "").trim(),
    guide: strList(data.guide),
    goals: strList(data.goals),
  })
})

router.get("/ai-chinese/essays", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const unit = String(c.req.query("unit") ?? "")
  const title = String(c.req.query("title") ?? "")
  const q = String(c.req.query("q") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 500)
  const conditions = []
  if (unit) conditions.push(eq(chineseEssayKnowledge.unit, unit))
  if (title) conditions.push(eq(chineseEssayKnowledge.title, title))
  if (q) conditions.push(sql`${chineseEssayKnowledge.content} LIKE ${`%${q}%`}`)
  const rows = await getDb()
    .select()
    .from(chineseEssayKnowledge)
    .where(and(...conditions))
    .orderBy(desc(chineseEssayKnowledge.id))
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({
    id: r.id, unit: r.unit, title: r.title, topic: r.topic,
    requirement: (r.requirement || "").slice(0, 2000), guide: loadJsonArr(r.guide), goals: loadJsonArr(r.goals),
    page: r.page, content: (r.content || "").slice(0, 2000),
    model_essay: (r.modelEssay || "").slice(0, 3000), good_words: loadJsonArr(r.goodWords),
    image_path: r.imagePath || "",
  })))
})

router.post("/ai-chinese/questions", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)

  const cacheFile = `${CACHE_DIR}/questions_${createHash("sha256").update(question).digest("hex")}.json`
  const cached = await readCache(cacheFile)
  if (cached && Array.isArray(cached.questions)) {
    return c.json({ topic: "", sentences: [], total_key_points: 0, quantities: [], relations: [], questions: cached.questions })
  }

  const prompt =
    `找出这道数学题里的【所有问题】（问题=要求学生求解的内容，一句多问/追问都算，一个不能漏）。\n` +
    `输出 JSON：{"questions":[{"text":"问题原文","target":"要求解的量","needs":["需要先知道的量"],"hint":"求解方向，不给答案"}]}\n` +
    `【输出精简】JSON 无多余空格。\n题目：` + question
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的小学数学老师。", prompt, 4096, "ai_chinese_questions")

  const qOut: Record<string, unknown>[] = []
  const data = parseJsonObj(reply)
  if (data && Array.isArray((data as Record<string, unknown>).questions)) {
    for (const q of (data as Record<string, unknown>).questions as unknown[]) {
      if (!q || typeof q !== "object") continue
      const obj = q as Record<string, unknown>
      const text = String(obj.text ?? "").trim()
      if (!text) continue
      qOut.push({
        text,
        target: String(obj.target ?? "").trim(),
        needs: Array.isArray(obj.needs) ? obj.needs.map(String).map((s) => s.trim()).filter(Boolean) : [],
        hint: String(obj.hint ?? "").trim(),
      })
    }
  }
  if (qOut.length) await writeCache(cacheFile, { questions: qOut })
  return c.json({ topic: "", sentences: [], total_key_points: 0, quantities: [], relations: [], questions: qOut })
})

export default router
