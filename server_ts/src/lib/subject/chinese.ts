/** 语文学科链路 —— 一条自洽的垂直链路：语文自己的提示词 → 自己的后处理 → 自己的分题。
 *
 *  §7 隔离要点：语文是**唯一**会做下面这些事的学科，因此它们只属于本文件：
 *    · 用 `cleanOcrText` 清洗（会删 `□`，对语文正确）
 *    · 正文块首行缩进 = 1（`markPoetry` 判定后还会整块居中）
 *    · 付费排版兜底的提示词是**中文**那一支（`DEEPSEEK_RELAYOUT_PROMPT`）
 *    · 分题用 `splitQuestions`（空行分隔优先于行首题号 —— 语文题干不靠题号分块）
 *
 *  本文件里没有任何 `mode === "english"` 判断，改语文不会波及英语或数学。
 *
 *  ⚠️ 与 server_cf/src/lib/subject/chinese.ts 的**已知差距**（本次隔离不改，留给下一步）：
 *    server_ts 无 PaddleOCR、无 `DOUBAO_OCR_JSON_PROMPT` 一套结构化提示词、无多音字补丁
 *    （`polyToken` / `/ai-chinese/parse-polyphones`）。故本文件没有 `runPolyphonesAsync`
 *    与 `polyPatchKey`，`SubjectOcrOutcome` 也不回 `polyToken`。隔离结构已就位，
 *    补齐这些能力时只需往本文件里加，不会再动语文之外的地方。
 */
import { basename, join } from "node:path"
import type { Block, BlockLine } from "../aiTextUtils.js"
import {
  cleanOcrText,
  dedupeLines,
  extractBlocks,
  extractHtmlTables,
  markOrderedIndent,
  markPoetry,
  mergeTableBlocks,
  recoverTextFromJson,
  splitQuestions,
} from "../aiTextUtils.js"
import {
  DEEPSEEK_RELAYOUT_PROMPT,
  DOUBAO_OCR_BLOCKS_PROMPT,
  DOUBAO_OCR_PROMPT,
  DOUBAO_TABLE_OCR_PROMPT,
} from "../prompts.js"
import { getArk } from "../ark.js"
import { chat as deepseekChat, BudgetExceededError } from "../deepseek.js"
import { compressImageToFile } from "../image.js"
import { ocrChain } from "../ocr.js"
import { CACHE_DIR, IMAGE_DIR, multimodalModel } from "../aiChineseContext.js"
import {
  clampIndent,
  finishBlocks,
  joinLines,
  normAlign,
  normType,
  readCacheJson,
  writeCacheJson,
  type RawBlock,
  type RawLine,
  type SubjectOcrOutcome,
} from "./kernel.js"

// ── Block 收尾（语文档位） ──

/** 语文 Block 收尾：`cleanOcrText` 逐行清洗 + 正文块首行缩进 1 + 诗歌居中判定。
 *
 *  这三条**内联在语文自己的文件里**，不通过参数开关表达 —— 调用方无法漏传、也无法传错。 */
export function finalizeChineseBlocks(raw: unknown[]): Block[] {
  const cleaned = ((raw || []) as RawBlock[])
    .map((b: RawBlock) => {
      const lines = ((b?.lines || []) as RawLine[])
        .map((ln: RawLine) => {
          const lt = cleanOcrText(String(ln?.text ?? "")).trim()
          if (!lt) return null
          return { text: lt, indent: clampIndent(ln?.indent) } as BlockLine
        })
        .filter(Boolean) as BlockLine[]
      let bt = cleanOcrText(String(b?.text ?? "")).trim()
      if (!bt.trim() && lines.length) bt = joinLines(lines)
      if (!bt.trim()) return null
      if (!lines.length) lines.push({ text: bt, indent: 0 })
      // 语文正文首行缩进两格（诗歌判定在后面会覆盖成居中 + indent=1）
      if (b?.type === "body" && lines[0].indent === 0) lines[0].indent = 1
      return { type: normType(b?.type), text: bt, align: normAlign(b?.align), lines, polyphones: b?.polyphones || {} }
    })
    .filter(Boolean) as Block[]

  markPoetry(cleaned)
  return finishBlocks(cleaned)
}

// ── 缓存键（语文档位） ──

/** 语文是 parse-image 的**默认命名空间**，缓存键不带后缀（英语靠 `_en` 后缀区分）。 */
export function chineseCacheKey(imageHash: string): string {
  return join(CACHE_DIR, `parse_${imageHash}.json`)
}

/** 命中缓存 → 按**语文档位**清洗后返回完整结果；未命中或缓存损坏 → null（路由继续走识别）。 */
export async function readChineseCachedOutcome(imageHash: string): Promise<SubjectOcrOutcome | null> {
  const cached = await readCacheJson(chineseCacheKey(imageHash))
  if (!cached) return null
  const cachedText = cleanOcrText(recoverTextFromJson(String(cached.text ?? ""))).trim()
  const cleanedText = dedupeLines(cachedText).trim()
  const cachedQs = (Array.isArray(cached.questions) ? cached.questions : []).map(String).filter(Boolean)
  return {
    text: cleanedText,
    questions: cachedQs.length ? cachedQs : cleanedText ? [cleanedText] : [],
    blocks: Array.isArray(cached.blocks) ? (cached.blocks as Block[]) : [],
    pageBounds: cached.page_bounds ?? null,
    crops: Array.isArray(cached.crops) ? cached.crops : [],
  }
}

// ── 识图 + 结构化排版（语文专用提示词贯穿全程） ──

/** 付费兜底排版：文本 → blocks JSON。成功返回 blocks；失败返回空数组（异常由调用方处理）。 */
async function chineseDeepseekRelayout(text: string): Promise<Block[]> {
  const prompt = DEEPSEEK_RELAYOUT_PROMPT.replace("{text}", text.slice(0, 8000))
  const reply = await deepseekChat("你是一个只输出JSON的小学语文排版整理器。", prompt, 4096, "ai_chinese_relayout", true)
  return finalizeChineseBlocks(extractBlocks(reply || ""))
}

/** 两段式（回退路径）：豆包 OCR 出纯文本 → 排版出 JSON。
 *  语文专用提示词贯穿两段，不使用任何英语提示词。 */
async function chineseTwoPass(
  imageKey: string,
  isTable = false,
): Promise<{ text: string; blocks: Block[] }> {
  const ark = getArk()
  // 逐行保真需要看清小字/拼音/下划线 —— 用更高的识别分辨率（区域切割专用 1400px，而非普通识图 800px）
  const base = basename(imageKey).replace(/\.[^.]+$/, "")
  const compressed = await compressImageToFile(imageKey, join(IMAGE_DIR, `${base}.region.jpg`), 1400, 90)
  const reply = await ark.chat({
    prompt: isTable ? DOUBAO_TABLE_OCR_PROMPT : DOUBAO_OCR_PROMPT,
    image_paths: [compressed],
    max_tokens: 4096,
    model_override: multimodalModel(),
    disable_thinking: true,
  })
  let rawText = dedupeLines(cleanOcrText(reply || "").trim()).trim()
  if (!rawText) return { text: "", blocks: [] }

  // 表格模式：从 OCR 结果提取 <table>…</table> 作为 table 块，其余文字占位后 relayout，保持顺序
  let tables: string[] = []
  if (isTable) {
    const [replaced, extracted] = extractHtmlTables(rawText)
    rawText = replaced
    tables = extracted
  }
  const text = rawText

  // 免费 Ark 排版优先；失败再兜底付费 deepseek（有预算守卫）
  try {
    if (ark.enabled) {
      const relayoutPrompt = DEEPSEEK_RELAYOUT_PROMPT.replace("{text}", text.slice(0, 8000))
      const relayoutReply = await ark.chat({
        prompt: relayoutPrompt,
        system_prompt: "你是一个只输出JSON的小学语文排版整理器。",
        max_tokens: 4096,
        model_override: multimodalModel(),
        disable_thinking: true,
      })
      const blocks = finalizeChineseBlocks(mergeTableBlocks(extractBlocks(relayoutReply || ""), tables))
      if (blocks.length) return { text, blocks }
    }
  } catch (e) {
    console.warn(`[ai-chinese] 豆包 OCR 免费排版失败，改走 deepseek 兜底: ${(e as Error).message}`)
  }
  try {
    const blocks = finalizeChineseBlocks(mergeTableBlocks(await chineseDeepseekRelayout(text), tables))
    if (blocks.length) return { text, blocks }
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e // 预算超限 → 全局 429，不在本学科吞掉
    console.warn(`[ai-chinese] deepseek 排版兜底失败，用纯文本: ${(e as Error).message}`)
  }
  // 兜底：表格块在前 + 剩余文字作为一个 body
  if (tables.length) {
    const out: Block[] = tables.map((t) => ({
      type: "table", text: t, align: "left", lines: [{ text: t, indent: 0 }], polyphones: {},
    }))
    const pure = text.trim()
    if (pure) out.push({ type: "body", text: pure, align: "left", lines: [{ text: pure, indent: 0 }], polyphones: {} })
    return { text, blocks: out }
  }
  return { text, blocks: [] }
}

/** 合并调用（主路径）：一次让豆包直接出结构化 JSON（识图+排版一步到位），
 *  省掉「OCR + 排版」一次串行往返。解析为空或抛错 → 自动回退两段式，质量不退化。 */
async function chineseMergedCall(imageKey: string): Promise<{ text: string; blocks: Block[] }> {
  const ark = getArk()
  // Ark 未配置是**硬错误**：抛出后由 runChineseOcr 落到 OCR API 回退链（与改造前一致）
  if (!ark.enabled) throw new Error("免费 AI 服务未配置（缺少 ARK_API_KEY）")
  try {
    const base = basename(imageKey).replace(/\.[^.]+$/, "")
    const compressed = await compressImageToFile(imageKey, join(IMAGE_DIR, `${base}.region.jpg`), 1400, 90)
    const reply = await ark.chat({
      prompt: DOUBAO_OCR_BLOCKS_PROMPT,
      image_paths: [compressed],
      max_tokens: 4096,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
    const blocks = finalizeChineseBlocks(extractBlocks(reply || ""))
    if (blocks.length) {
      const text = dedupeLines(blocks.map((b) => b.lines.map((l) => l.text).join("\n")).join("\n")).trim()
      console.log(`[ai-chinese] 合并识图成功 blocks=${blocks.length}`)
      return { text, blocks }
    }
    console.warn("[ai-chinese] 合并识图 JSON 解析失败，回退两步流程")
  } catch (e) {
    console.warn(`[ai-chinese] 合并识图调用失败，回退两步流程: ${(e as Error).message}`)
  }
  return chineseTwoPass(imageKey)
}

// ── 识别主链路 ──

export interface ChineseOcrInput {
  /** 已做 EXIF 校正的图片路径 */
  oriented: string
  /** 内容 sha256（缓存键） */
  imageHash: string
  /** 前端显式 engine 参数（server_ts 尚无 Paddle 引擎，仅记日志） */
  reqEngine?: string
}

/** 语文识别的完整垂直链路：提示词 → 清洗 → 分题 → 落缓存。
 *
 *  引擎：server_ts 只有豆包多模态一条路（`engine` 参数不影响本链路），
 *  与 server_cf 的「默认 Paddle 优先」不同 —— 各写各的，不共用开关。 */
export async function runChineseOcr(input: ChineseOcrInput): Promise<SubjectOcrOutcome> {
  const { oriented, imageHash, reqEngine } = input
  if (reqEngine) console.log(`[ai-chinese] 收到 engine=${reqEngine}（server_ts 暂无该引擎，仍走豆包）`)

  let text = ""
  let blocks: Block[] = []
  let arkErr: string | null = null
  let ocrErr: string | null = null

  try {
    const result = await chineseMergedCall(oriented)
    text = result.text
    blocks = result.blocks
  } catch (e) {
    arkErr = (e as Error).message
    console.warn(`[ai-chinese] 豆包识图失败: ${arkErr}`)
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

  text = cleanOcrText(text).trim()
  text = recoverTextFromJson(text).trim()

  if (!text) {
    const diag = `豆包识图:${arkErr || "成功但无文本"}` + (ocrErr ? `；OCR回退:${ocrErr}` : "")
    return { text: "", blocks: [], questions: [], pageBounds: null, crops: [], error: diag }
  }

  const questions = splitQuestions(text)
  const pageBounds = null
  const crops: unknown[] = [] // 区域裁剪：未接（原 Python OpenCV 行分割已移除，见改造前注释）
  await writeCacheJson(chineseCacheKey(imageHash), { text, questions, blocks, page_bounds: pageBounds, crops })
  return { text, questions, blocks, pageBounds, crops }
}
