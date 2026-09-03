/** ai_chinese/ai_chinese_textbook —— 按域自主路由拆出（路径/响应逐字节不变）。
 * 共享目录与小工具在 lib/aiChineseContext.ts；提示词在 lib/prompts.ts。 */
import { Hono } from "hono"
import { db } from "../db/index.js"
import { chineseTextbookPages, chineseUnitKnowledge } from "../db/schema.js"
import { cleanOcrText } from "../lib/aiTextUtils.js"
import { getArk } from "../lib/ark.js"
import { BudgetExceededError } from "../lib/deepseek.js"
import { autoOrient, compressImageToFile } from "../lib/image.js"
import { CHINESE_TEXTBOOK_PROMPT } from "../lib/prompts.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { and, desc, eq, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { IMAGE_DIR, multimodalModel, chatJson, loadJsonArr, strList } from "../lib/aiChineseContext.js"

import { PAGE_NUMBER_PROMPT } from "../lib/prompts.js"

const router = new Hono()

router.get("/ai-chinese/units", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const unit = String(c.req.query("unit") ?? "")
  const lesson = String(c.req.query("lesson") ?? "")
  const category = String(c.req.query("category") ?? "")
  const q = String(c.req.query("q") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 500)
  const conditions = []
  if (unit) conditions.push(eq(chineseUnitKnowledge.unit, unit))
  if (lesson) conditions.push(eq(chineseUnitKnowledge.lesson, lesson))
  if (category) conditions.push(eq(chineseUnitKnowledge.category, category))
  if (q) conditions.push(sql`${chineseUnitKnowledge.content} LIKE ${`%${q}%`}`)
  const rows = db
    .select()
    .from(chineseUnitKnowledge)
    .where(and(...conditions))
    .orderBy(desc(chineseUnitKnowledge.id))
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({
    id: r.id, unit: r.unit, lesson: r.lesson, category: r.category,
    page: r.page, content: (r.content || "").slice(0, 2000),
    knowledge_points: loadJsonArr(r.knowledgePoints),
    question_types: loadJsonArr(r.questionTypes),
    image_path: r.imagePath || "",
  })))
})

router.post("/ai-chinese/textbook-extract", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  const prompt = CHINESE_TEXTBOOK_PROMPT.replace("{text}", text.slice(0, 4000))
  // BudgetExceededError 不捕获 → 全局 429
  const data = await chatJson("你是一个只输出JSON的小学语文教研员。", prompt, 2048, "ai_chinese_textbook",
    (d) => Boolean(d.page_type || d.lesson || d.unit || d.page))
  return c.json({
    page: String(data.page ?? "").trim(),
    unit: String(data.unit ?? "").trim() || "未分类",
    lesson: String(data.lesson ?? "").trim(),
    page_type: String(data.page_type ?? "其他").trim(),
    knowledge_points: strList(data.knowledge_points),
  })
})

router.get("/ai-chinese/outline", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const tbs = db.select().from(chineseTextbookPages).orderBy(chineseTextbookPages.page).all()
  const uks = db.select().from(chineseUnitKnowledge).orderBy(chineseUnitKnowledge.id).all()

  const unitOrder: Record<string, number> = {
    "第一单元": 1, "第二单元": 2, "第三单元": 3, "第四单元": 4,
    "第五单元": 5, "第六单元": 6, "第七单元": 7, "第八单元": 8,
  }
  const unitKey = (u: string): number => unitOrder[(u || "").trim()] ?? 99

  const units: Record<string, Record<string, { id: number; source: string; type: string; title: string; snippet: string }[]>> = {}
  const add = (unit: string, lesson: string, item: { id: number; source: string; type: string; title: string; snippet: string }) => {
    const u = (unit || "").trim() || "未分类"
    const l = (lesson || "").trim() || "（课文未分类）"
    ;(units[u] ??= {})[l] ??= []
    units[u][l].push(item)
  }

  for (const r of tbs) {
    const page = String(r.page ?? "")
    const ptype = r.pageType || "课本"
    add(r.unit, r.lesson, {
      id: r.id, source: "textbook", type: ptype,
      title: page ? `第${page}页 · ${ptype}` : ptype,
      snippet: cleanOcrText(r.content || "").slice(0, 80).replace(/\n/g, " "),
    })
  }
  for (const r of uks) {
    const cat = r.category || "知识"
    add(r.unit, r.lesson, {
      id: r.id, source: "unit_knowledge", type: cat,
      title: cat,
      snippet: cleanOcrText(r.content || "").slice(0, 80).replace(/\n/g, " "),
    })
  }

  const result = Object.entries(units)
    .sort((a, b) => unitKey(a[0]) - unitKey(b[0]) || a[0].localeCompare(b[0], "zh"))
    .map(([unit, lessons]) => ({
      unit,
      lessons: Object.entries(lessons)
        .sort((a, b) => a[0].localeCompare(b[0], "zh"))
        .map(([lesson, items]) => ({ lesson, items })),
    }))
  return c.json({ units: result })
})

router.get("/ai-chinese/outline-item", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const source = String(c.req.query("source") ?? "textbook")
  const itemId = Number(c.req.query("item_id") ?? 0)
  if (!["textbook", "unit_knowledge"].includes(source)) return c.json({ detail: "未知来源" }, 422)
  if (source === "textbook") {
    const r = db.select().from(chineseTextbookPages).where(eq(chineseTextbookPages.id, itemId)).get()
    if (!r) return c.json({ detail: "条目不存在" }, 404)
    return c.json({
      source, id: r.id, unit: r.unit, lesson: r.lesson,
      type: r.pageType || "", page: r.page || "",
      content: (r.content || "").trim(), image_path: r.imagePath || "",
    })
  }
  const r = db.select().from(chineseUnitKnowledge).where(eq(chineseUnitKnowledge.id, itemId)).get()
  if (!r) return c.json({ detail: "条目不存在" }, 404)
  return c.json({
    source, id: r.id, unit: r.unit, lesson: r.lesson,
    type: r.category || "", page: r.page || "",
    content: (r.content || "").trim(), image_path: r.imagePath || "",
  })
})

router.get("/ai-chinese/textbook", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const page = String(c.req.query("page") ?? "")
  const unit = String(c.req.query("unit") ?? "")
  const lesson = String(c.req.query("lesson") ?? "").trim()
  const ptype = String(c.req.query("ptype") ?? "")
  const q = String(c.req.query("q") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 500)
  const conditions = []
  if (page) conditions.push(eq(chineseTextbookPages.page, page))
  if (unit) conditions.push(eq(chineseTextbookPages.unit, unit))
  if (lesson) conditions.push(sql`${chineseTextbookPages.lesson} LIKE ${`%${lesson.replace(/[《》\s]/g, "")}%`}`)
  if (ptype) conditions.push(eq(chineseTextbookPages.pageType, ptype))
  if (q) conditions.push(sql`${chineseTextbookPages.content} LIKE ${`%${q}%`}`)
  const rows = db
    .select()
    .from(chineseTextbookPages)
    .where(and(...conditions))
    .orderBy(chineseTextbookPages.page)
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({
    id: r.id, page: r.page, unit: r.unit, lesson: r.lesson,
    page_type: r.pageType, content: (r.content || "").slice(0, 2000),
    knowledge_points: loadJsonArr(r.knowledgePoints),
    image_path: r.imagePath || "",
  })))
})

router.post("/ai-chinese/page-number", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400)
  const data = Buffer.from(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "图片为空" }, 422)
  const fname = `${randomUUID().replace(/-/g, "")}.jpg`
  const path = join(IMAGE_DIR, fname)
  await mkdir(IMAGE_DIR, { recursive: true })
  await writeFile(path, data)
  let oriented = path
  try {
    oriented = await autoOrient(path)
  } catch {
    /* 跳过 */
  }
  try {
    const compressed = await compressImageToFile(oriented, join(IMAGE_DIR, `${fname.replace(/\.[^.]+$/, "")}.page.jpg`), 800, 70)
    const reply = await getArk().chat({
      prompt: PAGE_NUMBER_PROMPT,
      image_paths: [compressed],
      max_tokens: 16,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
    const page = (reply || "").trim()
    return c.json({ page: /^\d+$/.test(page) ? page : "" })
  } catch (e) {
    console.warn("[ai-chinese/page-number] 页码识别失败:", (e as Error).message)
    return c.json({ page: "" })
  }
})

export default router
