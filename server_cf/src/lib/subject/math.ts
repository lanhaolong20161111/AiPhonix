/** 数学学科链路 —— 一条自洽的垂直链路：数学自己的提示词 → 自己的后处理 → 自己的分题。
 *
 *  §7 隔离要点：数学与语文/英语**不共用任何策略**。具体地：
 *    · 清洗器是 `mathClean`，**不是** `cleanOcrText`
 *    · 保留行首空格（竖式靠空格对齐，trim 掉列位就散了）
 *    · 不缩进、不做诗歌标记、不去印刷拼音、不补多音字
 *    · 分题用 `splitProblemsByNumber`（只按【题N】/行首题号，不按空行）
 *
 *  因此本文件里**没有任何 `if (subject === ...)` / `profile` / `stripPinyin` 判断**，
 *  改数学不会波及语文或英语，也不需要调用方记得传对开关。
 *
 *  ⚠️ 这条隔离不是洁癖，是止血（实测证据）：
 *    `cleanOcrText` 的字符类里有 `\u25a1`，而数学填空题的方框正是 `□`。
 *    语文档位的 `2. 填空：□ + 5 = 9` 会被清洗成 `2. 填空： + 5 = 9` —— 方框直接消失。
 *    历史上数学共用语文清洗器，靠调用方"记得传 lineCleaner"才没出事；漏传过一次就是事故。
 */
import type { Block, BlockLine } from "../aiTextUtils.js"
import {
  dedupeLines,
  extractBlocks,
  mergeMarkdownTableBlocks,
  recoverTextFromJson,
  splitProblemsByNumber,
} from "../aiTextUtils.js"
import { MATH_OCR_PROMPT, MATH_OCR_JSON_PROMPT } from "../prompts.js"
import { getArk, multimodalModel } from "../ark.js"
import { compressImageToFile } from "../image.js"
import { ocrChain } from "../ocr.js"
import { paddleOcrExtract } from "../paddleOcr.js"
import {
  clampIndent,
  dropPageNumberLines,
  joinLines,
  normAlign,
  normType,
  readCacheJson,
  writeCacheJson,
  type RawBlock,
  type RawLine,
  type SubjectOcrOutcome,
} from "./kernel.js"
/** 数学的存储位置（与语文/英语各自的目录天然隔离，不存在键名撞车） */
export const MATH_IMAGE_DIR = "data/ai_homework_images"
export const MATH_CACHE_DIR = "data/ai_homework_cache"
/** 缓存键版本后缀 —— **改提示词/清洗/缩进规则必须 bump**（2026-09-15 试卷规格版：`_r1`；
 *  同日追加「页脚归一化 markFooterBlock」→ `_r2`）。
 *  ⚠️ 与语文 `_r5`／英语 `_en_r6` 同理：不加后缀时旧图会命中旧结构的缓存，
 *  新提示词的 blocks 结构（table/foot/align/indent）永远看不到效果。 */
export const MATH_CACHE_SUFFIX = "_r2"

// ── 行文本清洗器（数学专用） ──

/** 数学行清洗：剥 LaTeX 装饰命令 / 分数 / 根号 / 矩阵标记，**保留 `□` 方框**。
 *  与 `cleanOcrText` 的关键差别：本函数**不删** `\u25a1`（□）—— 它是数学填空方框。 */
export function mathClean(s: string): string {
  let t = s || ""
  t = t.replace(/[\ufffd\u25af\u2588\u258c\u2580\u2590]/g, "")
  // ① 带花括号的排版/装饰命令 → 只取内容（粗体/下划线/方框/顶标/字体命令等）
  t = t.replace(
    /\\(?:boldsymbol|underline|boxed|overline|overrightarrow|widehat|mathrm|mathbf|mathit|mathbb|mathcal|textbf|textit)\{([^{}]*)\}/g,
    "$1",
  )
  // ② 分数 → a/b；根号 → √x
  t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, "√$1")
  // ③ 无参命令 → 对应普通字符/空格
  t = t.replace(/\\(?:square|Box|blacksquare)\b/g, "□")
  t = t.replace(/\\times\b/g, "×")
  t = t.replace(/\\div\b/g, "÷")
  t = t.replace(/\\pm\b/g, "±")
  t = t.replace(/\\leq\b/g, "≤")
  t = t.replace(/\\geq\b/g, "≥")
  t = t.replace(/\\neq\b/g, "≠")
  t = t.replace(/\\approx\b/g, "≈")
  t = t.replace(/\\cdot\b/g, "·")
  t = t.replace(/\\(?:quad|qquad|enspace)\b/g, " ")
  // ④ LaTeX 环境标记整段删掉（\begin{matrix}...\end{matrix} 等，含多参数如 \begin{array}{cc}）；行分隔 \\ → 换行、列分隔 & → 空格
  t = t.replace(/\\begin\{[^{}]*\}(?:\{[^{}]*\})*|\\end\{[^{}]*\}(?:\{[^{}]*\})*/g, "")
  t = t.replace(/\\\\/g, "\n")
  t = t.replace(/&/g, " ")
  // ⑤ 转义字符还原：\_ \{ \} \% \& \# 等
  t = t.replace(/\\([&%#$_{}])/g, "$1")
  // ⑥ 剥 $ 外壳
  t = t.replace(/\$+\^?\{?([^$]*?)\}?\$+/g, "$1")
  t = t.replace(/\$+/g, "")
  // ⑦ HTML 上下标转回普通文本
  t = t.replace(/<sub>([^<]*)<\/sub>/gi, "$1")
  t = t.replace(/<sup>([^<]*)<\/sup>/gi, "$1")
  // ⑧ 兜底：残留的 \command{arg} → arg；残留无参 \command → 删除
  t = t.replace(/\\([a-zA-Z]+)\{([^{}]*)\}/g, "$2")
  t = t.replace(/\\([a-zA-Z]+)\b/g, "")
  return t
}

// ── Block 收尾（数学档位） ──

/** 数学 Block 收尾：保留行首空格、不强制缩进、不做诗歌标记、清洗器锁定 mathClean。
 *
 *  这三条**内联在数学自己的文件里**，不通过参数开关表达 —— 调用方无法漏传、也无法传错。
 *
 *  ⚠️ 数学**不走** `finishBlocks()`（它内含 `markOrderedIndent`）：试卷规格要求「首行顶格 indent=0」，
 *  而 `markOrderedIndent` 会把以「1.」「一、」「①」开头的行一律抬到 indent=1 —— 试卷题干本来就顶格，
 *  抬上去就与原图不符。这里只保留表格结构修正（markdown 竖线表合并 + 内嵌 `<table>` 提升为 table 块）。 */
export function finalizeMathBlocks(raw: unknown[]): Block[] {
  const cleaned = ((raw || []) as RawBlock[])
    .map((b: RawBlock) => {
      const lines = ((b?.lines || []) as RawLine[])
        .map((ln: RawLine) => {
          // 竖式对齐靠行首空格：只裁行尾，绝不 trim 行首
          const lt = mathClean(String(ln?.text ?? "")).replace(/\s+$/, "")
          if (!lt.trim()) return null
          return { text: lt, indent: clampIndent(ln?.indent) } as BlockLine
        })
        .filter(Boolean) as BlockLine[]
      // text 缺失（合并调用提示词刻意省略）→ 由 lines 逐行拼接推导
      let bt = mathClean(String(b?.text ?? "")).replace(/\s+$/, "")
      if (!bt.trim() && lines.length) bt = joinLines(lines)
      if (!bt.trim()) return null
      if (!lines.length) lines.push({ text: bt, indent: 0 })
      return { type: normType(b?.type), text: bt, align: normAlign(b?.align), lines, polyphones: b?.polyphones || {} }
    })
    .filter(Boolean) as Block[]
  const finished = mergeMarkdownTableBlocks(cleaned)
  markFooterBlock(finished)
  return finished
}

// ── 缓存命中路径（数学档位清洗） ──

export function mathCacheKey(imageHash: string): string {
  return `${MATH_CACHE_DIR}/parse_${imageHash}${MATH_CACHE_SUFFIX}.json`
}

/** 命中缓存 → 按**数学档位**清洗后返回完整结果；未命中或缓存损坏 → null（路由继续走识别）。
 *
 *  ⚠️ 读出路径必须同样清洗：旧版本写进去的缓存可能含 LaTeX 脏文本，
 *  只在写入路径清洗挡不住历史缓存。 */
export async function readMathCachedOutcome(imageHash: string): Promise<SubjectOcrOutcome | null> {
  const cached = await readCacheJson(mathCacheKey(imageHash))
  if (!cached) return null
  const cachedText = mathClean(recoverTextFromJson(String(cached?.text ?? ""))).trim()
  const cleanedText = dropPageNumberLines(dedupeLines(cachedText).trim()) // 去角落页码（数学不去拼音）
  const cachedQs = splitProblemsByNumber(cleanedText)
  const blocks = Array.isArray(cached?.blocks) ? (cached.blocks as Block[]) : []
  return {
    text: cleanedText,
    questions: cachedQs.length ? cachedQs : cleanedText ? [cleanedText] : [],
    blocks,
    pageBounds: cached?.page_bounds ?? null,
    crops: Array.isArray(cached?.crops) ? cached.crops : [],
  }
}

// ── 页脚/页码块归一化（数学档位） ──

/** 页脚形态（先折叠空白再匹配）：
 *  「第 1 页 共 4 页」/「第 1 页」/「共 4 页」/「1 / 4」/「- 1 -」 */
const FOOTER_RES = [
  /^第\s*\d{1,4}\s*页(\s*[,，、]?\s*共\s*\d{1,4}\s*页)?$/,
  /^共\s*\d{1,4}\s*页$/,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
  /^[-—–]\s*\d{1,4}\s*[-—–]$/,
]

/** 把「最后一个块」里的页脚/页码行改判为 `foot`（align=center）。
 *
 *  为什么需要这条**服务端归一化**：提示词里已经专门写了「页码行必须 foot、不得写 body」
 *  的独立规则段，但豆包多模态**连续三次实测都固执地给 `body`+`align=center`**
 *  （见 docs/prompts-math-exam.md）。与其反复加重提示词，不如在服务端用确定规则兜住 ——
 *  页脚形态是**可判定的**，不需要模型猜。
 *
 *  ⚠️ 只检查**最后一个块**：正文里「1 / 2」「第 1 页」可能是题目内容（如分数、阅读题），
 *  放开范围会误判。⚠️ 只改 body→foot（已经是 foot 的保持），不动其它类型。 */
export function markFooterBlock(blocks: Block[]): void {
  const last = blocks[blocks.length - 1]
  if (!last) return
  if (last.type !== "body" && last.type !== "foot") return
  if ((last.lines?.length ?? 0) > 2) return
  const raw = last.lines?.length ? joinLines(last.lines) : String(last.text ?? "")
  const t = raw.replace(/\s+/g, " ").trim()
  if (!FOOTER_RES.some((re) => re.test(t))) return
  last.type = "foot"
  last.align = "center"
}

// ── 识别主链路 ──

export interface MathOcrInput {
  /** 已做 EXIF 校正的图片路径 */
  oriented: string
  /** 前端显式 engine 参数（已 trim + lowercase） */
  reqEngine: string
  /** 内容 sha256（缓存键） */
  imageHash: string
}

/** 数学识别的完整垂直链路：引擎选择 → 提示词 → 清洗 → 分题 → 落缓存。
 *
 *  引擎策略（数学专属）：**只有用户显式 `engine=paddle` 才走 PaddleOCR-VL**，
 *  默认（auto / doubao）一律走豆包多模态。数学要看公式，所以 Paddle 档位开公式识别。
 *  这一点与语文（默认 Paddle 优先）和英语（默认豆包优先）都不同 —— 各写各的，不共用开关。 */
export async function runMathOcr(input: MathOcrInput): Promise<SubjectOcrOutcome> {
  const { oriented, reqEngine, imageHash } = input
  const cacheKey = mathCacheKey(imageHash)

  let text = ""
  let blocks: Block[] = []
  let arkErr: string | null = null
  let ocrErr: string | null = null
  let usedPaddle = false

  if (reqEngine === "paddle") {
    try {
      const po = await paddleOcrExtract(oriented, {
        timeoutMs: 60_000,
        ocr: {
          layoutParsing: true,
          useFormulaRecognition: true,
          useChartRecognition: true,
          useTableRecognition: true,
        },
      })
      if (po.ok && po.text) {
        text = po.text
        usedPaddle = true
        blocks = finalizeMathBlocks(po.blocks ?? [])
        console.log(`[ai-homework] PaddleOCR 数学识别成功, 文本长度 ${text.length}, blocks=${blocks.length}`)
      } else {
        console.warn(`[ai-homework] PaddleOCR 未产出(${po.ms ?? 0}ms): ${po.error}; 回退豆包`)
      }
    } catch (e) {
      console.warn(`[ai-homework] PaddleOCR 异常, 回退豆包: ${(e as Error).message}`)
    }
  }

  if (!usedPaddle) {
    try {
      // 区域切图放在原图旁边（同名 .region.jpg），与改造前一致
      const base = (oriented.split("/").pop() || "img").replace(/\.[^.]+$/, "")
      const compressed = await compressImageToFile(oriented, `${MATH_IMAGE_DIR}/${base}.region.jpg`, 2000, 90)
      // ① 结构化 OCR：数学必须有 blocks 承载结构，否则「区分标题/题目/选项/算式/竖式」
      //    这些规则没有字段落地、只能让前端猜。
      //    max_tokens 给足 8192：要一次输出「逐行保真 + JSON 结构」，4096 极易被截断。
      const structured = await getArk().chat({
        prompt: MATH_OCR_JSON_PROMPT,
        image_paths: [compressed],
        max_tokens: 8192,
        model_override: multimodalModel(),
        disable_thinking: true,
      })
      const rawBlocks = extractBlocks(structured || "", { keepLineSpaces: true })
      if (rawBlocks.length) {
        blocks = finalizeMathBlocks(rawBlocks)
        if (blocks.length) {
          text = dedupeLines(blocks.map((b) => b.text).join("\n")).trim()
          console.log(`[ai-homework] 结构化识别成功 blocks=${blocks.length} 文本=${text.length}字`)
        }
      }
      // ② 结构化未产出 → 回退纯文本提示词（与改造前行为一致，零回归）
      if (!blocks.length) {
        console.warn("[ai-homework] 结构化未产出，回退纯文本 OCR")
        const reply = await getArk().chat({
          prompt: MATH_OCR_PROMPT,
          image_paths: [compressed],
          max_tokens: 4096,
          model_override: multimodalModel(),
          disable_thinking: true,
        })
        text = dedupeLines(mathClean(reply || "").trim()).trim()
      }
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
  }

  // Paddle 输出已是清洗后的 markdown（含公式 LaTeX），不再跑 mathClean/recoverTextFromJson
  // （那两个会把 $…$ / \frac 等公式标记剥掉）；豆包路径照旧。
  if (!usedPaddle) {
    text = mathClean(text).trim()
    text = recoverTextFromJson(text).trim()
  } else {
    text = (text || "").trim()
  }
  text = dropPageNumberLines(text) // 去角落页码（数学正文含字母/单位，不去拼音）

  if (!text) {
    const diag =
      `豆包识图:${arkErr || "成功但无文本"}` + (ocrErr ? `；OCR回退:${ocrErr}` : "；OCR回退:无产出")
    return { text: "", blocks: [], questions: [], pageBounds: null, crops: [], error: diag }
  }

  const questions = splitProblemsByNumber(text)
  const pageBounds = null
  const crops: unknown[] = []
  await writeCacheJson(cacheKey, { text, questions, blocks, page_bounds: pageBounds, crops })
  return { text, questions, blocks, pageBounds, crops }
}
