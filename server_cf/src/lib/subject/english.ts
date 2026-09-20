/** 英语学科链路 —— 一条自洽的垂直链路：英语自己的提示词 → 自己的后处理 → 自己的分题。
 *
 *  §7 隔离要点：英语与语文**不共用任何策略**。具体地：
 *    · 提示词是 `*_EN` 一套（含付费兜底的排版提示词），**绝不回退到语文提示词**
 *    · 默认**豆包优先**（英语页要的是版面结构，Paddle 只吐扁平 markdown、丢标题层级）
 *    · **不去印刷拼音**（英语正文就是拉丁字母，去拼音会把正文删成标点乱码）
 *    · **不补多音字**（中文注音对英语无意义，还会白等一次 LLM）
 *    · 不跑 LLM 中文去噪（它的提示词里写着"删除所有括号"，会吃掉英语的括号内容）
 *
 *  ⚠️ 历史病根（这就是隔离要治的病）：英语原先复用语文的 `/ai-chinese/parse-image`，
 *  而豆包拿到的是**小学语文提示词**（通篇强调"汉字/拼音"），模型把英文单词当拼音删掉
 *  —— 用户看到的现象是"英语识图字母都没了"。根因不在 `stripPinyin`，在提示词串味。
 *
 *  本文件里没有任何 `mode === "english"` 判断，改英语不会波及语文或数学。
 */
import type { Block } from "../aiTextUtils.js"
import {
  cleanOcrText,
  dedupeLines,
  extractBlocks,
  extractHtmlTables,
  mergeTableBlocks,
  recoverTextFromJson,
  splitQuestions,
  stripQuestionNoise,
} from "../aiTextUtils.js"
import {
  DOUBAO_OCR_JSON_PROMPT_EN,
  DOUBAO_OCR_PROMPT_EN,
  DOUBAO_TABLE_OCR_PROMPT,
  DEEPSEEK_RELAYOUT_PROMPT_EN,
} from "../prompts.js"
import { getArk, multimodalModel } from "../ark.js"
import { chat as deepseekChat, BudgetExceededError } from "../deepseek.js"
import { compressImageToFile } from "../image.js"
import { ocrChain } from "../ocr.js"
import { paddleOcrExtract } from "../paddleOcr.js"
import {
  clampIndent,
  finishBlocks,
  joinLines,
  normAlign,
  normType,
  readCacheJson,
  tidyBlocks,
  writeCacheJson,
  dropPageNumberLines,
  type SubjectOcrOutcome,
} from "./kernel.js"

/** 英语与语文共用 `data/ai_chinese_*` 命名空间 —— 这是**存储位置**的历史沿用
 *  （改目录会让线上已有缓存全部变孤儿），靠缓存键后缀 `_en_` 区分，不靠目录。
 *  共用目录只是位置，不是逻辑：两学科的提示词/清洗/分块/渲染完全独立。 */
const CACHE_DIR = "data/ai_chinese_cache"
const IMAGE_DIR = "data/ai_chinese_images"

/** 英语缓存键版本后缀（2026-09-14 起）。
 *
 *  为什么不只是改清洗器还要换 key：早期英语走语文提示词，缓存里存的是**提示词层面**
 *  就被删掉字母的脏结果 —— 读取路径再怎么清洗也救不回来，只能换 key 让它失效重识别。
 *  `_en_r5` = 英语专用提示词修复（2026-09-14）。
 *  `_en_r6` = 填空横线保留（2026-09-15）：`stripQuestionNoise` 不再删行内下划线，
 *  旧缓存里的 `text` 已丢掉 `____`，救不回来。
 *  ⚠️ 与此对应，前端 `web/src/lib/ocrResultCache.ts` 的 `KEY_V` 也必须同步 bump，
 *  否则客户端 localStorage 命中会**完全绕过服务端**，服务端怎么修都没用（踩过一整轮）。 */
export const ENGLISH_CACHE_SUFFIX = "_en_r6"

// ── Block 收尾（英语档位） ──

/** 英语 Block 收尾：逐行 trim、body 首行缩进、不做诗歌居中判定、不做去拼音。
 *
 *  ⚠️ 已知取舍（保留现状，不改）：改造前英语走的是语文档位 `finalizeBlocks`（默认 profile），
 *  因此它也享受了 `markPoetry` 的"短行 + 句末标点 → 整块居中"判定。本次隔离**原样保留**
 *  以免版面发生非预期变化；隔离之后要改这一条，只需动这一个函数，不会再波及语文。 */
export function finalizeEnglishBlocks(raw: unknown[]): Block[] {
  const cleaned = (raw || [])
    .map((b: any) => {
      const lines = ((b?.lines || []) as unknown[])
        .map((ln: any) => {
          const lt = cleanOcrText(String(ln?.text ?? "")).trim()
          if (!lt.trim()) return null
          return { text: lt, indent: clampIndent(ln?.indent) }
        })
        .filter(Boolean) as Block["lines"]
      let bt = cleanOcrText(String(b?.text ?? "")).trim()
      if (!bt.trim() && lines.length) bt = joinLines(lines)
      if (!bt.trim()) return null
      if (!lines.length) lines.push({ text: bt, indent: 0 })
      if (b?.type === "body" && lines[0].indent === 0) lines[0].indent = 1
      return { type: normType(b?.type), text: bt, align: normAlign(b?.align), lines, polyphones: b?.polyphones || {} }
    })
    .filter(Boolean) as Block[]
  return finishBlocks(cleaned)
}

// ── 缓存命中路径（英语档位清洗） ──

export function englishCacheKey(imageHash: string): string {
  return `${CACHE_DIR}/parse_${imageHash}${ENGLISH_CACHE_SUFFIX}.json`
}

export async function readEnglishCachedOutcome(imageHash: string): Promise<SubjectOcrOutcome | null> {
  const cached = await readCacheJson(englishCacheKey(imageHash))
  if (!cached) return null
  const cachedText = cleanOcrText(recoverTextFromJson(String(cached?.text ?? ""))).trim()
  const cleanedText = dropPageNumberLines(dedupeLines(cachedText).trim()) // 英语不去印刷拼音
  const cachedBlocks = Array.isArray(cached?.blocks) ? (cached.blocks as Block[]) : []
  const cleanedQs = splitQuestions(cleanedText)
  return {
    text: cleanedText,
    questions: cleanedQs.length ? cleanedQs : cleanedText ? [cleanedText] : [],
    blocks: tidyBlocks(cachedBlocks),
    pageBounds: cached?.page_bounds ?? null,
    crops: Array.isArray(cached?.crops) ? cached.crops : [],
  }
}

// ── 识图 + 结构化排版 ──

/** 两段式（回退路径）：豆包 OCR 出纯文本 → 排版出 JSON。
 *  英语专用提示词贯穿两段，不使用任何语文提示词。 */
async function englishTwoPass(
  imageKey: string,
  isTable = false,
): Promise<{ text: string; blocks: Block[] }> {
  const ark = getArk()
  // 逐行保真需要看清小字 —— 用更高的识别分辨率（区域切割专用 1400px，而非普通识图 800px）
  const base = (imageKey.split("/").pop() || "img").replace(/\.[^.]+$/, "")
  const compressed = await compressImageToFile(imageKey, `${IMAGE_DIR}/${base}.region.jpg`, 1400, 90)
  const reply = await ark.chat({
    prompt: isTable ? DOUBAO_TABLE_OCR_PROMPT : DOUBAO_OCR_PROMPT_EN,
    image_paths: [compressed],
    max_tokens: 4096,
    model_override: multimodalModel(),
    disable_thinking: true,
    timeout_ms: 45_000,
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
        timeout_ms: 60_000,
      })
      const blocks = finalizeEnglishBlocks(mergeTableBlocks(extractBlocks(relayoutReply || ""), tables))
      if (blocks.length) return { text, blocks }
    }
  } catch (e) {
    console.warn(`[ai-english] 豆包 OCR 免费排版失败，改走 deepseek 兜底: ${(e as Error).message}`)
  }
  try {
    // ⚠️ 这里用英语专用排版提示词。改造前英语的付费兜底走的是**语文** `deepseekRelayout`
    //（中英提示词 + 中文 system），正是"英语吃语文提示词"同一类病 —— 隔离时一并修正。
    const relayoutPrompt = DEEPSEEK_RELAYOUT_PROMPT_EN.replace("{text}", text.slice(0, 8000))
    const reply = await deepseekChat(
      "你是一个只输出JSON的小学英语排版整理器。",
      relayoutPrompt,
      4096,
      "ai_english_relayout",
      true,
    )
    const blocks = finalizeEnglishBlocks(mergeTableBlocks(extractBlocks(reply || ""), tables))
    if (blocks.length) return { text, blocks }
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e // 预算超限 → 全局 429，不在本学科吞掉
    console.warn(`[ai-english] deepseek 排版兜底失败，用纯文本: ${(e as Error).message}`)
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

/** 合并调用（主路径）：一次让豆包直接出结构化 JSON，砍掉「OCR 45s + 排版 60s」两段串行。
 *  解析为空或抛错 → 自动回退两段式，质量不退化。 */
async function englishMergedCall(
  imageKey: string,
): Promise<{ text: string; blocks: Block[]; structured: boolean }> {
  const ark = getArk()
  // Ark 未配置是**硬错误**：抛出后由 runEnglishOcr 落到 OCR API 回退链（与改造前一致）
  if (!ark.enabled) throw new Error("免费 AI 服务未配置（缺少 ARK_API_KEY）")
  try {
    const tStart = Date.now()
    // max_tokens 说明：合并调用要一次输出「逐行保真 + 结构 JSON」，text 与 lines 内容重复、
    // 表格页还要嵌 HTML，4096 极易撞上限被截断 —— 而 ark.chat 截断后会用 max_tokens*3
    // 完整重跑一次（第一次的耗时全白费）。直接给足 8192，避免那次灾难性重跑。
    const reply = await ark.chat({
      prompt: DOUBAO_OCR_JSON_PROMPT_EN,
      image_paths: [imageKey], // 客户端已压到 1600px，后端不再重复压缩
      system_prompt: "你是一个只输出JSON的小学英语识别排版器。",
      max_tokens: 8192,
      model_override: multimodalModel(),
      disable_thinking: true,
      timeout_ms: 60_000,
    })
    const blocks = finalizeEnglishBlocks(mergeTableBlocks(extractBlocks(reply || ""), []))
    if (blocks.length) {
      console.log(`[ai-english] 合并调用成功 blocks=${blocks.length} total=${Date.now() - tStart}ms`)
      return { text: blocks.map((b) => b.text).join("\n"), blocks, structured: true }
    }
    console.warn(`[ai-english] 合并调用解析为空,回退两段式 (已耗时 ${Date.now() - tStart}ms)`)
  } catch (e) {
    console.warn(`[ai-english] 合并调用失败,回退两段式: ${(e as Error).message}`)
  }
  const fallback = await englishTwoPass(imageKey)
  return { ...fallback, structured: false }
}

// ── 识别主链路 ──

export interface EnglishOcrInput {
  /** 已做 EXIF 校正的图片路径 */
  oriented: string
  /** 前端显式 engine 参数（已 trim + lowercase） */
  reqEngine: string
  /** 内容 sha256（缓存键） */
  imageHash: string
}

/** 英语识别的完整垂直链路：引擎选择 → 提示词 → 清洗 → 分题 → 落缓存。
 *
 *  引擎策略（英语专属）：**默认豆包优先**（`usePaddleFirst=false`），
 *  只有用户显式 `engine=paddle` 才走 PaddleOCR-VL。理由：英语页要的是版面结构
 *  （标题/段落层级），豆包多模态有版面理解，而 Paddle 只吐扁平 markdown
 *  （空行会被归一化、标题层级丢失）——用户反馈过的"标题和正文挤在一行"就来自这里。 */
export async function runEnglishOcr(input: EnglishOcrInput): Promise<SubjectOcrOutcome> {
  const { oriented, reqEngine, imageHash } = input
  const cacheKey = englishCacheKey(imageHash)

  let text = ""
  let blocks: Block[] = []
  let arkErr: string | null = null
  let ocrErr: string | null = null
  let usedPaddle = false

  const usePaddleFirst = reqEngine === "paddle"
  console.log(`[ai-english] 识图引擎: req=${reqEngine || "(无)"} → ${usePaddleFirst ? "PaddleOCR优先" : "豆包优先"}`)

  if (usePaddleFirst) {
    try {
      const po = await paddleOcrExtract(oriented, {
        timeoutMs: 20_000,
        // 英语页选 Paddle 时开启版面/图表/表格识别（公式识别对英语无意义，不启用）
        ocr: { layoutParsing: true, useChartRecognition: true, useTableRecognition: true },
      })
      if (po.ok && po.blocks.length) {
        text = po.text
        blocks = po.blocks
        usedPaddle = true
        console.log(`[ai-english] PaddleOCR 成功, blocks=${blocks.length}`)
      } else {
        console.warn(`[ai-english] PaddleOCR 未产出(${po.ms ?? 0}ms): ${po.error}; 回退豆包`)
      }
    } catch (e) {
      console.warn(`[ai-english] PaddleOCR 异常, 回退豆包: ${(e as Error).message}`)
    }
  }

  let arkStructured = false
  if (!usedPaddle) {
    try {
      const result = await englishMergedCall(oriented)
      arkStructured = result.structured
      text = result.text
      blocks = result.blocks
      console.log(`[ai-english] 豆包识图完成, 文本长度 ${text.length}, structured=${arkStructured}`)
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
  }

  text = cleanOcrText(text).trim()
  text = recoverTextFromJson(text).trim()
  // 英语**不跑** LLM 中文去噪：那条提示词要求"删除所有括号"，会吃掉英语的括号内容。
  // 只做确定性清洗（删括号/下划线 + 归并空行）。
  text = stripQuestionNoise(text)
  text = dropPageNumberLines(text) // 去角落页码（英语不去印刷拼音）

  if (!text) {
    const diag =
      `豆包识图:${arkErr || "成功但无文本"}` + (ocrErr ? `；OCR回退:${ocrErr}` : "；OCR回退:无产出")
    return { text: "", blocks: [], questions: [], pageBounds: null, crops: [], error: diag }
  }

  blocks = tidyBlocks(blocks)
  const questions = splitQuestions(text)
  console.log(`[ai-english] 识别完成, 文本长度 ${text.length}, blocks=${blocks.length}`)

  const pageBounds = null
  const crops: unknown[] = []
  await writeCacheJson(cacheKey, { text, questions, blocks, page_bounds: pageBounds, crops })
  return { text, questions, blocks, pageBounds, crops }
}
