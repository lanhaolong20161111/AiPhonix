/** 英语学科链路 —— 一条自洽的垂直链路：英语自己的提示词 → 自己的后处理 → 自己的分题。
 *
 *  §7 隔离要点：英语与语文**不共用任何策略**。具体地：
 *    · 提示词是 `*_EN` 一套（含付费兜底的排版提示词），**绝不回退到语文提示词**
 *    · 缓存键带 `_en` 后缀，与语文的默认命名空间分开
 *    · 不进语文那套「印刷拼音」处理（server_ts 尚无去拼音能力，将来也不该给英语加）
 *
 *  ⚠️ 历史病根（这就是隔离要治的病）：英语页复用语文的 `/ai-chinese/parse-image`，
 *  改造前靠一个 `isEnglish` 布尔参数在语文函数里分支；豆包一旦拿到**小学语文提示词**
 *  （通篇强调"汉字/拼音"），模型会把英文单词当拼音删掉 —— 用户看到的现象是
 *  **"英语识图字母都没了"**。根因不在清洗器，在提示词串味。
 *
 *  ⚠️ 隔离时一并修正的一处 bug（与 server_cf 同步）：
 *  改造前英语的**付费兜底**走的是语文 `deepseekRelayout(text)` —— 该函数没有 isEnglish
 *  参数，提示词与 system 全是中文那一支。于是"英语吃语文提示词"在兜底路径上原样复现。
 *  本文件的兜底固定用 `DEEPSEEK_RELAYOUT_PROMPT_EN` + 英语 system。
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
  DEEPSEEK_RELAYOUT_PROMPT_EN,
  DOUBAO_OCR_BLOCKS_PROMPT_EN,
  DOUBAO_OCR_PROMPT_EN,
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

/** 英语与语文共用 `data/ai_chinese_*` 命名空间 —— 这是**存储位置**的历史沿用
 *  （改目录会让已有缓存全部变孤儿），靠缓存键后缀区分，不靠目录。
 *  共用目录只是位置，不是逻辑：两学科的提示词/清洗/分块完全独立。 */
export const ENGLISH_CACHE_SUFFIX = "_en"

// ── Block 收尾（英语档位） ──

/** 英语 Block 收尾：逐行 trim + body 首行缩进。
 *
 *  ⚠️ 已知取舍（保留现状，不改）：改造前英语走的是语文档位，因此它同样享受了
 *  `markPoetry` 的"短行 + 句末标点 → 整块居中"判定。本次隔离**原样保留**以免版面
 *  发生非预期变化；隔离之后要改这一条，只需动这一个函数，不会再波及语文。 */
export function finalizeEnglishBlocks(raw: unknown[]): Block[] {
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
      if (b?.type === "body" && lines[0].indent === 0) lines[0].indent = 1
      return { type: normType(b?.type), text: bt, align: normAlign(b?.align), lines, polyphones: b?.polyphones || {} }
    })
    .filter(Boolean) as Block[]

  markPoetry(cleaned)
  return finishBlocks(cleaned)
}

// ── 缓存键（英语档位） ──

export function englishCacheKey(imageHash: string): string {
  return join(CACHE_DIR, `parse_${imageHash}${ENGLISH_CACHE_SUFFIX}.json`)
}

/** 命中缓存 → 按**英语档位**清洗后返回完整结果；未命中或缓存损坏 → null（路由继续走识别）。 */
export async function readEnglishCachedOutcome(imageHash: string): Promise<SubjectOcrOutcome | null> {
  const cached = await readCacheJson(englishCacheKey(imageHash))
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

// ── 识图 + 结构化排版（英语专用提示词贯穿全程） ──

/** 付费兜底排版：**固定用英语提示词**（改造前这里误用了语文提示词，见文件头）。 */
async function englishDeepseekRelayout(text: string): Promise<Block[]> {
  const prompt = DEEPSEEK_RELAYOUT_PROMPT_EN.replace("{text}", text.slice(0, 8000))
  const reply = await deepseekChat("你是一个只输出JSON的小学英语排版整理器。", prompt, 4096, "ai_english_relayout", true)
  return finalizeEnglishBlocks(extractBlocks(reply || ""))
}

/** 两段式（回退路径）：豆包 OCR 出纯文本 → 排版出 JSON。 */
async function englishTwoPass(
  imageKey: string,
  isTable = false,
): Promise<{ text: string; blocks: Block[] }> {
  const ark = getArk()
  const base = basename(imageKey).replace(/\.[^.]+$/, "")
  const compressed = await compressImageToFile(imageKey, join(IMAGE_DIR, `${base}.region.jpg`), 1400, 90)
  const reply = await ark.chat({
    prompt: isTable ? DOUBAO_TABLE_OCR_PROMPT : DOUBAO_OCR_PROMPT_EN,
    image_paths: [compressed],
    max_tokens: 4096,
    model_override: multimodalModel(),
    disable_thinking: true,
  })
  let rawText = dedupeLines(cleanOcrText(reply || "").trim()).trim()
  if (!rawText) return { text: "", blocks: [] }

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
      const relayoutPrompt = DEEPSEEK_RELAYOUT_PROMPT_EN.replace("{text}", text.slice(0, 8000))
      const relayoutReply = await ark.chat({
        prompt: relayoutPrompt,
        system_prompt: "你是一个只输出JSON的小学英语排版整理器。",
        max_tokens: 4096,
        model_override: multimodalModel(),
        disable_thinking: true,
      })
      const blocks = finalizeEnglishBlocks(mergeTableBlocks(extractBlocks(relayoutReply || ""), tables))
      if (blocks.length) return { text, blocks }
    }
  } catch (e) {
    console.warn(`[ai-english] 豆包 OCR 免费排版失败，改走 deepseek 兜底: ${(e as Error).message}`)
  }
  try {
    const blocks = finalizeEnglishBlocks(mergeTableBlocks(await englishDeepseekRelayout(text), tables))
    if (blocks.length) return { text, blocks }
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e // 预算超限 → 全局 429，不在本学科吞掉
    console.warn(`[ai-english] deepseek 排版兜底失败，用纯文本: ${(e as Error).message}`)
  }
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

/** 合并调用（主路径）：一次让豆包直接出结构化 JSON（识图+排版一步到位）。 */
async function englishMergedCall(imageKey: string): Promise<{ text: string; blocks: Block[] }> {
  const ark = getArk()
  // Ark 未配置是**硬错误**：抛出后由 runEnglishOcr 落到 OCR API 回退链（与改造前一致）
  if (!ark.enabled) throw new Error("免费 AI 服务未配置（缺少 ARK_API_KEY）")
  try {
    const base = basename(imageKey).replace(/\.[^.]+$/, "")
    const compressed = await compressImageToFile(imageKey, join(IMAGE_DIR, `${base}.region.jpg`), 1400, 90)
    const reply = await ark.chat({
      prompt: DOUBAO_OCR_BLOCKS_PROMPT_EN,
      image_paths: [compressed],
      max_tokens: 4096,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
    const blocks = finalizeEnglishBlocks(extractBlocks(reply || ""))
    if (blocks.length) {
      const text = dedupeLines(blocks.map((b) => b.lines.map((l) => l.text).join("\n")).join("\n")).trim()
      console.log(`[ai-english] 合并识图成功 blocks=${blocks.length}`)
      return { text, blocks }
    }
    console.warn("[ai-english] 合并识图 JSON 解析失败，回退两步流程")
  } catch (e) {
    console.warn(`[ai-english] 合并识图调用失败，回退两步流程: ${(e as Error).message}`)
  }
  return englishTwoPass(imageKey)
}

// ── 识别主链路 ──

export interface EnglishOcrInput {
  /** 已做 EXIF 校正的图片路径 */
  oriented: string
  /** 内容 sha256（缓存键） */
  imageHash: string
  /** 前端显式 engine 参数（server_ts 尚无 Paddle 引擎，仅记日志） */
  reqEngine?: string
}

/** 英语识别的完整垂直链路：提示词 → 清洗 → 分题 → 落缓存。
 *
 *  引擎：server_ts 只有豆包多模态一条路（`engine` 参数不影响本链路）。
 *  server_cf 那边英语是「默认豆包优先、显式 engine=paddle 才走 Paddle」且给出理由：
 *  英语页要的是**版面结构**（标题/段落层级），豆包多模态有版面理解，Paddle 只吐扁平
 *  markdown（空行被归一化、标题层级丢失）—— 用户反馈过的"标题和正文挤在一行"就来自这里。 */
export async function runEnglishOcr(input: EnglishOcrInput): Promise<SubjectOcrOutcome> {
  const { oriented, imageHash, reqEngine } = input
  if (reqEngine) console.log(`[ai-english] 收到 engine=${reqEngine}（server_ts 暂无该引擎，仍走豆包）`)

  let text = ""
  let blocks: Block[] = []
  let arkErr: string | null = null
  let ocrErr: string | null = null

  try {
    const result = await englishMergedCall(oriented)
    text = result.text
    blocks = result.blocks
  } catch (e) {
    arkErr = (e as Error).message
    console.warn(`[ai-english] 豆包识图失败: ${arkErr}`)
    try {
      const ocrText = await ocrChain(oriented)
      if (ocrText) {
        text = dedupeLines(cleanOcrText(ocrText)).trim()
        console.warn(`[ai-english] OCR API 回退成功, 文本长度 ${text.length}`)
      }
    } catch (e2) {
      ocrErr = (e2 as Error).message
      console.warn(`[ai-english] OCR API 回退失败: ${ocrErr}`)
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
  const crops: unknown[] = []
  await writeCacheJson(englishCacheKey(imageHash), { text, questions, blocks, page_bounds: pageBounds, crops })
  return { text, questions, blocks, pageBounds, crops }
}
