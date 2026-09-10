/** AI 语文路由 — 对齐 Python routes/ai_chinese.py（52 端点）
 * 识图/高亮/提问/生字标记/点字/拼音关卡 + 知识库索引/搜索/闯关/分析
 * Cloudflare 版：fs → R2（data/ai_chinese_*），db → await getDb()，sqlite FTS → sqlAll，quest 缓存已 async。
 */
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { createHash } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { getDb, sqlAll } from "../db/index.js"
import {
  charUnknownMarks, charClickStats, chineseUnitKnowledge, chineseTextbookPages,
  userImports,
} from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { getArk } from "../lib/ark.js"
import { chat as deepseekChat, BudgetExceededError } from "../lib/deepseek.js"
import { autoOrient, compressImageToFile } from "../lib/image.js"
import { ocrChain } from "../lib/ocr.js"
import {
  cleanOcrText,
  dedupeLines,
  recoverTextFromJson,
  splitQuestions,
  splitSentences,
  extractBlocks,
  extractHtmlTables,
  mergeTableBlocks,
  markPoetry,
  markOrderedIndent,
  groupParagraphsByLayout,
  stripQuestionNoise,
  stripPrintedPinyin,
  cleanBookScanBlocks,
  cleanBookScanText,
} from "../lib/aiTextUtils.js"
import { splitPinyinWord } from "../lib/pinyin.js"
import { exists, readBlob, writeBlob } from "../lib/storage.js"
import { paddleOcrExtract, paddleV6DetectBlocks, type PaddleOcrOpts } from "../lib/paddleOcr.js"
import { IncrementalLineExtractor } from "../lib/incrementalJsonText.js"
import { getEnv } from "../env.js"

import { stripFence, parseJsonObj, readCache, writeCache, renderAnalyze, makeSentenceAudioPath } from "../lib/aiShared.js"

import { DOUBAO_OCR_PROMPT, DOUBAO_OCR_JSON_PROMPT, DOUBAO_OCR_JSON_PROMPT_NO_POLY, DEEPSEEK_RELAYOUT_PROMPT, DOUBAO_TABLE_OCR_PROMPT, HIGHLIGHT_MARK_PROMPT, POS_TAGS_PROMPT, STORY_ELEMENTS_PROMPT, TEXT_ASK_PROMPT, CHINESE_PINYIN_LEVEL_PROMPT, CHINESE_HIGHLIGHT_PROMPT, CHINESE_POLYPHONES_PROMPT, CHINESE_CLASSIFY_PROMPT, KB_ASK_PROMPT } from "../lib/prompts.js"
// 按域拆分的子路由（挂载于根 = 透明合并）
import kbRoutes from "./ai_chinese_kb.js"
import questRoutes from "./ai_chinese_quest.js"
import textbookRoutes from "./ai_chinese_textbook.js"
import questionsRoutes from "./ai_chinese_questions.js"
import { CACHE_DIR, IMAGE_DIR, MAX_QUESTION_LEN, multimodalModel, PROBLEM_IMAGE_DIR, SENTENCE_AUDIO_DIR, autoCropWhite, nowIso, resolveImagePath, searchTitle, strList, basenameOf, chineseSearch } from "../lib/aiChineseContext.js"

const router = new Hono()
const sentenceAudioPath = makeSentenceAudioPath(SENTENCE_AUDIO_DIR)

// ── 通用 JSON 工具 ──

/** LLM 输出 JSON + 结构校验；失败或校验不过自动重试一次（对齐 Python _chat_json） */

// ── 图片路径解析 / 白边裁剪 ──

// ── 句子朗读录音（md5 命名） ──

// ── render_analyze 提示词（对齐 prompts_aihomework.py） ──

// ── parse-image ──

// 表格专用 OCR 提示词：检测到图片含表格时使用，强化 HTML 表格还原（跨行/跨列合并、文字原样）

/** 排版整理（对齐 PY _deepseek_relayout）：把清洗后的文本整理成 blocks JSON。
 * 成功返回 blocks 列表（已清洗+mark）；失败返回空数组。 */
async function deepseekRelayout(text: string): Promise<any[]> {
  const prompt = DEEPSEEK_RELAYOUT_PROMPT.replace("{text}", text.slice(0, 8000))
  const reply = await deepseekChat("你是一个只输出JSON的小学语文排版整理器。", prompt, 4096, "ai_chinese_relayout", true)
  const blocks = extractBlocks(reply || "")
  if (!blocks.length) return []
  // 复用清洗：去残留标记 + 段落首行缩进兜底
  const cleaned = blocks
    .filter((b) => {
      const bt = cleanOcrText(b.text).trim()
      return !!bt
    })
    .map((b) => {
      const bt = cleanOcrText(b.text).trim()
      const lines = (b.lines || [])
        .map((ln) => {
          const lt = cleanOcrText(ln.text).trim()
          return lt ? { text: lt, indent: ln.indent } : null
        })
        .filter(Boolean) as { text: string; indent: number }[]
      if (!lines.length) lines.push({ text: bt, indent: 0 })
      if (b.type === "body" && lines[0].indent === 0) lines[0].indent = 1
      return { type: b.type, text: bt, align: b.align, lines, polyphones: b.polyphones || {} }
    })
  markPoetry(cleaned)
  markOrderedIndent(cleaned)
  return cleaned
}

/** Ark 识图 + 结构化排版（对齐 PY _ark_extract_blocks）：
 * 返回 {text, blocks, pageBounds}。识别失败抛异常（由调用方回退 OCR）。 */
/** 识图 + 结构化排版。
 * Tier 1 优化：非表格页用「一次合并调用」让豆包直接出结构化 JSON（砍掉原 OCR 45s + 排版 60s 两段串行）；
 * 合并调用解析为空或抛错时，自动回退到原两段式（arkExtractBlocksTwoPass），质量不退化。
 * 客户端已压到 1600px，主路径不再重复压缩（原后端 1400 重压省掉）。
 * structured=true 表示本次走的是「合并调用」成功路径（输出已是结构化 JSON 块，逐行保真）；
 * 供路由决定是否需要 LLM 去噪 —— 结构化输出只需确定性清理，省掉一次串行 LLM。
 * includePolyphones=false（poly_async=1 默认）：合并调用不输出 polyphones，注音由后台
 * runPolyphonesAsync 补，避免关键路径上多生成一坨 JSON（省时间 + 降截断风险）。 */
async function arkExtractBlocks(imageKey: string, isTable: boolean, includePolyphones = true): Promise<{ text: string; blocks: any[]; pageBounds: any; structured: boolean }> {
  const ark = getArk()
  if (!ark.enabled) throw new Error("免费 AI 服务未配置（缺少 ARK_API_KEY）")
  const tStart = Date.now()

  if (!isTable) {
    try {
      // max_tokens 说明：合并调用要一次输出「逐行保真 + 结构 JSON」，text 与 lines 内容重复、
      // 表格页还要嵌 HTML，4096 极易撞上限被截断 —— 而 ark.chat 截断后会用 max_tokens*3
      // 完整重跑一次（第一次的耗时全白费）。直接给足 8192，避免那次灾难性重跑。
      const reply = await ark.chat({
        prompt: includePolyphones ? DOUBAO_OCR_JSON_PROMPT : DOUBAO_OCR_JSON_PROMPT_NO_POLY,
        image_paths: [imageKey], // 客户端已压到 1600px，后端不再重复压缩
        system_prompt: "你是一个只输出JSON的小学语文识别排版器。",
        max_tokens: 8192,
        model_override: multimodalModel(),
        disable_thinking: true,
        timeout_ms: 60_000,
      })
      const merged = finalizeBlocks(mergeTableBlocks(extractBlocks(reply || ""), []))
      if (merged.length) {
        const text = merged.map((b) => b.text).join("\n")
        // 路径打点：merged 路径应只有一次 ark 调用；若日志里出现两条 [ark] attempt=0，
        // 说明首次被 max_tokens 截断并触发了 max_tokens*3 重跑（调大 max_tokens 消除）。
        console.log(`[ai-chinese] 合并调用成功 blocks=${merged.length} total=${Date.now() - tStart}ms`)
        return { text, blocks: merged, pageBounds: null, structured: true }
      }
      console.warn(`[ai-chinese] 合并调用解析为空,回退两段式 (已耗时 ${Date.now() - tStart}ms)`)
    } catch (e) {
      console.warn(`[ai-chinese] 合并调用失败,回退两段式: ${(e as Error).message} (已耗时 ${Date.now() - tStart}ms)`)
    }
  }
  const fallback = await arkExtractBlocksTwoPass(imageKey, isTable)
  console.log(`[ai-chinese] 两段式完成 blocks=${fallback.blocks.length} total=${Date.now() - tStart}ms`)
  return { ...fallback, structured: false }
}

/** 原两段式：豆包 OCR 出纯文本 → 排版出 JSON（表格模式也走这里）。作为合并调用的回退，保证质量。 */
async function arkExtractBlocksTwoPass(imageKey: string, isTable: boolean): Promise<{ text: string; blocks: any[]; pageBounds: any }> {
  const ark = getArk()
  // 逐行保真需要看清小字/拼音/下划线 —— 用更高的识别分辨率（区域切割专用 1400px，而非普通识图 800px）
  const compressed = await compressImageToFile(imageKey, `${IMAGE_DIR}/${basenameOf(imageKey).replace(/\.[^.]+$/, "")}.region.jpg`, 1400, 90)
  const prompt = isTable ? DOUBAO_TABLE_OCR_PROMPT : DOUBAO_OCR_PROMPT
  const reply = await ark.chat({
    prompt,
    image_paths: [compressed],
    max_tokens: 4096,
    model_override: multimodalModel(),
    disable_thinking: true,
    timeout_ms: 45_000,
  })
  let rawText = cleanOcrText(reply || "").trim()
  rawText = dedupeLines(rawText).trim()
  if (!rawText) return { text: "", blocks: [], pageBounds: null }

  // 表格模式：从 OCR 结果提取 <table>…</table> 作为 table 块，其余文字占位后 relayout，保持顺序
  let tables: string[] = []
  if (isTable) {
    const [replaced, extracted] = extractHtmlTables(rawText)
    rawText = replaced
    tables = extracted
  }
  const text = rawText

  // 免费 Ark 排版（doubao-seed-2-1-turbo-260628）优先；失败再兜底付费 deepseek（有预算守卫）
  try {
    if (ark.enabled) {
      const relayoutPrompt = DEEPSEEK_RELAYOUT_PROMPT.replace("{text}", text.slice(0, 8000))
      const relayoutReply = await ark.chat({
        prompt: relayoutPrompt,
        system_prompt: "你是一个只输出JSON的小学语文排版整理器。",
        max_tokens: 4096,
        model_override: multimodalModel(),
        disable_thinking: true,
        timeout_ms: 60_000,
      })
      const dsBlocks = finalizeBlocks(mergeTableBlocks(extractBlocks(relayoutReply || ""), tables))
      if (dsBlocks.length) return { text, blocks: dsBlocks, pageBounds: null }
    }
  } catch (e) {
    console.warn(`[ai-chinese] 豆包 OCR 免费排版失败，改走 deepseek 兜底: ${(e as Error).message}`)
  }
  try {
    const dsBlocks = mergeTableBlocks(await deepseekRelayout(text), tables)
    if (dsBlocks.length) return { text, blocks: dsBlocks, pageBounds: null }
  } catch (e) {
    // BudgetExceededError 不捕获 → 全局 429
    if (e instanceof BudgetExceededError) throw e
    console.warn(`[ai-chinese] deepseek 排版兜底失败，用纯文本: ${(e as Error).message}`)
  }
  // 兜底：表格块在前 + 剩余文字作为一个 body
  if (tables.length) {
    const out = tables.map((t) => ({ type: "table", text: t, align: "left", lines: [{ text: t, indent: 0 }], polyphones: {} }))
    const pure = text.trim()
    if (pure) out.push({ type: "body", text: pure, align: "left", lines: [{ text: pure, indent: 0 }], polyphones: {} })
    return { text, blocks: out, pageBounds: null }
  }
  return { text, blocks: [], pageBounds: null }
}

/** 复用清洗 + 排版修正：去空、逐行清洗、body 首行缩进、诗歌/有序缩进标记。供合并调用与两段式共用。
 * text 可推导：提示词已不再要求输出冗余的 text（其内容是 lines 的逐行拼接），
 * 模型未给 text 时由 lines 推导；仍给 text 时按原样使用（向后兼容）。 */
function finalizeBlocks(raw: any[]): any[] {
  const cleaned = (raw || [])
    .map((b: any) => {
      const lines = (b.lines || [])
        .map((ln: any) => {
          const lt = cleanOcrText(String(ln?.text ?? "")).trim()
          if (!lt) return null
          let indent = Number(ln?.indent ?? 0)
          if (!Number.isFinite(indent) || indent < 0) indent = 0
          if (indent > 3) indent = 3
          return { text: lt, indent }
        })
        .filter(Boolean) as { text: string; indent: number }[]
      // text 缺失（提示词已省略该字段）→ 由 lines 逐行拼接推导
      let bt = cleanOcrText(String(b?.text ?? "")).trim()
      if (!bt && lines.length) bt = lines.map((l) => l.text).join("\n")
      if (!bt) return null
      if (!lines.length) lines.push({ text: bt, indent: 0 })
      if (b.type === "body" && lines[0].indent === 0) lines[0].indent = 1
      return { type: b.type, text: bt, align: b.align ?? "left", lines, polyphones: b.polyphones || {} }
    })
    .filter(Boolean) as any[]
  markPoetry(cleaned)
  markOrderedIndent(cleaned)
  return cleaned
}

/** 区域裁剪 — 原基于 Python OpenCV 像素行分割 + 逐行多模态读文本。
 * Python 依赖移除后暂返回空数组（豆包 OCR 已能整页识别+排版，crops 仅作附图对照增强，非关键路径）。 */
async function detectRegions(_imageKey: string): Promise<any[]> {
  return []
}

/** C 方案：PaddleOCR 主路径不标多音字（polyphones 恒空），这里用 LLM 对整页文本
 * 补一次多音字标注，再合并进每个非表格 block。这样既保住 Paddle 4 秒级速度，又保住点读/
 * 注音的多音字正确性。失败不阻塞主链路——保持空 polyphones（前端回退词库默认读音）。
 *
 * ⚠️ 模型选型教训：deepseek-v4-flash / Ark 托管的 deepseek-v4-flash-ga-260731 都是思考模型，
 * disableThinking 无效，补多音字这种要"直接输出短 JSON"的任务会被思维链耗尽 max_tokens → 空 content
 * + 70s。因此这里**强制用已验证可用的豆包多模态模型 doubao-seed-2-1-turbo-260628**（纯文本调用不传图），
 * 可靠且快；不再叠加付费 deepseek 兜底（慢且空，只会拖垮 Paddle 的速度优势）。 */
async function fillPolyphones(blocks: any[]): Promise<any[]> {
  const text = (blocks || [])
    .filter((b) => b?.type && b.type !== "table")
    .map((b) => b?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim()
  // 文本过短（无正文）或超过 LLM 上下文限制则跳过
  if (!text || text.length > MAX_QUESTION_LEN) return blocks
  const prompt = CHINESE_POLYPHONES_PROMPT.replace("{text}", text)
  let reply = ""
  try {
    // 豆包多模态模型（纯文本调用，model_override 强制用 doubao-seed-2-1-turbo-260628）
    reply = await getArk().chat({
      prompt,
      system_prompt: "你是一个只输出JSON的小学语文老师。",
      max_tokens: 4096,
      model_override: multimodalModel(),
      disable_thinking: true,
      timeout_ms: 40_000,
    })
    if (!reply) {
      console.warn("[parse-image] 豆包补多音字返回空，保持空 polyphones")
      return blocks
    }
  } catch (e) {
    console.warn(`[parse-image] 豆包补多音字失败(保持空): ${(e as Error).message}`)
    return blocks
  }
  const poly: Record<string, string> = {}
  const data = parseJsonObj(reply)
  if (data?.polyphones && typeof data.polyphones === "object") {
    for (const [k, v] of Object.entries(data.polyphones as Record<string, unknown>)) {
      const ks = String(k ?? "").trim()
      const vs = String(v ?? "").trim()
      if (ks && ks.length === 1 && vs) poly[ks] = vs
    }
  }
  if (Object.keys(poly).length) {
    return (blocks || []).map((b: any) =>
      b?.type && b.type !== "table" ? { ...b, polyphones: { ...(b.polyphones || {}), ...poly } } : b,
    )
  }
  return blocks
}

/** 异步补多音字（2026-09-02）：Paddle 主路径原本串行等 fillPolyphones 约 3-35s 才返回，
 * 用户白等且结果页正文其实早已可用。改为：主请求先返回无注音结果，注音在 waitUntil 后台补，
 * 补完写「补丁缓存」，前端拿到 poly_token 轮询补丁接口回填。
 * 同时回写主缓存（带注音版本），保证后续同图命中也带注音。 */
function polyPatchKey(hash: string): string {
  return `${CACHE_DIR}/poly_${hash}.json`
}

async function runPolyphonesAsync(blocks: any[], patchKey: string, mainCacheKey: string, basePayload: any): Promise<void> {
  try {
    const t0 = Date.now()
    const filled = await fillPolyphones(blocks)
    const poly: Record<string, string> = {}
    for (const b of filled || []) {
      if (b?.polyphones && typeof b.polyphones === "object") Object.assign(poly, b.polyphones)
    }
    await writeCache(patchKey, { ready: true, polyphones: poly })
    // 回写主缓存（带注音版本），后续同图命中直接带注音，无需再轮询
    try {
      await writeCache(mainCacheKey, { ...basePayload, blocks: filled })
    } catch {
      /* 主缓存回写失败不影响补丁可用性 */
    }
    console.log(`[parse-image] 异步补多音字完成, 耗时 ${Date.now() - t0}ms, 多音字 ${Object.keys(poly).length} 个`)
  } catch (e) {
    console.warn(`[parse-image] 异步补多音字失败(保持空注音): ${(e as Error).message}`)
    // 写 ready 标记，避免前端轮询到超时
    try {
      await writeCache(patchKey, { ready: true, polyphones: {} })
    } catch {
      /* 忽略 */
    }
  }
}

// ── 流式识图：增量 JSON 解析（2026-09-10） ─────────────────────────────
// 豆包 OCR 合并调用输出 `{"blocks":[{"type":...,"lines":[{"text":"行",...}]}]}`，
// 文本藏在 lines[].text。要在流式过程中尽早出字，不能等完整 JSON —— 增量提取器
// 扫描已累积的 JSON 文本，把每个已闭合的 `"text":"…"` 字符串值按出现顺序吐出来。
// 实现见 lib/incrementalJsonText.ts（独立文件便于单测）。

/** D 方案：PaddleOCR/豆包 识图后，用 LLM 把「不符合的文本」去掉。
 * 删除 OCR 噪声行（水印/页码/页眉页脚/装饰乱码/广告图标文字/纯分隔符），
 * 并把相邻正文行合并为通顺段落（段间一个空行）。不改写正文、不新增解释。
 * ⚠️ 与 fillPolyphones 一致：失败/超时/返回空 → 自动降级为原文，绝不阻塞主链路。 */async function llmFilterOcrText(text: string): Promise<string> {
  const t = (text || "").trim()
  if (!t || t.length < 8) return text // 太短无需清洗
  if (t.length > MAX_QUESTION_LEN) return text // 超上下文则跳过，避免截断
  const prompt =
    "下面是一张小学语文试卷/课本页面经 OCR 识别出的文本，可能混有噪声。请做如下清洗：\n" +
    "1) 只保留题目/正文（课文、题目、选项、答案、标题等），删除所有非题目信息（页眉页脚、页码、水印、" +
    "广告、图标文字、纯分隔线、装饰性乱码）；\n" +
    "2) 删除所有括号（）/( )，包括空括号（ ）（答案、注释、小提示、填空横线均按需求全部过滤）；\n" +
    "3) 删除下划线符号 _（老师标注线/填空横线在 OCR 里常被识别成连续下划线）；\n" +
    "4) 把相邻的正文行合并为通顺段落，不同段落之间用「一个空行」分隔。\n" +
    "严格要求：①不要改写、纠错或补充正文内容；②不要输出任何解释或标记，只输出清洗并排版后的纯文本；" +
    "③如果整段都是噪声，输出空内容。\n\n原文：\n" + t
  try {
    const reply = await getArk().chat({
      prompt,
      system_prompt: "你是一个只做文本清洗的 OCR 后处理助手，输出纯文本。",
      max_tokens: 4096,
      model_override: multimodalModel(),
      disable_thinking: true,
      timeout_ms: 30_000,
    })
    const cleaned = (reply || "").trim()
    if (!cleaned) return text // 模型返回空 → 保留原文，避免误删
    return cleaned
  } catch (e) {
    console.warn(`[parse-image] LLM 去噪失败(保留原文): ${(e as Error).message}`)
    return text
  }
}

router.post("/ai-chinese/parse-image", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400)
  const data = new Uint8Array(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "图片为空" }, 422)
  const noCache = c.req.query("no_cache") === "true"
  // 英语模式（2026-09-02）：英语页复用本接口的 OCR 能力，但跳过中文特有后处理
  // （补多音字注音、LLM 中文去噪）。缓存键加后缀隔离，避免两模式互相污染。
  const mode = c.req.query("mode") === "english" ? "english" : "chinese"
  // 异步补多音字（2026-09-02）：语文/数学模式默认开启（前端可用 poly_async=0 关闭）。
  // 主请求先返回正文，注音由 waitUntil 后台补齐（见 runPolyphonesAsync），前端轮询回填。
  const polyAsync = mode !== "english" && c.req.query("poly_async") !== "0"
  const reqT0 = Date.now()
  console.log(
    `[parse-image] 收到图片 ${data.length} 字节 (${(data.length / 1024 / 1024).toFixed(2)} MB), no_cache=${noCache}, mode=${mode}`
  )

  const imgHash = createHash("sha256").update(data).digest("hex")
  const cacheKey = `${CACHE_DIR}/parse_${imgHash}${mode === "english" ? "_en" : ""}.json`
  if (!noCache && (await exists(cacheKey))) {
    try {
      const cached = await readCache(cacheKey)
      const cachedText = cleanOcrText(recoverTextFromJson(String(cached?.text ?? ""))).trim()
      const deduped = dedupeLines(cachedText).trim()
      const cachedBlocks = Array.isArray(cached?.blocks) ? cached.blocks : []
      // 课本扫描清洗（命中缓存也要过滤：去印刷拼音 + 去角落页码）
      const stripPinyin = mode !== "english"
      const cleanedText = cleanBookScanText(deduped, { stripPinyin })
      const cleanedBlocks = cleanBookScanBlocks(cachedBlocks, { stripPinyin })
      const cleanedQs = splitQuestions(cleanedText)
      // 命中缓存但注音为空（异步路径先落的无注音版本，或历史同步请求本就没补到）→ 给 token 让前端轮询补丁
      const hasPoly = cachedBlocks.some((b: any) => b?.polyphones && Object.keys(b.polyphones).length)
      return c.json({
        text: cleanedText,
        questions: cleanedQs.length ? cleanedQs : cleanedText ? [cleanedText] : [],
        blocks: cleanedBlocks,
        page_bounds: cached?.page_bounds ?? null,
        crops: Array.isArray(cached?.crops) ? cached.crops : [],
        poly_pending: polyAsync && !hasPoly ? true : undefined,
        poly_token: polyAsync && !hasPoly ? imgHash : undefined,
      })
    } catch {
      /* 缓存损坏忽略 */
    }
  }

  const ext = (file as File).name?.match(/\.([a-zA-Z0-9]+)$/)?.[1] ? "." + (file as File).name!.match(/\.([a-zA-Z0-9]+)$/)![1] : ".jpg"
  const fname = `${crypto.randomUUID().replace(/-/g, "")}${ext}`
  const path = `${IMAGE_DIR}/${fname}`
  await writeBlob(path, data, "image/jpeg")

  // EXIF 方向校正（WASM）
  let oriented = path
  try {
    oriented = await autoOrient(path)
  } catch {
    /* 跳过 */
  }

  // 图片预分类已移除（原 Python OpenCV classifyImage）。
  // 豆包多模态 OCR 能直接处理截图/拍照，无需裁剪 UI 残留。
  const isTable = false

  // 识图引擎选择：
  // - 前端显式传 engine=paddle/doubao 时，强制走该模型（覆盖环境变量）；
  // - 否则沿用环境变量：OCR_ENGINE=doubao 跳过 PaddleOCR 直走豆包（平板慢网易超时）；
  //   缺省/其他值维持 PaddleOCR-VL 优先（版面/表格更准），失败回退豆包。零回归风险。
  const reqEngine = (c.req.query("engine") || "").trim().toLowerCase()
  const envEngine = (getEnv().OCR_ENGINE || "").trim().toLowerCase()
  let usePaddleFirst: boolean
  if (reqEngine === "paddle") usePaddleFirst = true
  else if (reqEngine === "doubao") usePaddleFirst = false
  else usePaddleFirst = envEngine !== "doubao"
  console.log(`[parse-image] 识图引擎: req=${reqEngine || "(无)"} env=${envEngine || "(无)"} → ${usePaddleFirst ? "PaddleOCR优先" : "豆包优先"}`)

  let text = ""
  let blocks: any[] = []
  let arkErr: string | null = null
  let ocrErr: string | null = null
  let usedPaddle = false
  let arkStructured = false
  let polyToken: string | null = null
  if (usePaddleFirst) {
  try {
    const poT0 = Date.now()
    const poOpts: PaddleOcrOpts = { timeoutMs: 20_000 }
    if (mode === "english") {
      // 英语页选 Paddle 时开启版面/图表/表格识别（用户指定参数；公式识别按需求未启用）
      poOpts.ocr = { layoutParsing: true, useChartRecognition: true, useTableRecognition: true }
    }
    const po = await paddleOcrExtract(oriented, poOpts)
    if (po.ok && po.blocks.length) {
      text = po.text
      blocks = po.blocks
      usedPaddle = true
      console.log(`[parse-image] PaddleOCR 第一选项成功, 耗时 ${Date.now() - poT0}ms, blocks=${blocks.length}`)
      // C 方案：Paddle 不标多音字，用豆包补一次（保住点读/注音正确性）；失败自动降级为词库默认读音。
      // 英语内容无需中文注音，跳过。
      // 2026-09-02：poly_async 开启时不再串行等待（原 +3~35s 白等），交给 waitUntil 后台补，
      // 主请求立刻返回正文；前端凭 poly_token 轮询补丁回填注音。
      if (mode !== "english" && !polyAsync) {
        // 显式关闭异步（poly_async=0）时保持旧的串行语义
        const fpT0 = Date.now()
        blocks = await fillPolyphones(blocks)
        console.log(`[parse-image] 补多音字完成, 耗时 ${Date.now() - fpT0}ms`)
      }
      // polyAsync 开启时不在此处等待：注音统一移到管线末尾交给 waitUntil，
      // 这样 Paddle 与豆包两条路径（生产现配 OCR_ENGINE=doubao）都能享受异步注音。
    } else {
      console.warn(`[parse-image] PaddleOCR 未产出(${po.ms ?? 0}ms): ${po.error}; 回退豆包`)
    }
  } catch (e) {
    console.warn(`[parse-image] PaddleOCR 异常, 回退豆包: ${(e as Error).message}`)
  }
  } else {
    console.log(`[parse-image] OCR_ENGINE=doubao，跳过 PaddleOCR 直走豆包`)
  }

  if (!usedPaddle) {
  // 豆包识图（Ark 优先，失败回退 OCR API 链）+ 结构化排版
  try {
    const arkT0 = Date.now()
    const result = await arkExtractBlocks(oriented, isTable, !polyAsync)
    arkStructured = result.structured
    console.log(`[parse-image] Ark 识图+排版完成, 耗时 ${Date.now() - arkT0}ms, 文本长度 ${result.text.length}, structured=${arkStructured}`)
    text = result.text
    blocks = result.blocks
  } catch (e) {
    arkErr = (e as Error).message
    console.warn(`[ai-chinese] 豆包识图失败(耗时 ${Date.now() - reqT0}ms): ${arkErr}`)
    // 回退 OCR API 链（腾讯云 → 百度），失败则保持空文本
    try {
      const ocrText = await ocrChain(oriented)
      if (ocrText) {
        text = dedupeLines(cleanOcrText(ocrText)).trim()
        console.warn(`[ai-chinese] OCR API 回退成功, 文本长度 ${text.length}`)
      }
    } catch (e2) {
      ocrErr = (e2 as Error).message
      console.warn(`[ai-chinese] OCR API 回退失败: ${ocrErr}`)
    }
  }
  } // end if (!usedPaddle)

  text = cleanOcrText(text).trim()
  text = recoverTextFromJson(text).trim()
  // D 方案：LLM 去噪 + 确定性去噪兜底。改为按需：结构化输出路径（Paddle、豆包合并调用）
  // 直接跳过 LLM 去噪（两者都是专用文档 OCR 的结构化输出：Paddle 出 markdown、合并调用
  // 出逐行保真的 JSON 块，前面 cleanOcrText/stripQuestionNoise 确定性清理足够），省一次
  // 串行 LLM（约 2-5s，最坏 30s 超时）；仅两段式/OCR API 回退链路保留 LLM 去噪
  // （它们的原始输出噪声概率高）。英语模式一律跳过。失败保留原文，不阻塞主链路。
  const needLlmDenoise = !usedPaddle && !arkStructured && mode !== "english"
  text = stripQuestionNoise(needLlmDenoise ? await llmFilterOcrText(text) : text)
  // 课本扫描清洗：去印刷拼音（系统后续自己注音）+ 去角落页码
  const stripPinyin = mode !== "english"
  text = cleanBookScanText(text, { stripPinyin })
  blocks = cleanBookScanBlocks(blocks, { stripPinyin })
  console.log(`[parse-image] 识别完成, 总耗时 ${Date.now() - reqT0}ms, 文本长度 ${text.length}, blocks=${blocks.length}`)
  if (!text) {
    const diag = `豆包识图:${arkErr || "成功但无文本"}` + (ocrErr ? `；OCR回退:${ocrErr}` : "")
    return c.json({ detail: `图片识别失败（诊断：${diag}）` }, 422)
  }
  const questions = splitQuestions(text)
  // 页面区域裁剪（Vision 检测 bbox → 裁剪每区小图，供前端附图对照）
  let crops: any[] = []
  try {
    crops = await detectRegions(oriented)
  } catch (e) {
    console.warn(`[ai-chinese] 区域裁剪失败（跳过附图）: ${(e as Error).message}`)
  }
  const pageBounds = null // 对齐 PY：_ark_extract_blocks 恒返回 None
  // 异步补多音字：Paddle 与豆包两条路径统一在此挂载 waitUntil（生产现配 OCR_ENGINE=doubao，
  // 只有挂在这里才真正生效）。主响应不受影响，注音补完由前端轮询补丁接口回填。
  // （polyAsync 本身已蕴含 mode !== "english"，无需重复判断）
  if (polyAsync && blocks.length) {
    polyToken = imgHash
  }
  const cachePayload = { text, questions, blocks, page_bounds: pageBounds, crops }
  await writeCache(cacheKey, cachePayload)
  // 异步补多音字：挂到 waitUntil，响应不受影响（Workers 保证后台任务继续执行）
  if (polyToken) {
    try {
      c.executionCtx?.waitUntil(runPolyphonesAsync(blocks, polyPatchKey(polyToken), cacheKey, cachePayload))
    } catch (e) {
      console.warn(`[parse-image] waitUntil 挂载失败, 退化为不补注音: ${(e as Error).message}`)
      polyToken = null
    }
  }
  return c.json({
    text,
    questions,
    blocks,
    page_bounds: pageBounds,
    crops,
    poly_pending: polyToken ? true : undefined,
    poly_token: polyToken ?? undefined,
  })
})

// POST /api/v1/ai-chinese/parse-image-stream — SSE 流式识图（2026-09-10）
// 目标：让学生以最快速度开始阅读识别出的文字。
// 策略：先用**纯文本 OCR 提示词**流式调用豆包（无 JSON 包裹 → 首行 1~3s 就能吐），
//       delta 事件按行增量推送 text；流结束后再补发结构化 blocks（后台用原 JSON 调用，
//       拿到逐行/类型/对齐/注音，用于结果页的精细排版与点读）。
// 事件格式（data: JSON）：
//   meta{img_hash} → line{text,index}* → done{text,questions,blocks,poly_pending,poly_token} / error{detail}
// 说明：本端点只走豆包（OCR_ENGINE=doubao 为生产默认）；Paddle 用户仍走非流式 parse-image。
router.post("/ai-chinese/parse-image-stream", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  if (!user) return c.json({ detail: "未登录" }, 401)
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400)
  const data = new Uint8Array(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "图片为空" }, 422)
  const noCache = c.req.query("no_cache") === "true"
  const mode = c.req.query("mode") === "english" ? "english" : "chinese"
  const polyAsync = mode !== "english" && c.req.query("poly_async") !== "0"
  const reqT0 = Date.now()
  const imgHash = createHash("sha256").update(data).digest("hex")
  const cacheKey = `${CACHE_DIR}/parse_${imgHash}${mode === "english" ? "_en" : ""}.json`
  console.log(`[parse-image-stream] 收到图片 ${data.length} 字节, no_cache=${noCache}, mode=${mode}`)

  // 缓存命中：无流可放（或需要增量吐？）——直接一次性把完整结果发出来，前端秒显示
  if (!noCache && (await exists(cacheKey))) {
    try {
      const cached = await readCache(cacheKey)
      const stripPinyin = mode !== "english"
      const cachedText = cleanBookScanText(dedupeLines(cleanOcrText(recoverTextFromJson(String(cached?.text ?? ""))).trim()).trim(), { stripPinyin })
      const cachedBlocks = cleanBookScanBlocks(Array.isArray(cached?.blocks) ? cached.blocks : [], { stripPinyin })
      const cachedQs = splitQuestions(cachedText)
      const hasPoly = cachedBlocks.some((b: any) => b?.polyphones && Object.keys(b.polyphones).length)
      const polyToken = polyAsync && !hasPoly ? imgHash : null
      console.log(`[parse-image-stream] 缓存命中, 文本 ${cachedText.length} 字, 耗时 ${Date.now() - reqT0}ms`)
      return streamSSE(c, async (stream) => {
        const send = (p: Record<string, unknown>) => stream.writeSSE({ data: JSON.stringify(p) })
        await send({ type: "meta", img_hash: imgHash, cached: true })
        for (const ln of cachedText.split("\n")) {
          if (ln) await send({ type: "line", text: ln })
        }
        await send({
          type: "done",
          text: cachedText,
          questions: cachedQs.length ? cachedQs : cachedText ? [cachedText] : [],
          blocks: cachedBlocks,
          crops: Array.isArray(cached?.crops) ? cached.crops : [],
          page_bounds: cached?.page_bounds ?? null,
          poly_pending: polyToken ? true : undefined,
          poly_token: polyToken ?? undefined,
        })
      })
    } catch {
      /* 缓存损坏忽略，走正常识别 */
    }
  }

  // 落盘 + 方向校正
  const ext = (file as File).name?.match(/\.([a-zA-Z0-9]+)$/)?.[1] ? "." + (file as File).name!.match(/\.([a-zA-Z0-9]+)$/)![1] : ".jpg"
  const fname = `${crypto.randomUUID().replace(/-/g, "")}${ext}`
  const path = `${IMAGE_DIR}/${fname}`
  await writeBlob(path, data, "image/jpeg")
  let oriented = path
  try {
    oriented = await autoOrient(path)
  } catch {
    /* 跳过 */
  }

  return streamSSE(c, async (stream) => {
    const send = (p: Record<string, unknown>) => stream.writeSSE({ data: JSON.stringify(p) })
    const ark = getArk()
    if (!ark.enabled) {
      await send({ type: "error", detail: "免费 AI 服务未配置（缺少 ARK_API_KEY）" })
      return
    }
    const extractor = new IncrementalLineExtractor()
    let streamed = ""
    let firstLineMs = 0
    try {
      await send({ type: "meta", img_hash: imgHash })
      // 纯文本 OCR 提示词：模型直接按行输出正文，无需 JSON 包裹，首行最快
      const iter = ark.chatStream({
        prompt: mode === "english" ? DOUBAO_OCR_PROMPT : DOUBAO_OCR_PROMPT,
        system_prompt: "你是一个小学课本 OCR 逐行转录器，只输出识别到的文字行。",
        image_paths: [oriented],
        max_tokens: 8192,
        model_override: multimodalModel(),
        disable_thinking: true,
        timeout_ms: 90_000,
      })
      for await (const delta of iter) {
        if (!delta) continue
        // 纯文本路径：delta 本身就带换行，按行切分增量推送
        // （若模型误输出 JSON 包裹，IncrementalLineExtractor 也能兜住 —— 双保险）
        const looksJson = delta.includes('"text"') || delta.trimStart().startsWith("{")
        if (looksJson) {
          for (const ln of extractor.push(delta)) {
            if (!firstLineMs) firstLineMs = Date.now() - reqT0
            streamed += (streamed ? "\n" : "") + ln
            await send({ type: "line", text: ln })
          }
        } else {
          for (const ln of delta.split("\n")) {
            const t = ln.trim()
            if (!t) continue
            if (!firstLineMs) firstLineMs = Date.now() - reqT0
            streamed += (streamed ? "\n" : "") + t
            await send({ type: "line", text: t })
          }
        }
      }
      console.log(`[parse-image-stream] 流式文本完成 首行=${firstLineMs}ms 总耗时=${Date.now() - reqT0}ms 文本=${streamed.length}字`)
    } catch (e) {
      console.warn(`[parse-image-stream] 流式失败(已出${streamed.length}字): ${(e as Error).message}`)
      if (!streamed) {
        await send({ type: "error", detail: `识图失败：${(e as Error).message}` })
        return
      }
      // 已出部分文本：继续走下面的收尾（结构化能拿到多少算多少）
    }

    // 流结束后：文本清洗
    let text = cleanOcrText(streamed).trim()
    text = recoverTextFromJson(text).trim()
    text = cleanBookScanText(text, { stripPinyin: mode !== "english" })
    if (!text) {
      await send({ type: "error", detail: "图片识别失败（未识别到文字）" })
      return
    }

    // 结构化 blocks：后台跑一次原 JSON 调用（版面/对齐/逐字注音），失败则退化为单块纯文本
    let blocks: any[] = []
    let structured = false
    try {
      const result = await arkExtractBlocks(oriented, false, !polyAsync)
      if (result.blocks.length) {
        blocks = cleanBookScanBlocks(result.blocks, { stripPinyin: mode !== "english" })
        structured = result.structured
      }
    } catch (e) {
      console.warn(`[parse-image-stream] 结构化补 blocks 失败(退化为纯文本块): ${(e as Error).message}`)
    }
    if (!blocks.length) {
      blocks = [{ type: "body", text, align: "left", lines: text.split("\n").map((t) => ({ text: t, indent: 0 })), polyphones: {} }]
    }
    const questions = splitQuestions(text)
    const polyToken = polyAsync && blocks.length ? imgHash : null
    const cachePayload = { text, questions, blocks, page_bounds: null, crops: [] }
    await writeCache(cacheKey, cachePayload).catch(() => {})
    if (polyToken) {
      try {
        c.executionCtx?.waitUntil(runPolyphonesAsync(blocks, polyPatchKey(polyToken), cacheKey, cachePayload))
      } catch {
        /* 后台补注音失败：前端拿不到注音，不影响正文阅读 */
      }
    }
    console.log(`[parse-image-stream] 完成 总耗时=${Date.now() - reqT0}ms 文本=${text.length}字 blocks=${blocks.length} structured=${structured}`)
    await send({
      type: "done",
      text,
      questions: questions.length ? questions : [text],
      blocks,
      crops: [],
      page_bounds: null,
      poly_pending: polyToken ? true : undefined,
      poly_token: polyToken ?? undefined,
    })
  })
})

/** 异步补多音字补丁查询（2026-09-02）：parse-image 返回 poly_token 后，前端轮询此接口拿注音。
 * 未就绪返回 {ready:false}；完成返回 {ready:true, polyphones:{字:拼音}}（可能为空对象=没补到）。 */
router.get("/ai-chinese/parse-polyphones", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const token = (c.req.query("token") || "").trim().toLowerCase()
  if (!/^[a-f0-9]{16,128}$/.test(token)) return c.json({ detail: "token 无效" }, 400)
  const key = polyPatchKey(token)
  if (!(await exists(key))) return c.json({ ready: false })
  try {
    const d = await readCache(key)
    return c.json({ ready: true, polyphones: (d?.polyphones as Record<string, string>) ?? {} })
  } catch {
    return c.json({ ready: false })
  }
})

// ── detect-blocks（PP-OCRv6 文本行检测，切块识图绿框用；替代前端 OpenCV.js） ──

router.post("/ai-chinese/detect-blocks", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400)
  const data = new Uint8Array(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "图片为空" }, 422)
  const reqT0 = Date.now()

  const ext = (file as File).name?.match(/\.([a-zA-Z0-9]+)$/)?.[1] ? "." + (file as File).name!.match(/\.([a-zA-Z0-9]+)$/)![1] : ".jpg"
  const fname = `${crypto.randomUUID().replace(/-/g, "")}${ext}`
  const path = `${IMAGE_DIR}/${fname}`
  await writeBlob(path, data, "image/jpeg")

  // EXIF 方向校正（WASM），与 parse-image 一致
  let oriented = path
  try {
    oriented = await autoOrient(path)
  } catch {
    /* 跳过 */
  }

  const out = await paddleV6DetectBlocks(oriented, { timeoutMs: 60_000 })
  console.log(`[detect-blocks] 总耗时 ${Date.now() - reqT0}ms, ok=${out.ok}, blocks=${out.blocks.length}`)
  if (!out.ok) {
    return c.json({ detail: out.error || "文本块检测失败" }, 422)
  }
  return c.json({
    width: out.width,
    height: out.height,
    blocks: out.blocks,
    // 几何分段排版成整齐段落 + 确定性去噪（括号/下划线/非题目字符），供前端直接展示/后续读题
    paragraphs: groupParagraphsByLayout(out.blocks).map((p) => ({
      ...p,
      text: stripQuestionNoise(cleanOcrText(p.text)),
    })),
  })
})

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
  const highlights: any[] = []
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

  // 缓存：同语言同文本不重复调 LLM（复用现有 sha256 → R2 缓存模式）
  const hash = createHash("sha256").update(`${lang}|${text}`).digest("hex")
  const cacheKey = `${CACHE_DIR}/postags_${hash}.json`
  const cached = await readCache(cacheKey).catch(() => null)
  if (cached && Array.isArray((cached as any).tags)) {
    return c.json({ lang, tags: (cached as any).tags })
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
      // 只采纳原文连续子串；同一词只留一条（大小写不敏感去重）
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
    await writeCache(cacheKey, { lang, tags }).catch(() => {})
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
  const cached = await readCache(cacheKey).catch(() => null)
  if (cached && Array.isArray((cached as any).elements)) {
    return c.json({ lang, elements: (cached as any).elements })
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
    await writeCache(cacheKey, { lang, elements }).catch(() => {})
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
    const existing = await getDb().select().from(charUnknownMarks).where(and(eq(charUnknownMarks.userId, user!.id), eq(charUnknownMarks.char, ch))).get()
    if (existing) {
      await getDb().update(charUnknownMarks).set({ lesson: lesson || existing.lesson, updatedAt: now }).where(eq(charUnknownMarks.id, existing.id)).run()
    } else {
      await getDb().insert(charUnknownMarks).values({ userId: user!.id, char: ch, lesson, createdAt: now, updatedAt: now }).run()
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
    const existing = await getDb().select().from(charClickStats).where(and(eq(charClickStats.userId, user!.id), eq(charClickStats.char, ch))).get()
    if (existing) {
      await getDb().update(charClickStats).set({ clickCount: existing.clickCount + 1, updatedAt: now }).where(eq(charClickStats.id, existing.id)).run()
    } else {
      await getDb().insert(charClickStats).values({ userId: user!.id, char: ch, clickCount: 1, createdAt: now, updatedAt: now }).run()
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
    const ukRows = (await getDb()
      .select({ content: chineseUnitKnowledge.content })
      .from(chineseUnitKnowledge)
      .all())
      .filter((r) => r.content)
      .slice(0, 12)
    const tbRows = (await getDb()
      .select({ content: chineseTextbookPages.content, pageType: chineseTextbookPages.pageType })
      .from(chineseTextbookPages)
      .all())
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
    const data = new Uint8Array(await (file as File).arrayBuffer())
    if (data.length) {
      const fname = `${crypto.randomUUID().replace(/-/g, "")}.jpg`
      imagePath = `${PROBLEM_IMAGE_DIR}/${fname}`
      await writeBlob(imagePath, data, "image/jpeg")
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
    const existing = await getDb().select().from(userImports)
      .where(and(eq(userImports.userId, user!.id), eq(userImports.kind, "problem"), eq(userImports.text, question)))
      .get()
    if (existing) {
      await getDb().update(userImports).set({ payload: payloadJson, status: "active", updatedAt: nowIso() })
        .where(eq(userImports.id, existing.id)).run()
      return c.json({ status: "ok", id: existing.id })
    }
    const inserted = await getDb().insert(userImports).values({
      userId: user!.id, kind: "problem", text: question, pinyin: "", meaning: "", tags: "",
      payload: payloadJson, status: "active",
    }).run()
    return c.json({ status: "ok", id: Number((inserted.meta as { last_row_id?: number | bigint }).last_row_id) })
  } catch (e) {
    console.warn("[ai-chinese/save-problem] 入库失败:", (e as Error).message)
    return c.json({ detail: "保存失败，请稍后重试" }, 500)
  }
})

router.get("/ai-chinese/my-imports", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const rows = await getDb().select().from(userImports)
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

/** DB 里的 image_path（历史本机路径或历史 key）→ R2 key；找不到返回 ""。 */
async function resolveImageKey(imagePath: string): Promise<string> {
  const resolved = resolveImagePath(imagePath)
  if (resolved && (await exists(resolved))) return resolved
  // 兜底：按文件名在 IMAGE_DIR 下找一次（历史 DB 路径可能带本机前缀）
  const base = basenameOf(imagePath)
  if (base) {
    const alt = `${IMAGE_DIR}/${base}`
    if (alt !== resolved && (await exists(alt))) return alt
  }
  return ""
}

router.get("/ai-chinese/problem-image/:import_id", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const importId = Number(c.req.param("import_id"))
  if (!Number.isFinite(importId)) return c.json({ detail: "记录不存在" }, 404)
  const row = await getDb().select().from(userImports)
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
  let file = await resolveImageKey(imagePath)
  if (!file) return c.json({ detail: "无原图" }, 404)
  try {
    file = await autoCropWhite(file)
  } catch {
    /* 用原图 */
  }
  const data = await readBlob(file)
  if (!data) return c.json({ detail: "无原图" }, 404)
  return new Response(data, { headers: { "Content-Type": "image/jpeg" } })
})

router.get("/ai-chinese/outline-image/:source/:item_id", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const source = c.req.param("source")
  const itemId = Number(c.req.param("item_id"))
  if (!["textbook", "unit_knowledge"].includes(source)) return c.json({ detail: "未知来源" }, 422)
  let imagePath = ""
  if (source === "textbook") {
    const row = await getDb().select().from(chineseTextbookPages).where(eq(chineseTextbookPages.id, itemId)).get()
    if (row) imagePath = String(row.imagePath ?? "")
  } else {
    const row = await getDb().select().from(chineseUnitKnowledge).where(eq(chineseUnitKnowledge.id, itemId)).get()
    if (row) imagePath = String(row.imagePath ?? "")
  }
  if (!imagePath) return c.json({ detail: "无原图" }, 404)
  const file = await resolveImageKey(imagePath)
  if (!file) return c.json({ detail: "无原图" }, 404)
  const data = await readBlob(file)
  if (!data) return c.json({ detail: "无原图" }, 404)
  return new Response(data, { headers: { "Content-Type": "image/jpeg" } })
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
  const data = new Uint8Array(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "录音为空" }, 422)
  const path = sentenceAudioPath(sentence)
  await writeBlob(path, data, "audio/mp4")
  const hash = path.replace(/.*[\\/]/, "").replace(/\.[^.]+$/, "")
  return c.json({ status: "ok", hash })
})

router.get("/ai-chinese/sentence-audio/:audio_hash", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const hash = c.req.param("audio_hash")
  const path = `${SENTENCE_AUDIO_DIR}/${hash}.m4a`
  if (!(await exists(path))) return c.json({ detail: "还没有该句的录音" }, 404)
  const data = await readBlob(path)
  if (!data) return c.json({ detail: "还没有该句的录音" }, 404)
  return new Response(data, { headers: { "Content-Type": "audio/mp4" } })
})

router.get("/ai-chinese/sentence-audio/:audio_hash/exists", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const hash = c.req.param("audio_hash")
  return c.json({ exists: await exists(`${SENTENCE_AUDIO_DIR}/${hash}.m4a`) })
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
  // 改用豆包多模态模型（纯文本调用）补多音字：deepseek-v4-flash 是思考模型，
  // 对"直接输出短 JSON"任务会被思维链耗尽 max_tokens → 空 content + 34-39s 慢。
  // 与 fillPolyphones 同源同模式（已验证 polyphones 正确），失败返回空不阻塞。
  let reply = ""
  try {
    reply = await getArk().chat({
      prompt,
      system_prompt: "你是一个只输出JSON的小学语文老师。",
      max_tokens: 4096,
      model_override: multimodalModel(),
      disable_thinking: true,
      timeout_ms: 40_000,
    })
  } catch (e) {
    console.warn(`[polyphones] 豆包标注失败(返回空): ${(e as Error).message}`)
  }
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

// ── search（LIKE 跨表搜索，替代 FTS5） ──

// ── kb-ask（知识库问答） ──

router.post("/ai-chinese/kb-ask", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "问题不能为空" }, 422)
  if (question.length > 200) return c.json({ detail: "问题过长" }, 422)

  // 全文检索（D1 不支持 FTS5，改用 LIKE 跨表）
  let results: { id: number; ptype: string; title: string; snippet: string }[] = []
  try {
    const rows = await chineseSearch(question, 8)
    results = await Promise.all(
      rows.map(async (r) => ({ id: r.sid, ptype: r.stype, title: await searchTitle(r.stype, r.sid), snippet: r.snip || "" }))
    )
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
  const cacheKey = `${CACHE_DIR}/analyze_${qHash}.json`
  const cached = await readCache(cacheKey)
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
  await writeCache(cacheKey, resp)
  return c.json(resp)
})

// ── unknown-chars + char-click/stats ──

router.get("/ai-chinese/unknown-chars", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  try {
    const rows = await getDb().select({ char: charUnknownMarks.char }).from(charUnknownMarks)
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
    const rows = await getDb().select().from(charClickStats)
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
  const cacheKey2 = `${CACHE_DIR}/steps_${cacheKey}.json`
  const cached = await readCache(cacheKey2)
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
  if (stepsOut.length) await writeCache(cacheKey2, { steps: stepsOut })
  return c.json({ steps: stepsOut })
})

// ── POST questions（问题列表提取） ──

// 子路由透明合并进本 router（共享同一 /api/v1 根）
router.route("/", kbRoutes)
router.route("/", questRoutes)
router.route("/", textbookRoutes)
router.route("/", questionsRoutes)

export default router
