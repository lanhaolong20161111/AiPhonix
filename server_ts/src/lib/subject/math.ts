/** 数学学科链路 —— 一条自洽的垂直链路：数学自己的提示词 → 自己的后处理 → 自己的分题。
 *
 *  §7 隔离要点：数学与语文/英语**不共用任何策略**。具体地：
 *    · 清洗器是 `mathClean`，**不是** `cleanOcrText`
 *    · 分题用 `splitProblemsByNumber`（只按【题N】/行首题号，**不按空行**）
 *    · 不缩进、不做诗歌标记、不去印刷拼音、不补多音字
 *
 *  因此本文件里**没有任何 `if (subject === ...)` / `profile` / `lineCleaner` 判断**，
 *  改数学不会波及语文或英语，也不需要调用方记得传对开关。
 *
 *  ⚠️ 为什么隔离数学不是洁癖，是止血（实测证据）：
 *    `cleanOcrText` 的字符类里有 `\u25a1`，而数学填空题的方框正是 `□`。
 *    语文档位的 `2. 填空：□ + 5 = 9` 会被清洗成 `2. 填空： + 5 = 9` —— 方框直接消失。
 *    历史上数学共用语文清洗器，靠调用方"记得传 lineCleaner"才没出事；漏传过一次就是事故。
 *
 *  ⚠️ 本文件与 server_cf/src/lib/subject/math.ts 的**已知差距**（本次隔离不改，留给下一步）：
 *    server_ts 没有 `MATH_OCR_JSON_PROMPT`，所以数学链**只出纯文本、blocks 恒为空**
 *    （前端拿不到题号/选项/竖式的结构，只能按纯文本渲染）；server_cf 那边已经有
 *    「结构化 OCR（keepLineSpaces）→ 失败回退纯文本」的二段式，并由此产生了
 *    `finalizeMathBlocks`。要补齐需三步：① prompts.ts 加 MATH_OCR_JSON_PROMPT；
 *    ② aiTextUtils.extractBlocks 加 `{ keepLineSpaces }`；③ 本文件补 `finalizeMathBlocks`
 *    并把 runMathOcr 改成二段式。在此之前**不预置** `finalizeMathBlocks` —— 那会是一段
 *    永远不被调用的死代码。
 */
import { join } from "node:path"
import type { Block } from "../aiTextUtils.js"
import { dedupeLines, recoverTextFromJson, splitProblemsByNumber } from "../aiTextUtils.js"
import { MATH_OCR_PROMPT } from "../prompts.js"
import { getArk } from "../ark.js"
import { multimodalModel } from "../aiChineseContext.js"
import { compressImageToFile } from "../image.js"
import { ocrChain } from "../ocr.js"
import { DATA_DIR } from "../../env.js"
import {
  readCacheJson,
  writeCacheJson,
  type SubjectOcrOutcome,
} from "./kernel.js"

/** 数学的存储位置（与语文/英语各自的目录天然隔离，不存在键名撞车） */
export const MATH_IMAGE_DIR = join(DATA_DIR, "ai_homework_images")
export const MATH_CACHE_DIR = join(DATA_DIR, "ai_homework_cache")

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

// ── 缓存键（数学档位） ──

export function mathCacheKey(imageHash: string): string {
  return join(MATH_CACHE_DIR, `parse_${imageHash}.json`)
}

/** 命中缓存 → 按**数学档位**清洗后返回完整结果；未命中或缓存损坏 → null（路由继续走识别）。
 *
 *  ⚠️ 读出路径必须同样清洗：旧版本写进去的缓存可能含 LaTeX 脏文本，
 *  只在写入路径清洗挡不住历史缓存。 */
export async function readMathCachedOutcome(imageHash: string): Promise<SubjectOcrOutcome | null> {
  const cached = await readCacheJson(mathCacheKey(imageHash))
  if (!cached) return null
  const cachedText = mathClean(recoverTextFromJson(String(cached.text ?? ""))).trim()
  const deduped = dedupeLines(cachedText).trim()
  const cachedQs = (Array.isArray(cached.questions) ? cached.questions : []).map(String).filter(Boolean)
  return {
    text: deduped,
    questions: cachedQs.length ? cachedQs : deduped ? [deduped] : [],
    blocks: Array.isArray(cached.blocks) ? (cached.blocks as Block[]) : [],
    pageBounds: cached.page_bounds ?? null,
    crops: Array.isArray(cached.crops) ? cached.crops : [],
  }
}

// ── 识别主链路 ──

export interface MathOcrInput {
  /** 已做 EXIF 校正的图片路径 */
  oriented: string
  /** 内容 sha256（缓存键） */
  imageHash: string
  /** 前端显式 engine 参数（server_ts 尚无 Paddle 引擎，仅记日志） */
  reqEngine?: string
}

/** 数学识别的完整垂直链路：提示词 → 清洗 → 分题 → 落缓存。
 *
 *  引擎：server_ts 只有豆包多模态一条路（`engine` 参数不影响本链路），
 *  与 server_cf 的「只有显式 engine=paddle 才走 PaddleOCR-VL」不同 —— 各写各的，不共用开关。 */
export async function runMathOcr(input: MathOcrInput): Promise<SubjectOcrOutcome> {
  const { oriented, imageHash, reqEngine } = input
  if (reqEngine) console.log(`[ai-homework] 收到 engine=${reqEngine}（server_ts 暂无该引擎，仍走豆包）`)

  let text = ""
  let arkErr: string | null = null
  let ocrErr: string | null = null

  try {
    // 区域切图放在原图旁边（同名 .region.jpg），与改造前一致
    const base = (oriented.split("/").pop() || "img").replace(/\.[^.]+$/, "")
    const compressed = await compressImageToFile(oriented, join(MATH_IMAGE_DIR, `${base}.region.jpg`), 2000, 90)
    const reply = await getArk().chat({
      prompt: MATH_OCR_PROMPT,
      image_paths: [compressed],
      max_tokens: 4096,
      model_override: multimodalModel(),
      disable_thinking: true,
    })
    text = dedupeLines(mathClean(reply || "")).trim()
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
    return { text: "", blocks: [], questions: [], pageBounds: null, crops: [], error: diag }
  }

  const questions = splitProblemsByNumber(text)
  const blocks: Block[] = [] // 见文件头「已知差距」：server_ts 数学链暂无结构化输出
  const pageBounds = null
  const crops: unknown[] = []
  await writeCacheJson(mathCacheKey(imageHash), { text, questions, blocks, page_bounds: pageBounds, crops })
  return { text, questions, blocks, pageBounds, crops }
}
