/** AI 语文路由 — 对齐 Python routes/ai_chinese.py（52 端点）
 * 识图/高亮/提问/生字标记/点字/拼音关卡 + 知识库索引/搜索/闯关/分析
 */
import { Hono } from "hono"
import { createHash, randomUUID } from "node:crypto"
import { writeFile, mkdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { and, desc, eq, or, sql } from "drizzle-orm"
import { db, sqlite } from "../db/index.js"
import {
  charUnknownMarks, charClickStats, chineseUnitKnowledge, chineseTextbookPages,
  userImports, chineseReadingItems, chineseQuestionItems, chineseEssayKnowledge,
  wikiPages, knowledgeRelations, chineseRecitationItems, questSessions,
} from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { getArk } from "../lib/ark.js"
import { chat as deepseekChat, BudgetExceededError } from "../lib/deepseek.js"
import { autoOrient } from "../lib/image.js"
import { splitSentences } from "../lib/aiTextUtils.js"
import { readJson, writeJson } from "../lib/jsonfile.js"
import { splitPinyinWord } from "../lib/pinyin.js"
import * as quest from "../lib/quest_graph.js"
import { DATA_DIR } from "../env.js"

import { stripFence, parseJsonObj, readCache, writeCache, renderAnalyze, makeSentenceAudioPath } from "../lib/aiShared.js"

import { HIGHLIGHT_MARK_PROMPT, POS_TAGS_PROMPT, STORY_ELEMENTS_PROMPT, TEXT_ASK_PROMPT, CHINESE_PINYIN_LEVEL_PROMPT, CHINESE_HIGHLIGHT_PROMPT, CHINESE_POLYPHONES_PROMPT, CHINESE_CLASSIFY_PROMPT, CHINESE_READING_PROMPT, CHINESE_QUESTIONS_EXTRACT_PROMPT, CHINESE_QUESTIONS_GENERATE_PROMPT, CHINESE_ESSAY_ENRICH_PROMPT, CHINESE_ESSAY_PROMPT, CHINESE_TEXTBOOK_PROMPT, KB_ASK_PROMPT } from "../lib/prompts.js"
// 按域拆分的子路由（挂载于根 = 透明合并）
import kbRoutes from "./ai_chinese_kb.js"
import questRoutes from "./ai_chinese_quest.js"
import textbookRoutes from "./ai_chinese_textbook.js"
import questionsRoutes from "./ai_chinese_questions.js"
import { CACHE_DIR, IMAGE_DIR, MAX_QUESTION_LEN, multimodalModel, PROBLEM_IMAGE_DIR, SENTENCE_AUDIO_DIR, UPLOAD_DATA_DIR, autoCropWhite, chatJson, loadJsonArr, nowIso, resolveImagePath, searchTitle, strList } from "../lib/aiChineseContext.js"
import { extOf, persistAndOrient, readImageRequest, sha256Hex, type SubjectOcrOutcome } from "../lib/subject/kernel.js"
import { readChineseCachedOutcome, runChineseOcr } from "../lib/subject/chinese.js"
import { readEnglishCachedOutcome, runEnglishOcr } from "../lib/subject/english.js"
import type { Context } from "hono"

const router = new Hono()
const sentenceAudioPath = makeSentenceAudioPath(SENTENCE_AUDIO_DIR)

// ── 通用 JSON 工具 ──

/** LLM 输出 JSON + 结构校验；失败或校验不过自动重试一次（对齐 Python _chat_json） */

// ── parse-image（学科隔离后的薄路由） ──
//
// 三个学科的识图链路各自完整地住在 lib/subject/{chinese,english,math}.ts 里
// （自带提示词选择 / 清洗器 / 缩进规则 / blocks 收尾 / 分题 / 缓存键）。
// 本文件不再出现任何学科规则 —— 想看语文怎么清洗，去 chinese.ts；英语去 english.ts。
//
// ⚠️ 这里保留一个 `mode === "english"` 分支，但它是**寻址**（选哪条链），不是学科策略：
//    英语页历史上复用 `/ai-chinese/parse-image`（前端传 mode=english）；两条链之间
//    没有任何交叉引用，各自独立。将来若要给英语单独开一个路由，把这点搬过去即可。

router.post("/ai-chinese/parse-image", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const r = await readImageRequest(c)
  if (!r.ok) return c.json({ detail: r.detail }, r.status)
  const { data, fileName, noCache, reqEngine } = r.req

  const isEnglish = c.req.query("mode") === "english"
  const imageHash = sha256Hex(data)

  if (!noCache) {
    const hit = isEnglish
      ? await readEnglishCachedOutcome(imageHash)
      : await readChineseCachedOutcome(imageHash)
    if (hit) return respondOcr(c, hit)
  }

  const { oriented } = await persistAndOrient(data, IMAGE_DIR, extOf(fileName))
  const outcome = isEnglish
    ? await runEnglishOcr({ oriented, imageHash, reqEngine })
    : await runChineseOcr({ oriented, imageHash, reqEngine })
  return respondOcr(c, outcome)
})

/** 统一的响应拼装：三个学科返回同一形状（SubjectOcrOutcome），路由不按学科分支。 */
function respondOcr(c: Context, o: SubjectOcrOutcome) {
  if (o.error) return c.json({ detail: `图片识别失败（诊断：${o.error}）` }, 422)
  return c.json({
    text: o.text,
    questions: o.questions,
    blocks: o.blocks,
    page_bounds: o.pageBounds,
    crops: o.crops,
  })
}

// ── highlight-mark ──

router.post("/ai-chinese/highlight-mark", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  if (text.length > 50000) return c.json({ detail: "文本过长" }, 422)
  const prompt = HIGHLIGHT_MARK_PROMPT.replace("{text}", text.slice(0, 4000))
  let reply = ""
  try {
    reply = await getArk().chat({
      prompt,
      system_prompt: "你是一个只输出JSON的小学语文老师。",
      max_tokens: 2048,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
  } catch {
    reply = await deepseekChat("你是一个只输出JSON的小学语文老师。", prompt, 2048, "highlight")
  }
  const highlights: { type: string; phrase: string; reason: string }[] = []
  let tip = ""
  try {
    const data = JSON.parse((reply || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""))
    if (data && typeof data === "object") {
      tip = String(data.tip ?? "")
      for (const h of (data.highlights ?? []).slice(0, 3)) {
        if (!h || typeof h !== "object") continue
        const phrase = String(h.phrase ?? "").trim()
        const type = ["core", "beautiful", "word"].includes(String(h.type ?? "")) ? String(h.type) : "word"
        // 只采纳原文连续子串
        if (phrase && text.includes(phrase)) {
          highlights.push({ type, phrase, reason: String(h.reason ?? "").trim() })
        }
      }
    }
  } catch {
    /* 解析失败返回空 */
  }
  return c.json({ text, highlights, tip })
})

// ── pos-tags：中/英课文词性标注（名词/动词/形容词，供前端词性着色）──

router.post("/ai-chinese/pos-tags", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  const lang = String(body?.lang ?? "zh").trim() === "en" ? "en" : "zh"
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  if (text.length > 4000) return c.json({ detail: "文本过长" }, 422)

  // 缓存：同语言同文本不重复调 LLM
  const hash = createHash("sha256").update(`${lang}|${text}`).digest("hex")
  const cacheKey = `${CACHE_DIR}/postags_${hash}.json`
  let cached: Record<string, unknown> | null = null
  try { cached = readCache(cacheKey) as Record<string, unknown> | null } catch { /* 缓存读取失败忽略 */ }
  if (cached && Array.isArray(cached.tags)) {
    return c.json({ lang, tags: cached.tags })
  }

  const subject = lang === "en" ? "英语" : "语文"
  const prompt = POS_TAGS_PROMPT.replace("{subject}", subject).replace("{text}", text)
  let reply = ""
  try {
    reply = await getArk().chat({
      prompt,
      system_prompt: `你是一个只输出 JSON 的小学${subject}老师。`,
      max_tokens: 2048,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
  } catch {
    try {
      reply = await deepseekChat(`你是一个只输出 JSON 的小学${subject}老师。`, prompt, 2048, "pos_tags")
    } catch {
      reply = ""
    }
  }

  const tags: { word: string; pos: string }[] = []
  const seen = new Set<string>()
  try {
    const data = JSON.parse((reply || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""))
    const arr = data && Array.isArray(data.tags) ? data.tags : []
    for (const t of arr.slice(0, 200)) {
      if (!t || typeof t !== "object") continue
      const word = String(t.word ?? "").trim()
      const pos = String(t.pos ?? "").trim().toLowerCase()
      if (!["n", "v", "adj"].includes(pos)) continue
      if (!word) continue
      if (lang === "en" ? text.toLowerCase().includes(word.toLowerCase()) : text.includes(word)) {
        const key = word.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        tags.push({ word, pos })
      }
    }
  } catch {
    /* 解析失败返回空 */
  }

  if (tags.length) {
    try { writeCache(cacheKey, { lang, tags }) } catch { /* 缓存写入失败忽略 */ }
  }
  return c.json({ lang, tags })
})

// ── story-elements：中/英课文记叙要素标注（人物/时间/地点/起因/经过/结果，供前端要素着色）──

const STORY_KINDS = new Set(["person", "time", "place", "cause", "process", "result", "event"])

router.post("/ai-chinese/story-elements", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  const lang = String(body?.lang ?? "zh").trim() === "en" ? "en" : "zh"
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  if (text.length > 4000) return c.json({ detail: "文本过长" }, 422)

  // 缓存：同语言同文本不重复调 LLM
  const hash = createHash("sha256").update(`${lang}|${text}`).digest("hex")
  const cacheKey = `${CACHE_DIR}/storyelems_${hash}.json`
  let cached: Record<string, unknown> | null = null
  try { cached = readCache(cacheKey) as Record<string, unknown> | null } catch { /* 缓存读取失败忽略 */ }
  if (cached && Array.isArray(cached.elements)) {
    return c.json({ lang, elements: cached.elements })
  }

  const subject = lang === "en" ? "英语" : "语文"
  const prompt = STORY_ELEMENTS_PROMPT.replace("{subject}", subject).replace("{text}", text)
  let reply = ""
  try {
    reply = await getArk().chat({
      prompt,
      system_prompt: `你是一个只输出 JSON 的小学${subject}老师。`,
      max_tokens: 2048,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
  } catch {
    try {
      reply = await deepseekChat(`你是一个只输出 JSON 的小学${subject}老师。`, prompt, 2048, "story_elements")
    } catch {
      reply = ""
    }
  }

  const elements: { word: string; kind: string }[] = []
  const seen = new Set<string>()
  try {
    const data = JSON.parse((reply || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""))
    const arr = data && Array.isArray(data.elements) ? data.elements : []
    for (const t of arr.slice(0, 200)) {
      if (!t || typeof t !== "object") continue
      const word = String(t.word ?? "").trim()
      const kind = String(t.kind ?? "").trim().toLowerCase()
      if (!STORY_KINDS.has(kind)) continue
      if (!word) continue
      // 只采纳原文连续子串；同一词只留一条（大小写不敏感去重）
      if (lang === "en" ? text.toLowerCase().includes(word.toLowerCase()) : text.includes(word)) {
        const key = word.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        elements.push({ word, kind })
      }
    }
  } catch {
    /* 解析失败返回空 */
  }

  if (elements.length) {
    try { writeCache(cacheKey, { lang, elements }) } catch { /* 缓存写入失败忽略 */ }
  }
  return c.json({ lang, elements })
})

// ── text-ask ──

router.post("/ai-chinese/text-ask", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const context = String(body?.context ?? "").trim()
  const question = String(body?.question ?? "").trim()
  const title = String(body?.title ?? "")
  if (!context) return c.json({ detail: "缺少原文文本" }, 422)
  if (!question) return c.json({ detail: "问题不能为空" }, 422)
  if (question.length > 200) return c.json({ detail: "问题过长" }, 422)
  const contextTrunc = context.slice(0, 4000)
  const prompt = TEXT_ASK_PROMPT.replace("{context}", contextTrunc).replace("{question}", question)
  let raw = ""
  try {
    raw = await getArk().chat({
      prompt,
      system_prompt: "你是一个只输出文字回答的小学语文老师。",
      max_tokens: 2048,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
  } catch {
    raw = await deepseekChat("你是一个只输出文字回答的小学语文老师。", prompt, 2048, "text_ask")
  }
  raw = (raw || "").trim()
  let answer = raw
  let keywords: string[] = []
  const m = raw.match(/【关键字】\s*([^\n【】]+)/)
  if (m) {
    keywords = m[1].replace(/，/g, ",").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 6)
    answer = (raw.slice(0, m.index) + raw.slice((m.index ?? 0) + m[0].length)).trim()
  }
  return c.json({ answer: answer.slice(0, 1000), keywords, source_title: title.slice(0, 80) })
})

// ── mark-unknown-chars ──

router.post("/ai-chinese/mark-unknown-chars", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const chars = (body?.chars ?? []).map(String).map((s: string) => s.trim()).filter((s: string) => s.length === 1)
  if (!chars.length) return c.json({ detail: "chars 不能为空" }, 422)
  const list = chars.slice(0, 100)
  const lesson = String(body?.lesson ?? "").trim().slice(0, 60)
  const now = nowIso()
  for (const ch of list) {
    const existing = db.select().from(charUnknownMarks).where(and(eq(charUnknownMarks.userId, user!.id), eq(charUnknownMarks.char, ch))).get()
    if (existing) {
      db.update(charUnknownMarks).set({ lesson: lesson || existing.lesson, updatedAt: now }).where(eq(charUnknownMarks.id, existing.id)).run()
    } else {
      db.insert(charUnknownMarks).values({ userId: user!.id, char: ch, lesson, createdAt: now, updatedAt: now }).run()
    }
  }
  return c.json({ status: "ok", marked: list.length })
})

// ── char-click ──

router.post("/ai-chinese/char-click", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const chars = (body?.chars ?? []).map(String).map((s: string) => s.trim()).filter(Boolean)
  if (!chars.length) return c.json({ detail: "chars 不能为空" }, 422)
  if (chars.length > 200) return c.json({ detail: "单次上报过多" }, 422)
  const now = nowIso()
  for (const ch of chars.slice(0, 50)) {
    const existing = db.select().from(charClickStats).where(and(eq(charClickStats.userId, user!.id), eq(charClickStats.char, ch))).get()
    if (existing) {
      db.update(charClickStats).set({ clickCount: existing.clickCount + 1, updatedAt: now }).where(eq(charClickStats.id, existing.id)).run()
    } else {
      db.insert(charClickStats).values({ userId: user!.id, char: ch, clickCount: 1, createdAt: now, updatedAt: now }).run()
    }
  }
  return c.json({ status: "ok", recorded: Math.min(chars.length, 50) })
})

// ── pinyin-level ──

router.post("/ai-chinese/pinyin-level", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const unit = String(body?.unit ?? "")
  const count = Math.min(Math.max(Number(body?.count ?? 5), 1), 8)
  let materials = ""
  try {
    const ukRows = db
      .select({ content: chineseUnitKnowledge.content })
      .from(chineseUnitKnowledge)
      .all()
      .filter((r) => r.content)
      .slice(0, 12)
    const tbRows = db
      .select({ content: chineseTextbookPages.content, pageType: chineseTextbookPages.pageType })
      .from(chineseTextbookPages)
      .all()
      .filter((r) => r.content && r.pageType === "课文正文")
      .slice(0, 6)
    materials = [...ukRows.map((r) => String(r.content || "").slice(0, 800)), ...tbRows.map((r) => String(r.content || "").slice(0, 500))].join("\n")
    if (materials.length > 3000) materials = materials.slice(0, 3000)
  } catch (e) {
    console.warn(`[ai-chinese] pinyin-level 取资料失败: ${(e as Error).message}`)
    return c.json({ unit, words: [] })
  }
  if (!materials.trim()) return c.json({ unit, words: [] })
  const prompt = CHINESE_PINYIN_LEVEL_PROMPT.replace("{count}", String(count)).replace("{materials}", materials)
  let data: { words?: { hanzi?: string; pinyin?: string }[] } = {}
  try {
    const reply = await getArk().chat({
      prompt,
      system_prompt: "你是一个只输出JSON的小学语文老师。",
      max_tokens: 1024,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
    data = JSON.parse((reply || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""))
  } catch {
    try {
      const reply = await deepseekChat("你是一个只输出JSON的小学语文老师。", prompt, 1024, "pinyin_level")
      data = JSON.parse((reply || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""))
    } catch {
      data = {}
    }
  }
  const words = (data.words ?? []).slice(0, count)
    .filter((w) => w && w.hanzi && w.pinyin)
    .map((w) => ({ hanzi: w.hanzi!.trim(), pinyin: w.pinyin!.trim(), parts: splitPinyinWord(w.pinyin!.trim()) }))
  return c.json({ unit, words })
})

// ══════════════════════════════════════════════════════════════════
// 以下为 Python routes/ai_chinese.py 对齐移植（46 端点）
// ══════════════════════════════════════════════════════════════════

// ── save-problem / my-imports / problem-image / outline-image ──

router.post("/ai-chinese/save-problem", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少表单" }, 400)
  const question = String(form.get("question") ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)
  const payloadStr = String(form.get("payload") ?? "")

  let imagePath = ""
  const file = form.get("file")
  if (file && typeof file !== "string") {
    const data = Buffer.from(await (file as File).arrayBuffer())
    if (data.length) {
      const fname = `${randomUUID().replace(/-/g, "")}.jpg`
      imagePath = join(PROBLEM_IMAGE_DIR, fname)
      await mkdir(PROBLEM_IMAGE_DIR, { recursive: true })
      await writeFile(imagePath, data)
      try {
        imagePath = await autoOrient(imagePath)
      } catch {
        /* 跳过 */
      }
      imagePath = imagePath.replace(/\\/g, "/")
    }
  }

  let payloadDict: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(payloadStr || "{}")
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payloadDict = parsed as Record<string, unknown>
  } catch {
    payloadDict = {}
  }
  if (imagePath) payloadDict.image_path = imagePath
  const payloadJson = Object.keys(payloadDict).length ? JSON.stringify(payloadDict) : payloadStr

  try {
    const existing = db.select().from(userImports)
      .where(and(eq(userImports.userId, user!.id), eq(userImports.kind, "problem"), eq(userImports.text, question)))
      .get()
    if (existing) {
      db.update(userImports).set({ payload: payloadJson, status: "active", updatedAt: nowIso() })
        .where(eq(userImports.id, existing.id)).run()
      return c.json({ status: "ok", id: existing.id })
    }
    const inserted = db.insert(userImports).values({
      userId: user!.id, kind: "problem", text: question, pinyin: "", meaning: "", tags: "",
      payload: payloadJson, status: "active",
    }).run()
    return c.json({ status: "ok", id: Number(inserted.lastInsertRowid) })
  } catch (e) {
    console.warn("[ai-chinese/save-problem] 入库失败:", (e as Error).message)
    return c.json({ detail: "保存失败，请稍后重试" }, 500)
  }
})

router.get("/ai-chinese/my-imports", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const rows = db.select().from(userImports)
    .where(and(eq(userImports.userId, user!.id), eq(userImports.kind, "problem"), eq(userImports.status, "active")))
    .orderBy(desc(userImports.updatedAt))
    .all()
  const items = rows.map((r) => {
    let topic = ""
    try {
      const p = JSON.parse(r.payload || "{}") || {}
      if (p && typeof p === "object" && !Array.isArray(p)) topic = String((p as Record<string, unknown>).topic ?? "").trim()
    } catch {
      /* ignore */
    }
    return {
      id: r.id,
      text: (r.text || "").slice(0, 2000),
      topic,
      payload: r.payload || "",
      created_at: r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
    }
  })
  return c.json({ items })
})

router.get("/ai-chinese/problem-image/:import_id", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const importId = Number(c.req.param("import_id"))
  if (!Number.isFinite(importId)) return c.json({ detail: "记录不存在" }, 404)
  const row = db.select().from(userImports)
    .where(and(eq(userImports.id, importId), eq(userImports.userId, user!.id), eq(userImports.kind, "problem")))
    .get()
  if (!row) return c.json({ detail: "记录不存在" }, 404)
  let imagePath = ""
  try {
    const p = JSON.parse(row.payload || "{}") || {}
    if (p && typeof p === "object" && !Array.isArray(p)) imagePath = String((p as Record<string, unknown>).image_path ?? "").trim()
  } catch {
    /* ignore */
  }
  if (!imagePath) return c.json({ detail: "无原图" }, 404)
  const resolved = resolveImagePath(imagePath)
  if (!resolved || !existsSync(resolved)) return c.json({ detail: "无原图" }, 404)
  let file = resolved
  try {
    file = await autoCropWhite(resolved)
  } catch {
    /* 用原图 */
  }
  return new Response(new Uint8Array(readFileSync(file)), { headers: { "Content-Type": "image/jpeg" } })
})

router.get("/ai-chinese/outline-image/:source/:item_id", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const source = c.req.param("source")
  const itemId = Number(c.req.param("item_id"))
  if (!["textbook", "unit_knowledge"].includes(source)) return c.json({ detail: "未知来源" }, 422)
  let imagePath = ""
  if (source === "textbook") {
    const row = db.select().from(chineseTextbookPages).where(eq(chineseTextbookPages.id, itemId)).get()
    if (row) imagePath = String(row.imagePath ?? "")
  } else {
    const row = db.select().from(chineseUnitKnowledge).where(eq(chineseUnitKnowledge.id, itemId)).get()
    if (row) imagePath = String(row.imagePath ?? "")
  }
  if (!imagePath) return c.json({ detail: "无原图" }, 404)
  const resolved = resolveImagePath(imagePath)
  if (!resolved || !existsSync(resolved)) return c.json({ detail: "无原图" }, 404)
  return new Response(new Uint8Array(readFileSync(resolved)), { headers: { "Content-Type": "image/jpeg" } })
})

// ── sentence-audio ──

router.post("/ai-chinese/sentence-audio", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少表单" }, 400)
  const sentence = String(form.get("sentence") ?? "").trim()
  if (!sentence) return c.json({ detail: "句子不能为空" }, 422)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少录音文件" }, 422)
  const data = Buffer.from(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "录音为空" }, 422)
  const path = sentenceAudioPath(sentence)
  await mkdir(SENTENCE_AUDIO_DIR, { recursive: true })
  await writeFile(path, data)
  const hash = path.replace(/.*[\\/]/, "").replace(/\.[^.]+$/, "")
  return c.json({ status: "ok", hash })
})

router.get("/ai-chinese/sentence-audio/:audio_hash", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const hash = c.req.param("audio_hash")
  const path = join(SENTENCE_AUDIO_DIR, `${hash}.m4a`)
  if (!existsSync(path)) return c.json({ detail: "还没有该句的录音" }, 404)
  return new Response(new Uint8Array(readFileSync(path)), { headers: { "Content-Type": "audio/mp4" } })
})

router.get("/ai-chinese/sentence-audio/:audio_hash/exists", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const hash = c.req.param("audio_hash")
  return c.json({ exists: existsSync(join(SENTENCE_AUDIO_DIR, `${hash}.m4a`)) })
})

// ── highlight（好词好句） ──

router.post("/ai-chinese/highlight", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  if (text.length > MAX_QUESTION_LEN) return c.json({ detail: "文本过长" }, 422)
  const grade = (user?.grade || "").trim() || "三年级"
  const prompt = CHINESE_HIGHLIGHT_PROMPT.replace("{grade}", grade).replace("{text}", text)
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的小学语文老师。", prompt, 2048, "ai_chinese_highlight", true)
  const words: { text: string; reason: string }[] = []
  const sentences: { text: string; reason: string }[] = []
  const data = parseJsonObj(reply)
  if (data) {
    for (const w of Array.isArray(data.words) ? data.words as unknown[] : []) {
      if (w && typeof w === "object" && String((w as Record<string, unknown>).text ?? "").trim()) {
        words.push({ text: String((w as Record<string, unknown>).text).trim(), reason: String((w as Record<string, unknown>).reason ?? "").trim() })
      }
    }
    for (const s of Array.isArray(data.sentences) ? data.sentences as unknown[] : []) {
      if (s && typeof s === "object" && String((s as Record<string, unknown>).text ?? "").trim()) {
        sentences.push({ text: String((s as Record<string, unknown>).text).trim(), reason: String((s as Record<string, unknown>).reason ?? "").trim() })
      }
    }
  }
  return c.json({ words: words.slice(0, 20), sentences: sentences.slice(0, 8) })
})

// ── polyphones（多音字标注） ──

router.post("/ai-chinese/polyphones", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  if (text.length > MAX_QUESTION_LEN) return c.json({ detail: "文本过长" }, 422)
  const prompt = CHINESE_POLYPHONES_PROMPT.replace("{text}", text)
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的小学语文老师。", prompt, 1024, "ai_chinese_polyphones", true)
  const result: Record<string, string> = {}
  const data = parseJsonObj(reply)
  if (data && data.polyphones && typeof data.polyphones === "object") {
    for (const [k, v] of Object.entries(data.polyphones as Record<string, unknown>)) {
      const ks = String(k ?? "").trim()
      const vs = String(v ?? "").trim()
      if (ks && ks.length === 1 && vs) result[ks] = vs
    }
  }
  return c.json({ polyphones: result })
})

// ── classify（语文页分类） ──

router.post("/ai-chinese/classify", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  const prompt = CHINESE_CLASSIFY_PROMPT.replace("{text}", text.slice(0, 3000))
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的小学语文教研员。", prompt, 2048, "ai_chinese_classify", true)
  const data = parseJsonObj(reply) ?? {}
  return c.json({
    unit: String(data.unit ?? "").trim() || "未分类",
    lesson: String(data.lesson ?? "").trim(),
    category: String(data.category ?? "").trim(),
    page_types: strList(data.page_types),
    page: String(data.page ?? "").trim(),
    knowledge_points: strList(data.knowledge_points),
    question_types: strList(data.question_types),
  })
})

// ── units（语文知识索引） ──

// ── recitations（背诵索引） ──

// ── reading-extract（阅读理解提取） ──

// ── reading-items（阅读题索引） ──

// ── questions-extract / questions-generate / GET questions ──

// ── essay-enrich / essay-extract / essays ──

// ── textbook-extract（课本页元信息） ──

// ── outline（进入大纲） ──

// ── outline-item（大纲条目详情） ──

// ── textbook（课本页查询） ──

// ── page-number（页码识别） ──

// ── wiki/pages（词条查询） ──

// ── wiki/pages/{page_id} ──

// ── PUT wiki/pages/{page_id} ──

// ── knowledge/relations + knowledge/graph/{node_id} ──

// ── search（FTS5 全文搜索） ──

// ── kb-ask（知识库问答） ──

router.post("/ai-chinese/kb-ask", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "问题不能为空" }, 422)
  if (question.length > 200) return c.json({ detail: "问题过长" }, 422)

  // 全文检索
  let results: { id: number; ptype: string; title: string; snippet: string }[] = []
  try {
    const pattern = `"${question.replace(/"/g, "")}"`
    const rows = sqlite.prepare(
      "SELECT src_type AS stype, src_id AS sid, snippet(chinese_fts, 0, '【', '】', '…', 24) AS snip FROM chinese_fts WHERE chinese_fts MATCH ? ORDER BY rank LIMIT 8"
    ).all(pattern) as { stype: string; sid: number; snip: string }[]
    results = rows.map((r) => ({ id: r.sid, ptype: r.stype, title: searchTitle(r.stype, r.sid), snippet: r.snip || "" }))
  } catch (e) {
    console.warn("[ai-chinese/kb-ask] 检索失败:", (e as Error).message)
  }
  if (!results.length) return c.json({ answer: "没找到相关内容，换个问法试试", keywords: [], source_title: "" })

  const titles: string[] = []
  const chunks: string[] = []
  for (const r of results.slice(0, 6)) {
    if (r.title) titles.push(r.title)
    if (r.snippet.trim()) chunks.push(`${r.title || r.ptype}：${r.snippet.trim()}`)
  }
  const context = chunks.join("\n").slice(0, 3000)
  const prompt = KB_ASK_PROMPT.replace("{context}", context).replace("{question}", question)
  // BudgetExceededError 不捕获 → 全局 429
  const raw = (await deepseekChat("你是一个只输出文字回答的小学语文老师。", prompt, 2048, "ai_chinese_kb_ask", true)).trim()
  let answer = raw
  let keywords: string[] = []
  const m = raw.match(/【关键字】\s*([^\n【】]+)/)
  if (m) {
    keywords = m[1].replace(/，/g, ",").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 6)
    answer = (raw.slice(0, m.index) + raw.slice((m.index ?? 0) + m[0].length)).trim()
  }
  const src = [...new Set(titles.filter(Boolean))].join("、").slice(0, 100)
  return c.json({ answer: answer.slice(0, 1000), keywords, source_title: src })
})

// ── analyze（关键信息标注 + 数量关系） ──

router.post("/ai-chinese/analyze", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)
  if (question.length > MAX_QUESTION_LEN) return c.json({ detail: `题目过长（最多 ${MAX_QUESTION_LEN} 字）` }, 422)
  const forceRefresh = Boolean(body?.force_refresh)

  const qHash = createHash("sha256").update(question).digest("hex")
  const cacheFile = join(CACHE_DIR, `analyze_${qHash}.json`)
  const cached = readCache(cacheFile)
  if (cached && !forceRefresh) {
    return c.json({
      topic: String(cached.topic ?? ""),
      sentences: Array.isArray(cached.sentences) ? cached.sentences : [],
      total_key_points: Number(cached.total_key_points ?? 0),
      quantities: Array.isArray(cached.quantities) ? cached.quantities : [],
      relations: Array.isArray(cached.relations) ? cached.relations : [],
      questions: Array.isArray(cached.questions) ? cached.questions : [],
    })
  }

  const sentences = splitSentences(question)
  const prompt = renderAnalyze(question, sentences)
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的数学应用题分析助手。", prompt, 8192, "ai_chinese_analyze", true)

  let marks: Record<string, unknown>[] = []
  let quantities: Record<string, unknown>[] = []
  let relations: Record<string, unknown>[] = []
  let questionsRaw: Record<string, unknown>[] = []
  try {
    const candidate = stripFence(reply)
    const data = JSON.parse(candidate)
    if (Array.isArray(data)) {
      marks = data.filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
    } else if (data && typeof data === "object") {
      const d = data as Record<string, unknown>
      if (Array.isArray(d.marks)) marks = (d.marks as unknown[]).filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
      if (Array.isArray(d.quantities)) quantities = (d.quantities as unknown[]).filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      if (Array.isArray(d.relations)) relations = (d.relations as unknown[]).filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      if (Array.isArray(d.questions)) questionsRaw = (d.questions as unknown[]).filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    }
  } catch {
    console.warn("[ai-chinese/analyze] LLM 输出非 JSON，降级为无标注")
  }

  const out = sentences.map((s, i) => {
    const m = (i < marks.length ? marks[i] : {}) as Record<string, unknown>
    const isKey = Boolean(m.is_key ?? false)
    let highlight = String(m.highlight ?? "")
    if (!isKey) highlight = ""
    return { text: s, is_key: isKey, highlight }
  })

  const qOut: { name: string; value: number | null; unit: string }[] = []
  for (const q of quantities) {
    const name = String(q.name ?? "").trim()
    if (!name) continue
    const raw = q.value
    let value: number | null = null
    if (raw != null) {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      value = n
    }
    qOut.push({ name, value, unit: String(q.unit ?? "").trim() })
  }

  const rOut: { a: string; b: string; type: string; amount: number; parts: string[] }[] = []
  for (const r of relations) {
    const a = String(r.a ?? "").trim()
    const b = String(r.b ?? "").trim()
    const rtype = String(r.type ?? "")
    if (!["more", "less", "times", "total"].includes(rtype)) continue
    if (rtype === "total") {
      const parts = Array.isArray(r.parts) ? r.parts.map(String).map((s) => s.trim()).filter(Boolean) : []
      if (!parts.length) continue
      rOut.push({ a, b, type: rtype, amount: 0, parts })
      continue
    }
    if (!a || !b) continue
    const amount = Number(r.amount ?? 0)
    if (!Number.isFinite(amount)) continue
    rOut.push({ a, b, type: rtype, amount, parts: [] })
  }

  // 兜底 total 关系
  if (/一共|总共|合计|共有|总共有/.test(question)) {
    const knownItems = qOut.filter((q) => q.value !== null)
    const unknownItems = qOut.filter((q) => q.value === null)
    if (knownItems.length >= 2) {
      const totalRels = rOut.filter((r) => r.type === "total")
      if (!totalRels.length) {
        let target = unknownItems[0] ?? null
        if (!target) {
          target = { name: "一共", value: null, unit: knownItems[0].unit }
          qOut.push(target)
        }
        if (target.value === null) {
          rOut.push({ a: target.name, b: "", type: "total", amount: 0, parts: knownItems.map((k) => k.name) })
        }
      } else {
        const tr = totalRels[0]
        const aOk = unknownItems.some((u) => tr.a === u.name || tr.a.includes(u.name) || u.name.includes(tr.a))
        if (!aOk && unknownItems.length) tr.a = unknownItems[0].name
        if (!tr.parts.length) tr.parts = knownItems.map((k) => k.name)
      }
    }
  }

  const questionsOut = questionsRaw
    .filter((q) => String(q.text ?? "").trim())
    .map((q) => ({
      text: String(q.text ?? "").trim(),
      target: String(q.target ?? "").trim(),
      needs: Array.isArray(q.needs) ? q.needs.map(String).map((s) => s.trim()).filter(Boolean) : [],
      hint: String(q.hint ?? "").trim(),
    }))

  const resp = {
    topic: "数学应用题",
    sentences: out,
    total_key_points: out.filter((s) => s.is_key).length,
    quantities: qOut,
    relations: rOut,
    questions: questionsOut,
  }
  writeCache(cacheFile, resp)
  return c.json(resp)
})

// ── unknown-chars + char-click/stats ──

router.get("/ai-chinese/unknown-chars", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  try {
    const rows = db.select({ char: charUnknownMarks.char }).from(charUnknownMarks)
      .where(eq(charUnknownMarks.userId, user!.id))
      .orderBy(desc(charUnknownMarks.updatedAt))
      .all()
    return c.json({ chars: rows.map((r) => r.char) })
  } catch (e) {
    console.warn("[ai-chinese/unknown-chars] 查询失败:", (e as Error).message)
    return c.json({ chars: [] })
  }
})

router.get("/ai-chinese/char-click/stats", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  try {
    const rows = db.select().from(charClickStats)
      .where(eq(charClickStats.userId, user!.id))
      .orderBy(desc(charClickStats.clickCount), charClickStats.id)
      .all()
    const totalClicks = rows.reduce((a, r) => a + r.clickCount, 0)
    return c.json({
      total_chars: rows.length,
      total_clicks: totalClicks,
      items: rows.slice(0, 200).map((r) => ({ char: r.char, count: r.clickCount })),
    })
  } catch (e) {
    console.warn("[ai-chinese/char-click stats] 查询失败:", (e as Error).message)
    return c.json({ total_chars: 0, total_clicks: 0, items: [] })
  }
})

// ── quest 闯关（复用 lib/quest_graph.ts 状态机） ──

// ── evaluate（思路评判） ──

router.post("/ai-chinese/evaluate", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  const answer = String(body?.answer ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)
  if (!answer) return c.json({ detail: "请先说出你的思路" }, 422)
  if (question.length > MAX_QUESTION_LEN || answer.length > 2000) return c.json({ detail: "内容过长" }, 422)

  const prompt =
    `你是小学数学老师。学生口述了解题思路，请判断思路是否正确并给出反馈。\n` +
    `规则：1) 只点评思路本身（先算什么、再算什么、用了什么数量关系），不演算、不给答案数字；\n` +
    `2) 思路正确则肯定并表扬；3) 部分正确则指出哪一步对、哪一步需要重新想；\n` +
    `4) 完全错误则温和引导，提示重新读关键条件，但绝不替学生解题。\n` +
    `只输出JSON：{"verdict": "correct|partial|wrong", "feedback": "对学生的直接反馈（简洁、鼓励性、中文）", "suggestion": "下一步思考方向（一句话，不给过程）"}\n\n` +
    `题目：${question}\n学生思路：${answer}`
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON、只点评思路不演示解题的小学数学老师。", prompt, 4096, "ai_chinese_evaluate")

  const data = parseJsonObj(reply)
  if (data) {
    let verdict = String(data.verdict ?? "partial")
    if (!["correct", "partial", "wrong"].includes(verdict)) verdict = "partial"
    return c.json({
      verdict,
      feedback: String(data.feedback ?? "老师听清了你的思路！"),
      suggestion: String(data.suggestion ?? ""),
    })
  }
  return c.json({ verdict: "partial", feedback: "老师刚才走神了，请再说一遍你的思路～", suggestion: "" })
})

// ── steps（分步解题） ──

router.post("/ai-chinese/steps", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)
  const target = String(body?.target ?? "").trim()

  const cacheKey = createHash("sha256").update(`${question}|${target}`).digest("hex")
  const cacheFile = join(CACHE_DIR, `steps_${cacheKey}.json`)
  const cached = readCache(cacheFile)
  if (cached && Array.isArray(cached.steps)) {
    return c.json({ steps: cached.steps })
  }

  const targetLine = target ? `\n（注意：当前要解决的是『${target}』这个问题，解题链以算出它为目标）` : ""
  const prompt =
    `你是小学数学老师。把这道题拆成【分步解题步骤】，每步是一个独立的小目标：\n` +
    `先分析要求什么，再想需要什么条件，一步一步列算式算出中间结果，最后得出结论。\n` +
    `对每一步输出：purpose=这一步想算什么（为什么算它，写清这一步在整个解题链中的作用），` +
    `formula=算式文字（完整算式，带单位和运算过程，如『(340-240)÷(10-9)=100（千米/时）』），` +
    `result=这一步的中间结果（数字字符串；结论步填最终答案，可能是『能』『不能』『不够』等文字），` +
    `result_unit=结果单位（千米/时、千米、个等；结论步填空字符串），` +
    `explain=为什么这样算（讲清数量关系逻辑，两句话：先说根据哪个条件，再说这样算得到什么），\n` +
    `from=这一步主要依据的关键条件（用题目原句或它的简短摘要，如『10:00时距南宁340千米』；结论步可为空）。\n` +
    `最后一步是结论步：purpose 写『回答问题』，result 写最终结论，explain 写结论依据（引用关键条件）。\n` +
    `【步骤要详细】步骤数量一般 3-5 步，宁可拆细不要合并：凡是有独立中间结果的计算（求差、求倍、求速度、` +
    `求单份等）都必须单独成步；每步的 formula 写完整算式（含数字、运算、单位），explain 讲清这一步为什么这样算、` +
    `依据哪个条件、得到什么含义。\n` +
    `只输出JSON：{"steps": [{"purpose": "...", "formula": "...", "result": "100", "result_unit": "千米/时", ` +
    `"explain": "...", "from": "10:00时距南宁340千米"}]}` +
    `${targetLine}\n题目：${question}`
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await deepseekChat("你是一个只输出JSON的小学数学老师。", prompt, 4096, "ai_chinese_steps")

  const stepsOut: Record<string, unknown>[] = []
  const data = parseJsonObj(reply)
  if (data) {
    const raw = Array.isArray((data as Record<string, unknown>).steps)
      ? (data as Record<string, unknown>).steps as unknown[]
      : (Array.isArray(data) ? data as unknown[] : [])
    for (const s of raw) {
      if (!s || typeof s !== "object") continue
      const obj = s as Record<string, unknown>
      const purpose = String(obj.purpose ?? "").trim()
      if (!purpose) continue
      stepsOut.push({
        purpose,
        formula: String(obj.formula ?? "").trim(),
        result: String(obj.result ?? "").trim(),
        result_unit: String(obj.result_unit ?? "").trim(),
        explain: String(obj.explain ?? "").trim(),
        draw: obj.draw && typeof obj.draw === "object" ? obj.draw : null,
        source: String(obj.source ?? obj.from ?? "").trim(),
      })
    }
  }
  if (stepsOut.length) writeCache(cacheFile, { steps: stepsOut })
  return c.json({ steps: stepsOut })
})

// ── POST questions（问题列表提取） ──

// 子路由透明合并进本 router（共享同一 /api/v1 根）
router.route("/", kbRoutes)
router.route("/", questRoutes)
router.route("/", textbookRoutes)
router.route("/", questionsRoutes)

export default router
