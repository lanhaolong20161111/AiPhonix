/** PaddleOCR（百度方舟托管文档 OCR）服务端调用。
 *
 * 两个模型入口：
 * - paddleOcrExtract：PaddleOCR-VL-1.6 文档 OCR，产出「纯文本 + blocks」，供 ai-chinese parse-image
 *   作第一选项（失败/超时回退豆包）。
 * - paddleV6DetectBlocks：PP-OCRv6 文本行检测，产出每行文本 + 归一化 bbox，供前端「切块识别」
 *   绿框预览（替代原 OpenCV.js 前端检测）。
 *
 * API 形态：异步任务（submit → poll → 下载 JSONL）。用 Workers 原生 fetch + FormData + Blob，
 * 不引第三方 SDK（与项目「轻量依赖」基调一致）。
 *
 * 注意：
 * - paddleOcrExtract 只产出「纯 OCR 文本 + 结构」，不输出拼音注音（polyphones 为空）。
 *   需要注音时仍走豆包回退（其提示词要求模型标多音字）。
 * - 轮询有总时长上限，超时即视为失败 → 触发回退，避免拖垮整个请求。
 */
import { readBlob, exists } from "./storage.js"
import { getEnv } from "../env.js"
import { cleanOcrText } from "./aiTextUtils.js"
import { markdownToBlocks, stripEmbeddedHtml } from "./paddleMarkdown.js"

const JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
const MODEL = "PaddleOCR-VL-1.6"

// ── 熔断器（2026-09-02）─────────────────────────────────────────────
// 实测 aistudio 托管服务拥堵时 pending 可达 56s~240s+（健康时全程 ~1s）。
// 拥堵期走完 75s 超时再回退豆包，用户最差等 ~113s。故：连续慢失败 2 次
// → 熔断 5 分钟，期间所有 Paddle 调用立即返回失败（调用方秒切豆包）；
// 冷却期满放行一次试探（半开），成功复位、再失败重新计时。
// 状态存模块级变量：随 Worker isolate 存活，重启/部署自动复位，足够用。
const BREAKER_THRESHOLD = 2 // 连续慢失败次数阈值
const BREAKER_COOLDOWN_MS = 5 * 60_000 // 熔断冷却时长
const breaker = { failStreak: 0, openedAt: 0 }

function breakerAllows(): boolean {
  if (breaker.failStreak < BREAKER_THRESHOLD) return true
  return Date.now() - breaker.openedAt >= BREAKER_COOLDOWN_MS
}

/** 记录一次结果。只统计「慢失败」（耗时 ≥15s 的失败）——秒级快失败（HTTP 4xx/
 * 参数错误）不浪费用户时间，没有熔断价值；成功立即复位。 */
function breakerRecord(ms: number, ok: boolean) {
  if (ok) {
    breaker.failStreak = 0
    return
  }
  if (ms < 15_000) return
  breaker.failStreak++
  if (breaker.failStreak >= BREAKER_THRESHOLD) breaker.openedAt = Date.now()
}

function breakerBlockedOutcome(): string {
  return `Paddle 熔断冷却中（连续慢失败 ${breaker.failStreak} 次），跳过以直接回退豆包`
}

export interface PaddleOcrOutcome {
  ok: boolean
  text: string
  blocks: any[]
  markdown: string
  error?: string
  ms?: number
}

/** PaddleOCR 识别开关。不传 → 速度优先默认（全 false，见下方 optionalPayload）。
 * 数学通道开启 layoutParsing+useFormulaRecognition+useChartRecognition+useTableRecognition。 */
export interface PaddleOcrOpts {
  timeoutMs?: number
  ocr?: {
    layoutParsing?: boolean
    useFormulaRecognition?: boolean
    useChartRecognition?: boolean
    useTableRecognition?: boolean
    useDocOrientationClassify?: boolean
    useDocUnwarping?: boolean
  }
}

/** 读 R2 图片 → 提交任务 → 轮询 → 解析 markdown → 转 blocks（带熔断器）。
 * 任何失败/超时返回 ok:false（error 说明原因），由调用方回退豆包。 */
export async function paddleOcrExtract(
  imageKey: string,
  opts: PaddleOcrOpts = {},
): Promise<PaddleOcrOutcome> {
  if (!breakerAllows()) {
    return { ok: false, text: "", blocks: [], markdown: "", error: breakerBlockedOutcome(), ms: 0 }
  }
  const out = await paddleOcrExtractOnce(imageKey, opts)
  breakerRecord(out.ms ?? 0, out.ok)
  return out
}

async function paddleOcrExtractOnce(
  imageKey: string,
  opts: PaddleOcrOpts = {},
): Promise<PaddleOcrOutcome> {
  const token = getEnv().PADDLE_OCR_TOKEN || ""
  if (!token) return { ok: false, text: "", blocks: [], markdown: "", error: "PADDLE_OCR_TOKEN 未配置" }
  if (!(await exists(imageKey))) return { ok: false, text: "", blocks: [], markdown: "", error: "图片不存在" }
  const buf = await readBlob(imageKey)
  if (!buf) return { ok: false, text: "", blocks: [], markdown: "", error: "读图失败" }

  const t0 = Date.now()
  const timeoutMs = opts.timeoutMs ?? 20_000
  const headers = { Authorization: `bearer ${token}` }
  // 速度优先默认（2026-09 提速）：逐页几何矫正/图表/表格识别会拖慢每张图，且对小学试卷整页
  // 识别收益有限；useTableRecognition 还会把文字误排成 markdown 表格块（既拖慢又在前端渲染成
  // 怪异 HTML table）。故默认全 false。数学通道显式开启 layoutParsing+useFormulaRecognition+
  // useChartRecognition+useTableRecognition（公式识别是数学题核心），由调用方 opts.ocr 传入。
  const o = opts.ocr ?? {}
  const optionalPayload = JSON.stringify({
    layoutParsing: o.layoutParsing ?? false,
    useFormulaRecognition: o.useFormulaRecognition ?? false,
    useChartRecognition: o.useChartRecognition ?? false,
    useTableRecognition: o.useTableRecognition ?? false,
    useDocOrientationClassify: o.useDocOrientationClassify ?? false,
    useDocUnwarping: o.useDocUnwarping ?? false,
  })

  const form = new FormData()
  form.append("model", MODEL)
  form.append("optionalPayload", optionalPayload)
  form.append("file", new Blob([buf], { type: "image/jpeg" }), "page.jpg")

  let jobId = ""
  try {
    const submit = await fetch(JOB_URL, { method: "POST", headers, body: form })
    if (submit.status !== 200) {
      const body = await submit.text().catch(() => "")
      return { ok: false, text: "", blocks: [], markdown: "", error: `submit HTTP ${submit.status}: ${body.slice(0, 200)}`, ms: Date.now() - t0 }
    }
    const sj = (await submit.json()) as any
    jobId = sj?.data?.jobId
    if (!jobId) return { ok: false, text: "", blocks: [], markdown: "", error: `无 jobId: ${JSON.stringify(sj).slice(0, 200)}`, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, text: "", blocks: [], markdown: "", error: `submit 异常: ${(e as Error).message}`, ms: Date.now() - t0 }
  }

  console.log(`[paddle-ocr] 提交任务 ${jobId} (${(Date.now() - t0)}ms)`)

  let jsonlUrl = ""
  let lastState = ""
  while (Date.now() - t0 < timeoutMs) {
    try {
      const rr = await fetch(`${JOB_URL}/${jobId}`, { headers })
      if (rr.status !== 200) {
        return { ok: false, text: "", blocks: [], markdown: "", error: `poll HTTP ${rr.status}`, ms: Date.now() - t0 }
      }
      const d = (await rr.json() as any)?.data
      const state = d?.state
      if (state !== lastState) {
        console.log(`[paddle-ocr] 状态 ${state} (${(Date.now() - t0)}ms)`)
        lastState = state
      }
      if (state === "done") {
        jsonlUrl = d?.resultUrl?.jsonUrl
        break
      }
      if (state === "failed") {
        return { ok: false, text: "", blocks: [], markdown: "", error: `任务失败: ${d?.errorMsg}`, ms: Date.now() - t0 }
      }
    } catch (e) {
      return { ok: false, text: "", blocks: [], markdown: "", error: `poll 异常: ${(e as Error).message}`, ms: Date.now() - t0 }
    }
    // 自适应轮询：任务健康时多在 1-10s 完成，前段 800ms 高频查询把完成感知
    // 延迟从最多 3s 降到 <1s；排队/处理越久越降频，减少无效请求。
    const elapsed = Date.now() - t0
    await new Promise((r) => setTimeout(r, elapsed < 10_000 ? 800 : elapsed < 30_000 ? 1500 : 2500))
  }
  if (!jsonlUrl) {
    return { ok: false, text: "", blocks: [], markdown: "", error: `轮询超时 ${timeoutMs}ms`, ms: Date.now() - t0 }
  }

  // 下载 JSONL → 合并各页 markdown
  // resultUrl 是预签名临时下载链接，自包含认证，不能再带 Authorization header
  //（否则签名校验失败 → HTTP 400）。若个别环境要求 header，这里先试裸请求。
  let md = ""
  try {
    const jr = await fetch(jsonlUrl)
    if (jr.status !== 200) return { ok: false, text: "", blocks: [], markdown: "", error: `jsonl HTTP ${jr.status}`, ms: Date.now() - t0 }
    const text = await jr.text()
    for (const line of text.split("\n")) {
      const s = line.trim()
      if (!s) continue
      try {
        const res = (JSON.parse(s) as any)?.result
        for (const r2 of res?.layoutParsingResults ?? []) {
          md += (r2?.markdown?.text ?? "") + "\n"
        }
      } catch {
        /* 跳过坏行 */
      }
    }
  } catch (e) {
    return { ok: false, text: "", blocks: [], markdown: "", error: `jsonl 异常: ${(e as Error).message}`, ms: Date.now() - t0 }
  }

  // 清理：PaddleOCR 会把图内子图嵌成 <div><img> 裸 HTML（前端不渲染行内图），
  // 且带 LaTeX 注音/数学残留（\underset{字}{拼音}、$...$、\text、\frac、\cdot 等）。
  // stripEmbeddedHtml 剥 <img>/<div>/<figure>，cleanOcrText 清 $ 与 LaTeX 命令、注音转"字(拼音)"。
  const cleanedMd = cleanOcrText(stripEmbeddedHtml(md))
  const blocks = markdownToBlocks(cleanedMd)
  console.log(`[paddle-ocr] 完成 总耗时 ${Date.now() - t0}ms, md字符=${md.length}, blocks=${blocks.length}`)
  // 保留段落空行（版面结构）：只做收敛（3+ 空行→1 个空行）与行尾空白清理。
  // 原先 replace(/\n{2,}/g,"\n") 会把空行压成单换行 → text 丢掉段落边界，
  // 前端只能靠启发式猜段落（「标题和正文挤一行」的根因之一）。blocks 一直没受影响。
  const cleaned = cleanedMd.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return { ok: true, text: cleaned, blocks, markdown: md, ms: Date.now() - t0 }
}


// ── PP-OCRv6 文本行检测（切块识图绿框用） ──────────────────────────────
const V6_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
const V6_MODEL = "PP-OCRv6"

export interface PaddleV6Block {
  /** 该行识别文本 */
  text: string
  /** 置信度 0~1 */
  score: number
  /** 归一化 bbox（相对 dataInfo.width/height） */
  nx: number
  ny: number
  nw: number
  nh: number
  /** 阅读顺序（自上而下，同行左→右） */
  order: number
}

export interface PaddleV6Outcome {
  ok: boolean
  blocks: PaddleV6Block[]
  width: number
  height: number
  error?: string
  ms?: number
}

/**
 * PP-OCRv6 文本行检测 → 归一化 bbox 列表（0~1，相对原图 dataInfo 尺寸）。
 *
 * 只跑纯文字检测（不做文档矫正/去扭曲/方向分类，避免坐标被透视变换扰乱），
 * 与用户脚本 optionalPayload 全 False 一致。前端拿归一化坐标后按自身 naturalWidth/Height
 * 放大回绝对像素即可画绿框。
 *
 * rec_boxes 坐标以 dataInfo（= 原图真实像素，见 _paddle_probe 验证 2304×1728 与 JPEG 头一致）
 * 为基准，故 nx = x / dataInfo.width、nh = (bottom-top) / dataInfo.height 即可得到 0~1 比例。
 */
/** PP-OCRv6 文本行检测 → 归一化 bbox 列表（0~1，相对原图 dataInfo 尺寸）。带熔断器：
 * 与 paddleOcrExtract 共用熔断状态——服务拥堵时切块绿框检测同样跳过，
 * 前端自动退化为无吸附的自由框选，不阻塞用户。 */
export async function paddleV6DetectBlocks(
  imageKey: string,
  opts: { timeoutMs?: number } = {},
): Promise<PaddleV6Outcome> {
  if (!breakerAllows()) {
    return { ok: false, blocks: [], width: 0, height: 0, error: breakerBlockedOutcome(), ms: 0 }
  }
  const out = await paddleV6DetectBlocksOnce(imageKey, opts)
  breakerRecord(out.ms ?? 0, out.ok)
  return out
}

async function paddleV6DetectBlocksOnce(
  imageKey: string,
  opts: { timeoutMs?: number } = {},
): Promise<PaddleV6Outcome> {
  const token = getEnv().PADDLE_OCR_TOKEN || ""
  if (!token) return { ok: false, blocks: [], width: 0, height: 0, error: "PADDLE_OCR_TOKEN 未配置" }
  if (!(await exists(imageKey))) return { ok: false, blocks: [], width: 0, height: 0, error: "图片不存在" }
  const buf = await readBlob(imageKey)
  if (!buf) return { ok: false, blocks: [], width: 0, height: 0, error: "读图失败" }

  const t0 = Date.now()
  const timeoutMs = opts.timeoutMs ?? 60_000
  const headers = { Authorization: `bearer ${token}` }
  const optionalPayload = JSON.stringify({
    useDocOrientationClassify: false,
    useDocUnwarping: false,
    useTextlineOrientation: false,
  })

  const form = new FormData()
  form.append("model", V6_MODEL)
  form.append("optionalPayload", optionalPayload)
  form.append("file", new Blob([buf], { type: "image/jpeg" }), "page.jpg")

  let jobId = ""
  try {
    const submit = await fetch(V6_JOB_URL, { method: "POST", headers, body: form })
    if (submit.status !== 200) {
      const body = await submit.text().catch(() => "")
      return { ok: false, blocks: [], width: 0, height: 0, error: `submit HTTP ${submit.status}: ${body.slice(0, 200)}`, ms: Date.now() - t0 }
    }
    const sj = (await submit.json()) as any
    jobId = sj?.data?.jobId
    if (!jobId) return { ok: false, blocks: [], width: 0, height: 0, error: `无 jobId: ${JSON.stringify(sj).slice(0, 200)}`, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, blocks: [], width: 0, height: 0, error: `submit 异常: ${(e as Error).message}`, ms: Date.now() - t0 }
  }

  let jsonlUrl = ""
  let lastState = ""
  while (Date.now() - t0 < timeoutMs) {
    try {
      const rr = await fetch(`${V6_JOB_URL}/${jobId}`, { headers })
      if (rr.status !== 200) {
        return { ok: false, blocks: [], width: 0, height: 0, error: `poll HTTP ${rr.status}`, ms: Date.now() - t0 }
      }
      const d = (await rr.json() as any)?.data
      const state = d?.state
      if (state !== lastState) {
        lastState = state
      }
      if (state === "done") {
        jsonlUrl = d?.resultUrl?.jsonUrl
        break
      }
      if (state === "failed") {
        return { ok: false, blocks: [], width: 0, height: 0, error: `任务失败: ${d?.errorMsg}`, ms: Date.now() - t0 }
      }
    } catch (e) {
      return { ok: false, blocks: [], width: 0, height: 0, error: `poll 异常: ${(e as Error).message}`, ms: Date.now() - t0 }
    }
    // 自适应轮询（PP-OCRv6 通常秒级完成，前段 800ms 高频查询）
    const elapsed = Date.now() - t0
    await new Promise((r) => setTimeout(r, elapsed < 10_000 ? 800 : 2000))
  }
  if (!jsonlUrl) {
    return { ok: false, blocks: [], width: 0, height: 0, error: `轮询超时 ${timeoutMs}ms`, ms: Date.now() - t0 }
  }

  let width = 0
  let height = 0
  const rawBoxes: { text: string; score: number; left: number; top: number; right: number; bottom: number }[] = []
  try {
    const jr = await fetch(jsonlUrl)
    if (jr.status !== 200) return { ok: false, blocks: [], width: 0, height: 0, error: `jsonl HTTP ${jr.status}`, ms: Date.now() - t0 }
    const text = await jr.text()
    for (const line of text.split("\n")) {
      const s = line.trim()
      if (!s) continue
      try {
        const parsed = JSON.parse(s) as any
        const result = parsed?.result
        const info = result?.dataInfo
        if (info) {
          width = info.width ?? width
          height = info.height ?? height
        }
        for (const r2 of result?.ocrResults ?? []) {
          const pr = r2?.prunedResult
          const texts: string[] = pr?.rec_texts ?? []
          const scores: number[] = pr?.rec_scores ?? []
          const boxes: number[][] = pr?.rec_boxes ?? [] // [left, top, right, bottom]
          for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i]
            if (!Array.isArray(b) || b.length < 4) continue
            rawBoxes.push({
              text: String(texts[i] ?? ""),
              score: Number(scores[i] ?? 0),
              left: b[0],
              top: b[1],
              right: b[2],
              bottom: b[3],
            })
          }
        }
      } catch {
        /* 跳过坏行 */
      }
    }
  } catch (e) {
    return { ok: false, blocks: [], width: 0, height: 0, error: `jsonl 异常: ${(e as Error).message}`, ms: Date.now() - t0 }
  }

  if (!width || !height || rawBoxes.length === 0) {
    return { ok: false, blocks: [], width, height, error: `未检测到文本块 (w=${width},h=${height},boxes=${rawBoxes.length})`, ms: Date.now() - t0 }
  }

  // 归一化
  const blocks: PaddleV6Block[] = rawBoxes.map((b, i) => {
    const nx = clamp01(b.left / width)
    const ny = clamp01(b.top / height)
    const nw = clamp01(b.right / width) - nx
    const nh = clamp01(b.bottom / height) - ny
    return { text: b.text, score: b.score, nx, ny, nw, nh, order: i }
  })

  console.log(`[paddle-v6] 完成 ${blocks.length} 块 耗时 ${Date.now() - t0}ms (w=${width},h=${height})`)
  return { ok: true, blocks, width, height, ms: Date.now() - t0 }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
