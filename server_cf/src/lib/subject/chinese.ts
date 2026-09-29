/** 语文学科链路 —— 一条自洽的垂直链路：语文自己的提示词 → 自己的后处理 → 自己的分题 → 自己的注音。
 *
 *  §7 隔离要点：语文与英语/数学**不共用任何策略**。具体地：
 *    · 默认 **Paddle 优先**（可用 env `OCR_ENGINE=doubao` 或 `?engine=doubao` 覆盖）
 *    · **去印刷拼音**（教材印刷拼音由系统用 polyphones 重新注音）
 *    · **补多音字**（同步 `poly_async=0` 或后台异步 + 前端轮询回填）
 *    · 保留 LLM 中文去噪（仅在两段式/OCR API 回退链路启用）
 *    · 分题用 `splitQuestions`
 *
 *  ⚠️ 两条踩过的坑（写在这里，避免将来又"顺手共用"）：
 *  1. `stripPrintedPinyin` **只对含汉字的行删无调拉丁段**。早先它无条件
 *     `replace(/[A-Za-z]+/g,"")`，把语文卷里夹的英文正文（如英语邮件范文）
 *     删成 `"    ,  ."` 一串标点乱码 —— 实测 "It has been a long time since we met." → "    ,  ."。
 *  2. 异步补注音必须挂在 `waitUntil` 上，且**补完要回写主缓存**（带注音版），
 *     否则同一张图每次都要重新轮询。
 *
 *  本文件里没有任何 `mode === "english"` 判断，改语文不会波及英语或数学。
 */
import type { Block, BlockLine } from "../aiTextUtils.js"
import {
  cleanBookScanBlocks,
  cleanBookScanText,
  cleanOcrText,
  dedupeLines,
  extractBlocks,
  extractHtmlTables,
  markPoetry,
  mergeTableBlocks,
  recoverTextFromJson,
  splitQuestions,
  stripQuestionNoise,
} from "../aiTextUtils.js"
import {
  CHINESE_POLYPHONES_PROMPT,
  DEEPSEEK_RELAYOUT_PROMPT,
  DOUBAO_OCR_JSON_PROMPT,
  DOUBAO_OCR_JSON_PROMPT_NO_POLY,
  DOUBAO_OCR_PROMPT,
  DOUBAO_TABLE_OCR_PROMPT,
} from "../prompts.js"
import { getArk, multimodalModel } from "../ark.js"
import { chat as deepseekChat, BudgetExceededError } from "../deepseek.js"
import { compressImageToFile } from "../image.js"
import { ocrChain } from "../ocr.js"
import { paddleOcrExtract } from "../paddleOcr.js"
import { parseJsonObj, readCache, writeCache } from "../aiShared.js"
import { cleanPolyphones, sanitizeBlockPolyphones } from "../pinyinValue.js"
import { MAX_QUESTION_LEN } from "../aiChineseContext.js"
import {
  clampIndent,
  finishBlocks,
  joinLines,
  normAlign,
  normType,
  readCacheJson,
  type RawBlock,
  type RawLine,
  type SubjectOcrOutcome,
} from "./kernel.js"

/** 课文/试卷图片与识别缓存的存储位置（语文命名空间） */
const CACHE_DIR = "data/ai_chinese_cache"
const IMAGE_DIR = "data/ai_chinese_images"

/** 语文缓存键版本后缀。
 *  `_r4` = 多音字版本号（2026-09-10）：旧缓存里可能落进了「(非多音，跳过)」这类被模型
 *  写进 polyphones 值的说明文字（结果页会把它当拼音显示在字上方）。
 *  `_r5` = 填空横线保留（2026-09-15）：`stripQuestionNoise` 不再删行内下划线 +
 *  `llmFilterOcrText` 提示词第 3 条改写 → `text` 里不再丢 `____`。
 *  ⚠️ 改识别质量时**服务端与客户端都要 bump**：服务端换 key 只影响 R2，
 *  客户端 `web/src/lib/ocrResultCache.ts` 的 `KEY_V` 不 bump 就会命中 localStorage 直接绕过服务端。 */
export const CHINESE_CACHE_SUFFIX = "_r5"

// ── Block 收尾（语文档位） ──

/** 语文 Block 收尾：逐行 trim、body 首行缩进两格、诗歌居中判定、保留 polyphones。 */
export function finalizeChineseBlocks(raw: unknown[]): Block[] {
  const cleaned = ((raw || []) as RawBlock[])
    .map((b: RawBlock) => {
      const lines = ((b?.lines || []) as RawLine[])
        .map((ln: RawLine) => {
          const lt = cleanOcrText(String(ln?.text ?? "")).trim()
          if (!lt.trim()) return null
          return { text: lt, indent: clampIndent(ln?.indent) } as BlockLine
        })
        .filter(Boolean) as BlockLine[]
      // text 缺失（合并调用提示词刻意省略）→ 由 lines 逐行拼接推导
      let bt = cleanOcrText(String(b?.text ?? "")).trim()
      if (!bt.trim() && lines.length) bt = joinLines(lines)
      if (!bt.trim()) return null
      if (!lines.length) lines.push({ text: bt, indent: 0 })
      if (b?.type === "body" && lines[0].indent === 0) lines[0].indent = 1
      return {
        type: normType(b?.type),
        text: bt,
        align: normAlign(b?.align),
        lines,
        polyphones: b?.polyphones || {},
      }
    })
    .filter(Boolean) as Block[]
  markPoetry(cleaned) // 语文专属：短行 + 句末标点 → 整块居中（对齐后前端忽略 indent）
  return finishBlocks(cleaned)
}

/** 排版整理（付费 deepseek 兜底）：把清洗后的文本整理成 blocks JSON。失败返回空数组。 */
async function deepseekRelayout(text: string): Promise<Block[]> {
  const prompt = DEEPSEEK_RELAYOUT_PROMPT.replace("{text}", text.slice(0, 8000))
  const reply = await deepseekChat("你是一个只输出JSON的小学语文排版整理器。", prompt, 4096, "ai_chinese_relayout", true)
  const blocks = extractBlocks(reply || "")
  if (!blocks.length) return []
  return finalizeChineseBlocks(blocks)
}

/** D 方案：识图后，用 LLM 删掉 OCR 噪声行（水印/页码/页眉页脚/装饰乱码），并把相邻正文行
 *  合并为通顺段落。不改写正文、不新增解释。
 *  ⚠️ 失败/超时/返回空 → 自动降级为原文，绝不阻塞主链路。 */
async function llmFilterOcrText(text: string): Promise<string> {
  const t = (text || "").trim()
  if (!t || t.length < 8) return text // 太短无需清洗
  if (t.length > MAX_QUESTION_LEN) return text // 超上下文则跳过，避免截断
  const prompt =
    "下面是一张小学语文试卷/课本页面经 OCR 识别出的文本，可能混有噪声。请做如下清洗：\n" +
    "1) 只保留题目/正文（课文、题目、选项、答案、标题等），删除所有非题目信息（页眉页脚、页码、水印、" +
    "广告、图标文字、纯分隔线、装饰性乱码）；\n" +
    "2) 删除所有括号（）/( )，包括空括号（ ）（答案、注释、小提示、填空横线均按需求全部过滤）；\n" +
    "3) 删除「整行只有下划线」的批注线/分隔线（老师画的横线）；**行内的填空下划线必须原样保留**" +
    "（填空横线要填几个字是语义，删了学生就看不出要填几格）；\n" +
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

// ── 多音字标注（语文专属） ──

/** C 方案：PaddleOCR 主路径不标多音字（polyphones 恒空），这里用 LLM 对整页文本补一次。
 *  这样既保住 Paddle 4 秒级速度，又保住点读/注音的多音字正确性。失败不阻塞主链路。
 *
 *  ⚠️ 模型选型教训：deepseek-v4-flash / Ark 托管的 deepseek-v4-flash-ga-260731 都是思考模型，
 *  disableThinking 无效，补多音字这种要"直接输出短 JSON"的任务会被思维链耗尽 max_tokens
 *  → 空 content + 70s。因此**强制用已验证可用的豆包多模态模型**（纯文本调用不传图）。 */
async function fillPolyphones(blocks: Block[]): Promise<Block[]> {
  const text = (blocks || [])
    .filter((b) => b?.type && b.type !== "table")
    .map((b) => b?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim()
  if (!text || text.length > MAX_QUESTION_LEN) return blocks
  const prompt = CHINESE_POLYPHONES_PROMPT.replace("{text}", text)
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
    if (!reply) {
      console.warn("[parse-image] 豆包补多音字返回空，保持空 polyphones")
      return blocks
    }
  } catch (e) {
    console.warn(`[parse-image] 豆包补多音字失败(保持空): ${(e as Error).message}`)
    return blocks
  }
  const data = parseJsonObj(reply)
  // cleanPolyphones：值必须是真拼音，挡掉「(非多音，跳过)」这类被模型写进值里的说明文字
  const poly = data?.polyphones ? cleanPolyphones(data.polyphones) : {}
  if (Object.keys(poly).length) {
    return (blocks || []).map((b) =>
      b?.type && b.type !== "table" ? { ...b, polyphones: { ...(b.polyphones || {}), ...poly } } : b,
    )
  }
  return blocks
}

/** 注音补丁缓存键（语文专属）。路由的 `/ai-chinese/parse-polyphones` 轮询接口也用它。 */
export function polyPatchKey(hash: string): string {
  return `${CACHE_DIR}/poly_${hash}.json`
}

/** 异步补多音字：主请求先返回无注音结果，注音在 waitUntil 后台补，补完写「补丁缓存」，
 *  前端拿到 poly_token 轮询补丁接口回填。同时**回写主缓存**（带注音版本），
 *  保证后续同图命中也带注音、无需再轮询。 */
async function runPolyphonesAsync(
  blocks: Block[],
  patchKey: string,
  mainCacheKey: string,
  basePayload: Record<string, unknown>,
): Promise<void> {
  try {
    const t0 = Date.now()
    const filled = await fillPolyphones(blocks)
    const poly: Record<string, string> = {}
    for (const b of filled || []) {
      if (b?.polyphones && typeof b.polyphones === "object") Object.assign(poly, b.polyphones)
    }
    await writeCache(patchKey, { ready: true, polyphones: poly })
    try {
      await writeCache(mainCacheKey, { ...basePayload, blocks: filled })
    } catch {
      /* 主缓存回写失败不影响补丁可用性 */
    }
    console.log(`[parse-image] 异步补多音字完成, 耗时 ${Date.now() - t0}ms, 多音字 ${Object.keys(poly).length} 个`)
  } catch (e) {
    console.warn(`[parse-image] 异步补多音字失败(保持空注音): ${(e as Error).message}`)
    try {
      await writeCache(patchKey, { ready: true, polyphones: {} }) // 写 ready 标记，避免前端轮询到超时
    } catch {
      /* 忽略 */
    }
  }
}

// ── 识图 + 结构化排版 ──

/** 两段式（回退路径）：豆包 OCR 出纯文本 → 排版出 JSON。表格模式也走这里。 */
async function chineseTwoPass(imageKey: string, isTable = false): Promise<{ text: string; blocks: Block[] }> {
  const ark = getArk()
  // 逐行保真需要看清小字/拼音/下划线 —— 用更高的识别分辨率（区域切割专用 1400px，而非普通识图 800px）
  const base = (imageKey.split("/").pop() || "img").replace(/\.[^.]+$/, "")
  const compressed = await compressImageToFile(imageKey, `${IMAGE_DIR}/${base}.region.jpg`, 1400, 90)
  const reply = await ark.chat({
    prompt: isTable ? DOUBAO_TABLE_OCR_PROMPT : DOUBAO_OCR_PROMPT,
    image_paths: [compressed],
    max_tokens: 4096,
    model_override: multimodalModel(),
    disable_thinking: true,
    timeout_ms: 45_000,
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
        timeout_ms: 60_000,
      })
      const blocks = finalizeChineseBlocks(mergeTableBlocks(extractBlocks(relayoutReply || ""), tables))
      if (blocks.length) return { text, blocks }
    }
  } catch (e) {
    console.warn(`[ai-chinese] 豆包 OCR 免费排版失败，改走 deepseek 兜底: ${(e as Error).message}`)
  }
  try {
    const blocks = mergeTableBlocks(await deepseekRelayout(text), tables)
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

/** 合并调用（主路径）：一次让豆包直接出结构化 JSON，砍掉「OCR 45s + 排版 60s」两段串行。
 *  解析为空或抛错 → 自动回退两段式，质量不退化。 */
async function chineseMergedCall(
  imageKey: string,
  includePolyphones: boolean,
): Promise<{ text: string; blocks: Block[]; structured: boolean }> {
  const ark = getArk()
  // Ark 未配置是硬错误：抛出后由 runChineseOcr 落到 OCR API 回退链（与改造前一致）
  if (!ark.enabled) throw new Error("免费 AI 服务未配置（缺少 ARK_API_KEY）")
  const tStart = Date.now()
  try {
    // includePolyphones=false（poly_async=1 默认）：合并调用不输出 polyphones，注音由后台补，
    // 避免关键路径上多生成一坨 JSON（省时间 + 降截断风险）。
    // max_tokens 给足 8192：text 与 lines 内容重复、表格页还要嵌 HTML，4096 极易被截断。
    const reply = await ark.chat({
      prompt: includePolyphones ? DOUBAO_OCR_JSON_PROMPT : DOUBAO_OCR_JSON_PROMPT_NO_POLY,
      image_paths: [imageKey], // 客户端已压到 1600px，后端不再重复压缩
      system_prompt: "你是一个只输出JSON的小学语文识别排版器。",
      max_tokens: 8192,
      model_override: multimodalModel(),
      disable_thinking: true,
      timeout_ms: 60_000,
    })
    const blocks = finalizeChineseBlocks(mergeTableBlocks(extractBlocks(reply || ""), []))
    if (blocks.length) {
      console.log(`[ai-chinese] 合并调用成功 blocks=${blocks.length} total=${Date.now() - tStart}ms`)
      return { text: blocks.map((b) => b.text).join("\n"), blocks, structured: true }
    }
    console.warn(`[ai-chinese] 合并调用解析为空,回退两段式 (已耗时 ${Date.now() - tStart}ms)`)
  } catch (e) {
    console.warn(`[ai-chinese] 合并调用失败,回退两段式: ${(e as Error).message} (已耗时 ${Date.now() - tStart}ms)`)
  }
  const fallback = await chineseTwoPass(imageKey)
  console.log(`[ai-chinese] 两段式完成 blocks=${fallback.blocks.length}`)
  return { ...fallback, structured: false }
}

// ── 缓存命中路径（语文档位清洗） ──

export function chineseCacheKey(imageHash: string): string {
  return `${CACHE_DIR}/parse_${imageHash}${CHINESE_CACHE_SUFFIX}.json`
}

export async function readChineseCachedOutcome(
  imageHash: string,
  allowPolyAsync: boolean,
): Promise<SubjectOcrOutcome | null> {
  const cached = await readCacheJson(chineseCacheKey(imageHash))
  if (!cached) return null
  const cachedText = cleanOcrText(recoverTextFromJson(String(cached?.text ?? ""))).trim()
  const deduped = dedupeLines(cachedText).trim()
  const cachedBlocks = Array.isArray(cached?.blocks) ? (cached.blocks as Block[]) : []
  // 课本扫描清洗（命中缓存也要过滤：去印刷拼音 + 去角落页码）
  const cleanedText = cleanBookScanText(deduped, { stripPinyin: true })
  const cleanedBlocks = sanitizeBlockPolyphones(cleanBookScanBlocks(cachedBlocks, { stripPinyin: true }))
  const cleanedQs = splitQuestions(cleanedText)
  // 命中缓存但注音为空（异步路径先落的无注音版本）→ 给 token 让前端轮询补丁
  const hasPoly = cachedBlocks.some((b) => b?.polyphones && Object.keys(b.polyphones).length)
  const pending = allowPolyAsync && !hasPoly
  return {
    text: cleanedText,
    questions: cleanedQs.length ? cleanedQs : cleanedText ? [cleanedText] : [],
    blocks: cleanedBlocks,
    pageBounds: cached?.page_bounds ?? null,
    crops: Array.isArray(cached?.crops) ? cached.crops : [],
    polyToken: pending ? imageHash : undefined,
  }
}

// ── 识别主链路 ──

export interface ChineseOcrInput {
  /** 已做 EXIF 校正的图片路径 */
  oriented: string
  /** 前端显式 engine 参数（已 trim + lowercase） */
  reqEngine: string
  /** env.OCR_ENGINE（已 trim + lowercase） */
  envEngine: string
  /** 是否允许异步补注音（前端未传 poly_async=0） */
  allowPolyAsync: boolean
  /** 内容 sha256（缓存键 + 补丁键） */
  imageHash: string
}

/** 语文识别的完整垂直链路：引擎选择 → 提示词 → 清洗 → 分题 → 注音 → 落缓存。
 *
 *  引擎策略（语文专属，与英语/数学都不同）：**默认 Paddle 优先**；
 *  前端显式 `engine=paddle|doubao` 覆盖一切，其次 `env.OCR_ENGINE=doubao` 可跳过 Paddle。 */
export async function runChineseOcr(input: ChineseOcrInput): Promise<SubjectOcrOutcome> {
  const { oriented, reqEngine, envEngine, allowPolyAsync, imageHash } = input
  const cacheKey = chineseCacheKey(imageHash)

  let usePaddleFirst: boolean
  if (reqEngine === "paddle") usePaddleFirst = true
  else if (reqEngine === "doubao") usePaddleFirst = false
  else usePaddleFirst = envEngine !== "doubao"
  console.log(`[parse-image] 识图引擎: req=${reqEngine || "(无)"} env=${envEngine || "(无)"} → ${usePaddleFirst ? "PaddleOCR优先" : "豆包优先"}`)

  let text = ""
  let blocks: Block[] = []
  let arkErr: string | null = null
  let ocrErr: string | null = null
  let usedPaddle = false
  let arkStructured = false

  if (usePaddleFirst) {
    try {
      const po = await paddleOcrExtract(oriented, { timeoutMs: 20_000 })
      if (po.ok && po.blocks.length) {
        text = po.text
        blocks = po.blocks
        usedPaddle = true
        console.log(`[parse-image] PaddleOCR 第一选项成功, blocks=${blocks.length}`)
        // Paddle 不标多音字，用豆包补一次（保住点读/注音正确性）；失败自动降级为词库默认读音。
        // poly_async 开启时不在此处串行等待（原 +3~35s 白等），交给后台补。
        if (!allowPolyAsync) {
          const fpT0 = Date.now()
          blocks = await fillPolyphones(blocks)
          console.log(`[parse-image] 补多音字完成, 耗时 ${Date.now() - fpT0}ms`)
        }
      } else {
        console.warn(`[parse-image] PaddleOCR 未产出(${po.ms ?? 0}ms): ${po.error}; 回退豆包`)
      }
    } catch (e) {
      console.warn(`[parse-image] PaddleOCR 异常, 回退豆包: ${(e as Error).message}`)
    }
  }

  if (!usedPaddle) {
    try {
      const result = await chineseMergedCall(oriented, !allowPolyAsync)
      arkStructured = result.structured
      text = result.text
      blocks = result.blocks
      console.log(`[parse-image] Ark 识图+排版完成, 文本长度 ${text.length}, structured=${arkStructured}`)
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
  }

  text = cleanOcrText(text).trim()
  text = recoverTextFromJson(text).trim()
  // 结构化输出路径（Paddle、豆包合并调用）直接跳过 LLM 去噪：两者都是专用文档 OCR 的
  // 结构化输出，前面 cleanOcrText/stripQuestionNoise 确定性清理足够，省一次串行 LLM
  //（约 2-5s，最坏 30s 超时）；仅两段式/OCR API 回退链路保留（它们的原始输出噪声概率高）。
  const needLlmDenoise = !usedPaddle && !arkStructured
  text = stripQuestionNoise(needLlmDenoise ? await llmFilterOcrText(text) : text)
  // 课本扫描清洗：去印刷拼音（系统后续自己注音）+ 去角落页码
  text = cleanBookScanText(text, { stripPinyin: true })
  blocks = cleanBookScanBlocks(blocks, { stripPinyin: true })
  console.log(`[parse-image] 识别完成, 文本长度 ${text.length}, blocks=${blocks.length}`)

  if (!text) {
    const diag =
      `豆包识图:${arkErr || "成功但无文本"}` + (ocrErr ? `；OCR回退:${ocrErr}` : "；OCR回退:无产出")
    return { text: "", blocks: [], questions: [], pageBounds: null, crops: [], error: diag }
  }

  const questions = splitQuestions(text)
  // 页面区域裁剪：原 detectRegions 已随 Python OpenCV 依赖移除而降级为空数组
  //（豆包 OCR 已能整页识别+排版，crops 仅作附图对照增强，非关键路径）
  const crops: unknown[] = []
  const pageBounds = null

  // 异步补注音：主响应不受影响，补完前端凭 poly_token 轮询回填
  const polyToken = allowPolyAsync && blocks.length ? imageHash : null
  const cachePayload = { text, questions, blocks, page_bounds: pageBounds, crops }
  await writeCache(cacheKey, cachePayload)

  const background: Promise<unknown>[] = polyToken
    ? [runPolyphonesAsync(blocks, polyPatchKey(polyToken), cacheKey, cachePayload)]
    : []
  return { text, questions, blocks, pageBounds, crops, background, polyToken: polyToken ?? undefined }
}
