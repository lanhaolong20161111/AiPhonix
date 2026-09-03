/** AI 作业路由 — /api/v1/ai-homework/*（对齐 Python routes/ai_homework.py，22 端点）
 *
 * 数学应用题练习：拍照识题 → 关键信息标注 → 思路评判 → 闯关 → 搭积木
 * - LLM 调用走 chat()（免费 Ark 优先，付费 DeepSeek 回退，预算守卫统一）
 * - 缓存按内容 SHA-256 落盘（data/ai_homework_cache/），重启不丢
 * - 闯关状态机 lib/quest_graph.ts 持久化到 quest_sessions 表
 */
import { Hono } from "hono"
import { createHash, randomUUID } from "node:crypto"
import { writeFile, mkdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { and, desc, eq } from "drizzle-orm"
import { resolveCurrentUser } from "../middleware/auth.js"
import { getArk } from "../lib/ark.js"
import { autoOrient, compressImageToFile } from "../lib/image.js"
import { ocrChain } from "../lib/ocr.js"
import {
  cleanOcrText, dedupeLines, recoverTextFromJson, splitQuestions, splitSentences,
} from "../lib/aiTextUtils.js"
import { chat } from "../lib/deepseek.js"
import { readJson, writeJson } from "../lib/jsonfile.js"
import { DATA_DIR } from "../env.js"
import { db } from "../db/index.js"
import { userImports, charClickStats, questSessions } from "../db/schema.js"
import * as quest from "../lib/quest_graph.js"

import { stripFence, parseJsonObj, readCache, writeCache, renderAnalyze, makeSentenceAudioPath } from "../lib/aiShared.js"

import { multimodalModel } from "../lib/aiChineseContext.js"

import { MATH_OCR_PROMPT } from "../lib/prompts.js"
import questRoutes from "./ai_homework_quest.js"
const router = new Hono()
const IMAGE_DIR = join(DATA_DIR, "ai_homework_images")
const CACHE_DIR = join(DATA_DIR, "ai_homework_cache")
const SENTENCE_AUDIO_DIR = join(DATA_DIR, "ai_homework_sentence_audio")
const sentenceAudioPath = makeSentenceAudioPath(SENTENCE_AUDIO_DIR)
const PROBLEM_IMAGE_DIR = join(DATA_DIR, "ai_homework_problems")
const MAX_QUESTION_LEN = 2000
const IMG_MAX_EDGE = 800
const IMG_QUALITY = 70

// ── 识图提示词 ──


function mathClean(s: string): string {
  let t = s || ""
  t = t.replace(/[\ufffd\u25af\u2588\u258c\u2580\u2590]/g, "")
  t = t.replace(/\$+\^?\{?([^$]*?)\}?\$+/g, "$1")
  t = t.replace(/\$+/g, "")
  t = t.replace(/\\text\{([^{}]*)\}/g, "$1")
  t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
  t = t.replace(/<sub>([^<]*)<\/sub>/gi, "$1")
  t = t.replace(/<sup>([^<]*)<\/sup>/gi, "$1")
  return t
}

// ── 缓存工具 ──


// ── JSON 提取 ──


function numOr(v: unknown, dflt = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

// ── render_analyze 提示词（对齐 prompts_aihomework.py） ──


// ── 1. save-problem ──

router.post("/ai-homework/save-problem", async (c) => {
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
      db.update(userImports).set({ payload: payloadJson, status: "active", updatedAt: new Date().toISOString() })
        .where(eq(userImports.id, existing.id)).run()
      return c.json({ status: "ok", id: existing.id })
    }
    const inserted = db.insert(userImports).values({
      userId: user!.id, kind: "problem", text: question, pinyin: "", meaning: "", tags: "",
      payload: payloadJson, status: "active",
    }).run()
    return c.json({ status: "ok", id: Number(inserted.lastInsertRowid) })
  } catch (e) {
    console.warn("[save-problem] 入库失败:", (e as Error).message)
    return c.json({ detail: "保存失败，请稍后重试" }, 500)
  }
})

// ── 2/3/4. sentence-audio ──


router.post("/ai-homework/sentence-audio", async (c) => {
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

router.get("/ai-homework/sentence-audio/:hash", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const hash = c.req.param("hash")
  const path = join(SENTENCE_AUDIO_DIR, `${hash}.m4a`)
  if (!existsSync(path)) return c.json({ detail: "还没有该句的录音" }, 404)
  const buf = readFileSync(path)
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "audio/mp4" } })
})

router.get("/ai-homework/sentence-audio/:hash/exists", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const hash = c.req.param("hash")
  return c.json({ exists: existsSync(join(SENTENCE_AUDIO_DIR, `${hash}.m4a`)) })
})

// ── 5. parse-image（已存在，保留并增强） ──

router.post("/ai-homework/parse-image", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400)
  const data = Buffer.from(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "图片为空" }, 422)
  const noCache = c.req.query("no_cache") === "true"

  const imgHash = createHash("sha256").update(data).digest("hex")
  const cacheFile = join(CACHE_DIR, `parse_${imgHash}.json`)
  if (!noCache && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf-8"))
      const cachedText = cleanOcrText(recoverTextFromJson(String(cached.text ?? ""))).trim()
      const deduped = dedupeLines(cachedText).trim()
      const cachedQs = (cached.questions ?? []).map(String).filter(Boolean)
      return c.json({
        text: deduped,
        questions: cachedQs.length ? cachedQs : deduped ? [deduped] : [],
        blocks: Array.isArray(cached.blocks) ? cached.blocks : [],
        page_bounds: cached.page_bounds ?? null,
        crops: Array.isArray(cached.crops) ? cached.crops : [],
      })
    } catch {
      /* 缓存损坏忽略 */
    }
  }

  const ext = (file as File).name?.match(/\.([a-zA-Z0-9]+)$/)?.[1] ? "." + (file as File).name!.match(/\.([a-zA-Z0-9]+)$/)![1] : ".jpg"
  const fname = `${randomUUID().replace(/-/g, "")}${ext}`
  await mkdir(IMAGE_DIR, { recursive: true })
  const path = join(IMAGE_DIR, fname)
  await writeFile(path, data)
  let oriented = path
  try {
    oriented = await autoOrient(path)
  } catch {
    /* 跳过 */
  }

  // 图片预分类已移除（原 Python OpenCV classifyImage）。
  // 豆包多模态 OCR 能直接处理截图/拍照，无需裁剪 UI 残留。

  let text = ""
  let blocks: unknown[] = []
  let arkErr: string | null = null
  let ocrErr: string | null = null
  try {
    const compressed = await compressImageToFile(oriented, join(IMAGE_DIR, `${fname.replace(/\.[^.]+$/, "")}.region.jpg`), 2000, 90)
    const reply = await getArk().chat({
      prompt: MATH_OCR_PROMPT,
      image_paths: [compressed],
      max_tokens: 4096,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
    const rawText = mathClean(reply || "").trim()
    text = dedupeLines(rawText).trim()
  } catch (e) {
    arkErr = (e as Error).message
    console.warn(`[ai-homework] 豆包识图失败: ${arkErr}`)
    // 回退 OCR API 链（腾讯云 → 百度），失败则保持空文本
    try {
      const ocrText = await ocrChain(oriented)
      if (ocrText) {
        text = dedupeLines(mathClean(ocrText)).trim()
        console.warn(`[ai-homework] OCR API 回退成功, 文本长度 ${text.length}`)
      }
    } catch (e2) {
      ocrErr = (e2 as Error).message
      console.warn(`[ai-homework] OCR API 回退失败: ${ocrErr}`)
    }
  }

  text = mathClean(text).trim()
  text = recoverTextFromJson(text).trim()
  if (!text) {
    const diag = `豆包识图:${arkErr || "成功但无文本"}` + (ocrErr ? `；OCR回退:${ocrErr}` : "")
    return c.json({ detail: `图片识别失败（诊断：${diag}）` }, 422)
  }
  const questions = splitQuestions(text)
  const crops: unknown[] = []
  const cachePayload = { text, questions, blocks, page_bounds: null, crops }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile, JSON.stringify(cachePayload), "utf-8")
  return c.json({ text, questions, blocks, page_bounds: null, crops })
})

// ── 6. analyze（关键信息标注 + 数量关系提取） ──

router.post("/ai-homework/analyze", async (c) => {
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
  // chat 可能抛 BudgetExceededError → 全局 429（不在此捕获）
  const reply = await chat("你是一个只输出JSON的数学应用题分析助手。", prompt, 8192, "ai_homework_analyze", true)

  // 解析标注与数量关系
  let marks: Record<string, unknown>[] = []
  let quantities: Record<string, unknown>[] = []
  let relations: Record<string, unknown>[] = []
  let questionsRaw: Record<string, unknown>[] = []

  const data = parseJsonObj(reply)
  if (data) {
    if (Array.isArray((data as Record<string, unknown>).marks)) {
      marks = ((data as Record<string, unknown>).marks as unknown[]).filter((m): m is Record<string, unknown> => m != null && typeof m === "object") as Record<string, unknown>[]
    }
    if (Array.isArray((data as Record<string, unknown>).quantities)) {
      quantities = ((data as Record<string, unknown>).quantities as unknown[]).filter((q): q is Record<string, unknown> => q != null && typeof q === "object") as Record<string, unknown>[]
    }
    if (Array.isArray((data as Record<string, unknown>).relations)) {
      relations = ((data as Record<string, unknown>).relations as unknown[]).filter((r): r is Record<string, unknown> => r != null && typeof r === "object") as Record<string, unknown>[]
    }
    if (Array.isArray((data as Record<string, unknown>).questions)) {
      questionsRaw = ((data as Record<string, unknown>).questions as unknown[]).filter((q): q is Record<string, unknown> => q != null && typeof q === "object") as Record<string, unknown>[]
    }
  }

  const out = sentences.map((s, i) => {
    const m = (i < marks.length ? marks[i] : {}) as Record<string, unknown>
    const isKey = Boolean(m.is_key ?? false)
    let highlight = String(m.highlight ?? "")
    if (!isKey) highlight = ""
    return { text: s, is_key: isKey, highlight }
  })

  // 数量实体：value 必须是数字或 null
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

  // 关系
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
    const amount = numOr(r.amount, 0)
    if (!Number.isFinite(amount)) continue
    rOut.push({ a, b, type: rtype, amount, parts: [] })
  }

  // 兜底：题目含"一共/总共/合计/共有"时保证 total 关系存在
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

// ── 7. char-click（记录点击） ──

router.post("/ai-homework/char-click", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const charsRaw: unknown[] = Array.isArray(body?.chars) ? body.chars : []
  const chars = charsRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
  if (!chars.length) return c.json({ detail: "chars 不能为空" }, 422)
  if (chars.length > 200) return c.json({ detail: "单次上报过多（最多 200 字）" }, 422)

  try {
    for (const ch of chars.slice(0, 50)) {
      const existing = db.select().from(charClickStats)
        .where(and(eq(charClickStats.userId, user!.id), eq(charClickStats.char, ch)))
        .get()
      if (existing) {
        db.update(charClickStats)
          .set({ clickCount: existing.clickCount + 1, updatedAt: new Date().toISOString() })
          .where(eq(charClickStats.id, existing.id)).run()
      } else {
        db.insert(charClickStats).values({ userId: user!.id, char: ch, clickCount: 1 }).run()
      }
    }
  } catch (e) {
    console.warn("[char-click] 入库失败:", (e as Error).message)
    return c.json({ detail: "记录失败，请稍后重试" }, 500)
  }
  return c.json({ status: "ok", recorded: Math.min(chars.length, 50) })
})

// ── 8. char-click/stats ──

router.get("/ai-homework/char-click/stats", async (c) => {
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
    console.warn("[char-click stats] 查询失败:", (e as Error).message)
    return c.json({ total_chars: 0, total_clicks: 0, items: [] })
  }
})

// ── 9. quest/start ──

// ── 10. quest/step ──

// ── 11. quest/sessions ──

// ── 12. quest/continue ──

// ── 13. quest/retry-errors ──

// ── 14. quest/report/:session_id ──

// ── 15. quest/history/:session_id ──

// ── 16. quest/replay ──

// ── 17. evaluate（思路评判） ──

router.post("/ai-homework/evaluate", async (c) => {
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
  const reply = await chat("你是一个只输出JSON、只点评思路不演示解题的小学数学老师。", prompt, 4096, "ai_homework_evaluate")

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

// ── 18. steps（分步解题） ──

router.post("/ai-homework/steps", async (c) => {
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
  const reply = await chat("你是一个只输出JSON的小学数学老师。", prompt, 4096, "ai_homework_steps")

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

// ── 19. questions（问题列表提取） ──

router.post("/ai-homework/questions", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)

  const cacheFile = join(CACHE_DIR, `questions_${createHash("sha256").update(question).digest("hex")}.json`)
  const cached = readCache(cacheFile)
  if (cached && Array.isArray(cached.questions)) {
    return c.json({ topic: "", sentences: [], total_key_points: 0, quantities: [], relations: [], questions: cached.questions })
  }

  const prompt =
    `找出这道数学题里的【所有问题】（问题=要求学生求解的内容，一句多问/追问都算，一个不能漏）。\n` +
    `输出 JSON：{"questions":[{"text":"问题原文","target":"要求解的量","needs":["需要先知道的量"],"hint":"求解方向，不给答案"}]}\n` +
    `【输出精简】JSON 无多余空格。\n题目：` + question
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await chat("你是一个只输出JSON的小学数学老师。", prompt, 4096, "ai_homework_questions")

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
  if (qOut.length) writeCache(cacheFile, { questions: qOut })
  return c.json({ topic: "", sentences: [], total_key_points: 0, quantities: [], relations: [], questions: qOut })
})

// ── 20. blocks-suggest（动态积木建议） ──

function parseBlocks(rawReply: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const data = parseJsonObj(rawReply)
  if (!data || !Array.isArray((data as Record<string, unknown>).blocks)) return out
  const allowed = ["multi-segment", "line", "rect", "circle", "text", "brace"]
  for (const b of (data as Record<string, unknown>).blocks as unknown[]) {
    if (!b || typeof b !== "object") continue
    const obj = b as Record<string, unknown>
    const btype = String(obj.type ?? "").trim()
    if (!allowed.includes(btype)) continue
    const name = String(obj.name ?? "").trim()
    if (!name) continue
    const params = obj.params && typeof obj.params === "object"
      ? Object.fromEntries(Object.entries(obj.params as Record<string, unknown>).map(([k, v]) => [String(k), String(v)]))
      : {}
    out.push({
      type: btype, name,
      description: String(obj.description ?? "").trim(),
      params,
      usage: String(obj.usage ?? "").trim(),
    })
  }
  return out
}

router.post("/ai-homework/blocks-suggest", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)

  const cacheFile = join(CACHE_DIR, `blocks_${createHash("sha256").update(question).digest("hex")}.json`)
  const cached = readCache(cacheFile)
  if (cached && Array.isArray(cached.blocks)) {
    return c.json({ blocks: cached.blocks })
  }

  const prompt =
    `你是小学数学线段图设计助手。学生正在用积木搭这道题的数量关系图，` +
    `内置积木有：线段、虚线线段、四种大括号（↓↑←→）、节点圆、数值标签、自由文本。\n` +
    `请严格按下面的判定标准，找出题目需要哪些【内置积木表达不了】的结构：\n` +
    `- 是…的几倍/倍 关系（如『科技书的本数是故事书的3倍』）→ **必须生成** 倍数条（multi-segment，` +
    `segments=倍数），因为内置线段只能表示长度比例，表达不了『分成几段、每段相等』的倍数语义；\n` +
    `- 平均分成几份/平均分（如『把90个苹果平均分给3个班』）→ **必须生成** 均分条（multi-segment，segments=份数）；\n` +
    `- 两个量合并成总数 → 内置大括号已足够，**不要生成**；\n` +
    `- 多几个/少几个的差值比较 → 内置虚线线段已足够，**不要生成**；\n` +
    `- 两个量都是未知、只给关系（如『甲是乙的一半』）→ 生成半段条（multi-segment，segments=2）。\n` +
    `其余情况如果确实没有倍数/均分等结构，返回空列表（别硬造）。最多返回 3 个，只返回真正必要的。\n` +
    `输出 JSON：{"blocks":[{"type":"multi-segment|line|rect|circle|text|brace","name":"积木名（如 倍数条）",` +
    `"description":"用途一句话","params":{"color":"默认颜色 green/blue/red/black","segments":"分段数(仅multi-segment)","unit":"单位(如有)"},` +
    `"usage":"学生拿到后怎么搭（一句话）"}]}\n` +
    `【输出精简】JSON 无多余空格。\n题目：` + question
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await chat("你是一个只输出JSON的小学数学线段图设计助手。", prompt, 4096, "ai_homework_blocks")

  let blocksOut = parseBlocks(reply)
  if (!blocksOut.length) {
    try {
      const reply2 = await chat("你是一个只输出JSON的小学数学线段图设计助手。", prompt, 4096, "ai_homework_blocks")
      blocksOut = parseBlocks(reply2)
    } catch (e) {
      if ((e as { budget?: boolean }).budget) throw e
    }
  }
  if (blocksOut.length) writeCache(cacheFile, { blocks: blocksOut })
  return c.json({ blocks: blocksOut })
})

// ── 21. build-review（搭积木审核） ──

router.post("/ai-homework/build-review", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  const blocksRaw: unknown[] = Array.isArray(body?.blocks) ? body.blocks : []
  const blocks = blocksRaw.filter((b): b is Record<string, unknown> => b != null && typeof b === "object" && String((b as Record<string, unknown>).kind ?? "").trim() !== "")
  if (!question) return c.json({ detail: "题目不能为空" }, 422)
  if (!blocks.length) return c.json({ detail: "画布还是空的，先搭几个积木再提交吧" }, 422)

  const blockLines: string[] = []
  blocks.forEach((b, i) => {
    const parts: string[] = [`kind=${String(b.kind ?? "")}`, `label=${String(b.label ?? "")}`]
    const value = String(b.value ?? "")
    if (value) parts.push(`value=${value}${String(b.unit ?? "")}`)
    const direction = String(b.direction ?? "")
    if (direction) parts.push(`direction=${direction}`)
    const type = String(b.type ?? "")
    if (type) parts.push(`type=${type}`)
    const segments = Number(b.segments ?? 0)
    if (segments > 1) parts.push(`segments=${segments}（平均切成N份，总量不变）`)
    const times = Number(b.times ?? 0)
    if (times > 1) parts.push(`times=${times}（N段等长复制拼接，N倍关系）`)
    const extra = Number(b.extra ?? 0)
    if (extra > 0) parts.push(`extra=${extra}（${String(b.extra_dir) === "left" ? "向左" : "向右"}绿色虚线延长段，表示增加/多出）`)
    const note = String(b.note ?? "")
    if (note) parts.push(`语义=${note}`)
    blockLines.push(`${i + 1}. ` + parts.join("，"))
  })

  const prompt =
    `你是小学数学线段图老师。学生用积木搭了一张数量关系图，请审核它是否满足题目要求。\n` +
    `积木含义：segment=线段（表示一个量，label=名称，value=数值，空=未知量）；` +
    `segment 的 segments=N 表示平均切成 N 份（总量不变）；times=N 表示 N 段等长复制拼接（N 倍关系）；` +
    `extra=N 表示端部绿色虚线延长段（增加/多出的量，extra_dir 说明向左还是向右）；` +
    `dashed_segment=虚线线段（表示差值/关系标注）；` +
    `brace=大括号（框住几个量表示合并/一共，direction 是开口方向，label 是标注文字）；` +
    `node_circle=节点圆（label=名称）；value_label=数值标签；text=自由文本；` +
    `person=小人（表示一个人，label=名字，通常放在线段端点表示谁的量）；` +
    `dynamic=自定义积木（type 说明结构）。\n` +
    `审核要点：1) 题目里的每个已知量是否都有对应积木、数值是否正确；` +
    `2) 题目所求的未知量是否用空数值线段/节点圆标出；` +
    `3) 数量关系表达是否正确（大括号合并=相加、虚线=差值、倍数结构=分段）；` +
    `4) 有没有画错、多余或遗漏的量。\n` +
    `只点评图与题目的对应关系，不替学生算答案数字（未知量就说是未知量，别给出数字）。\n` +
    `输出 JSON：{"passed": true或false, "feedback":"对学生的整体反馈（简洁鼓励，中文，一句话）",` +
    `"issues":[{"message":"问题描述（具体指出哪个积木/哪个量）","fix":"怎么改（温和、具体、不给答案数字）"}],` +
    `"suggestions":["改进建议（每句一条，最多3条）"]}\n` +
    `passed=true 时 issues 给空列表。\n\n` +
    `题目：${question}\n\n学生搭的积木图：\n` + blockLines.join("\n")
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await chat("你是一个只输出JSON、只点评图不替学生算答案的小学数学线段图老师。", prompt, 4096, "ai_homework_build_review")

  const data = parseJsonObj(reply)
  if (data) {
    const issuesRaw = Array.isArray((data as Record<string, unknown>).issues) ? (data as Record<string, unknown>).issues as unknown[] : []
    const issues = issuesRaw
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && String((x as Record<string, unknown>).message ?? "").trim() !== "")
      .map((x) => ({ message: String(x.message ?? "").trim(), fix: String(x.fix ?? "").trim() }))
    const suggestionsRaw = Array.isArray((data as Record<string, unknown>).suggestions) ? (data as Record<string, unknown>).suggestions as unknown[] : []
    const suggestions = suggestionsRaw.map(String).map((s) => s.trim()).filter(Boolean)
    return c.json({
      passed: Boolean((data as Record<string, unknown>).passed),
      feedback: String((data as Record<string, unknown>).feedback ?? "老师看过了，再对照题目检查一下～"),
      issues,
      suggestions,
    })
  }
  return c.json({ passed: false, feedback: "老师刚才走神了，请再提交一次～", issues: [], suggestions: [] })
})

// ── 22. build-auto（自动搭建指令） ──

router.post("/ai-homework/build-auto", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)

  const cacheFile = join(CACHE_DIR, `build_${createHash("sha256").update(question).digest("hex")}.json`)
  const cached = readCache(cacheFile)
  if (cached) {
    return c.json({
      segments: Array.isArray(cached.segments) ? cached.segments : [],
      relation: String(cached.relation ?? "none"),
      diff: cached.diff ?? null,
      times: cached.times ?? null,
      brace: cached.brace ?? null,
    })
  }

  const prompt =
    `你是小学数学线段图构建助手。根据题目输出线段图【初始搭建指令】：\n` +
    `1) segments：题目里的每个数量一条（label=名称，value=数值，unit=单位；` +
    `题目所求的未知量 value=null、is_unknown=true）。所有已知量和未知量必须全部列出，一个不漏；\n` +
    `2) relation：判断数量关系类型——total=整体-部分（求和/一共）、diff=差值对比（多/少）、` +
    `times=倍数关系（是…的几倍）、none=其他；\n` +
    `3) relation=diff 时输出 diff：{a=较大的量名称, b=较小的量名称, text=差值描述（如「多6千克」）, ` +
    `value=差值数值}；\n` +
    `4) relation=times 时输出 times：{a=较大的量名称, b=基准量名称}；\n` +
    `5) 题目需要表示『一共/总数』（如『一共多少个』『总共有多少』）时输出 brace：` +
    `{label=大括号标注文字（如「一共？个」）, parts=[参与求和的分量名称列表]}。\n` +
    `【输出精简】JSON 无多余空格。\n` +
    `只输出JSON：{"segments":[{"label":"...","value":数字或null,"unit":"..."}],"relation":"total|diff|times|none",` +
    `"diff":{"a":"...","b":"...","text":"...","value":数字},"times":{"a":"...","b":"..."},` +
    `"brace":{"label":"...","parts":["..."]}}\n题目：` + question
  // BudgetExceededError 不捕获 → 全局 429
  const reply = await chat("你是一个只输出JSON的小学数学线段图构建助手。", prompt, 4096, "ai_homework_build_auto")

  const parseAuto = (rawReply: string): Record<string, unknown> | null => {
    const data = parseJsonObj(rawReply)
    if (!data) return null
    const segs: Record<string, unknown>[] = []
    const segsRaw = Array.isArray((data as Record<string, unknown>).segments) ? (data as Record<string, unknown>).segments as unknown[] : []
    for (const s of segsRaw) {
      if (!s || typeof s !== "object") continue
      const obj = s as Record<string, unknown>
      const label = String(obj.label ?? "").trim()
      if (!label) continue
      const rawV = obj.value
      let value: number | null = null
      if (rawV != null) {
        const n = Number(rawV)
        if (!Number.isFinite(n)) continue
        value = n
      }
      segs.push({
        label, value,
        unit: String(obj.unit ?? "").trim(),
        is_unknown: Boolean(obj.is_unknown) || value === null,
      })
    }
    const segsSliced = segs.slice(0, 10)
    let relation = String((data as Record<string, unknown>).relation ?? "none")
    if (!["total", "diff", "times", "none"].includes(relation)) relation = "none"

    let diff: Record<string, unknown> | null = null
    const d = (data as Record<string, unknown>).diff
    if (d && typeof d === "object" && relation === "diff") {
      const dobj = d as Record<string, unknown>
      diff = {
        a: String(dobj.a ?? "").trim(),
        b: String(dobj.b ?? "").trim(),
        text: String(dobj.text ?? "").trim(),
        value: numOr(dobj.value, 0),
      }
    }
    let times: Record<string, unknown> | null = null
    const t = (data as Record<string, unknown>).times
    if (t && typeof t === "object" && relation === "times") {
      const tobj = t as Record<string, unknown>
      times = { a: String(tobj.a ?? "").trim(), b: String(tobj.b ?? "").trim() }
    }
    let brace: Record<string, unknown> | null = null
    const br = (data as Record<string, unknown>).brace
    if (br && typeof br === "object") {
      const bobj = br as Record<string, unknown>
      const parts = Array.isArray(bobj.parts) ? bobj.parts.map(String).map((s) => s.trim()).filter(Boolean) : []
      brace = { label: String(bobj.label ?? "").trim(), parts }
    }
    return { segments: segsSliced, relation, diff, times, brace }
  }

  let result: Record<string, unknown> | null = null
  try {
    result = parseAuto(reply)
  } catch (e) {
    console.warn("[build-auto] 解析异常:", (e as Error).message)
  }
  if (!result || !(result.segments as unknown[]).length) {
    try {
      const reply2 = await chat("你是一个只输出JSON的小学数学线段图构建助手。", prompt, 4096, "ai_homework_build_auto")
      result = parseAuto(reply2)
    } catch (e) {
      if ((e as { budget?: boolean }).budget) throw e
    }
  }
  if (result && (result.segments as unknown[]).length) {
    writeCache(cacheFile, result)
    return c.json(result)
  }
  return c.json({ segments: [], relation: "none", diff: null, times: null, brace: null })
})
// 闯关子路由透明合并
router.route("/", questRoutes)

export default router
