/** 学科无关内核 —— 只含「机制」，不含任何学科策略。
 *
 *  §7 学科隔离（2026-09-15）后，parse-image 链路被切成三份自洽的垂直链路：
 *
 *      lib/subject/chinese.ts   语文
 *      lib/subject/english.ts   英语
 *      lib/subject/math.ts      数学
 *
 *  每个学科模块**自带**：提示词选择、引擎优先级、行文本清洗器、缩进规则、诗歌标记、
 *  多音字策略、印刷拼音策略、缓存键后缀、分题函数。改一个学科不波及其他学科，
 *  也不需要任何 `profile` / `stripPinyin` / `lineCleaner` 开关（元规则 3）。
 *
 *  本文件只放三学科**逐字相同、且不属于任何学科决策**的东西：
 *    · Block 的格式归一化（type/align 枚举回退、indent 夹取、丢空、由 lines 推导 text）
 *    · 结构型归位（markdown 表格合并、正文内嵌 HTML 表格提升、有序行缩进）
 *    · 页码判定与丢弃
 *    · parse-image 的请求/缓存机制（读表单、sha256、R2 缓存读写、图片落盘、EXIF 校正）
 *
 *  ⚠️ 判据：**"如果要在三个学科之间选一个值，就不该出现在这里。"**
 *  能出现在这里的只有"三学科必须完全一样、否则就是 bug"的东西。
 */
import { createHash } from "node:crypto"
import type { Context } from "hono"
import type { Block, BlockLine } from "../aiTextUtils.js"
import {
  hoistHtmlTableBlocks,
  isPageNumberText,
  markOrderedIndent,
  mergeMarkdownTableBlocks,
} from "../aiTextUtils.js"
import { readCache, writeCache } from "../aiShared.js"
import { writeBlob } from "../storage.js"
import { autoOrient } from "../image.js"

// ── Block 格式归一化（契约 §1 硬性约定） ──

/** 允许的块类型（契约 §1）。`foot` = 页脚/页码行（试卷「第 1 页 共 4 页」）。
 *  ⚠️ 加类型必须**同时**确认前端渲染兜底：未知 type 在前端按非 body 分支渲染
 *  （走 renderMixedText），不会白屏；但若哪天前端改成 switch 穷举，这里加类型会静默吞块。 */
export const BLOCK_TYPES = ["title", "heading", "body", "question", "option", "note", "table", "foot"]
export const BLOCK_ALIGNS = ["left", "center", "right"]

/** 越界 type 一律回退 `body`（契约 §1 约定 1） */
export function normType(v: unknown): string {
  const t = String(v ?? "").trim()
  return BLOCK_TYPES.includes(t) ? t : "body"
}

/** 越界 align 一律回退 `left`（契约 §1 约定 1） */
export function normAlign(v: unknown): string {
  const a = String(v ?? "").trim()
  return BLOCK_ALIGNS.includes(a) ? a : "left"
}

/** indent 夹取 0~3 —— 越界不是错误，是归一化（契约 §1 约定 3） */
export function clampIndent(v: unknown): number {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return n > 3 ? 3 : n
}

/** 块全文 = lines 逐行拼接（提示词刻意省略冗余 text 字段，此处推导） */
export function joinLines(lines: BlockLine[]): string {
  return lines.map((l) => l.text).join("\n")
}

/** 结构型收尾 —— 三学科一致，无学科差异。
 *
 *  只做"块序列的结构修正"，不碰任何学科规则：
 *    · markOrderedIndent：题号行抬到 indent=1（契约 §6.7：对数学也生效，无害）
 *    · mergeMarkdownTableBlocks：模型把 markdown 表格逐行当正文输出 → 合并回 table 块
 *      （内部还会 hoistHtmlTableBlocks 把正文里内嵌的 `<table>` 提升为独立 table 块）
 *
 *  ⚠️ 这段逻辑**必须**保持单一实现：一旦按学科复制三份，就会出现文档 §5 记录过的
 *  "两份规则漂移 → 同一页走不同分支结果不同"。这里的判据是"三学科必须一样"，
 *  正是内核该放的东西。
 */
export function finishBlocks(blocks: Block[]): Block[] {
  markOrderedIndent(blocks)
  return mergeMarkdownTableBlocks(blocks)
}

// ── 页码丢弃 / 块整理（三学科一致，无学科差异） ──

/** 丢页码块 + 丢清洗后变空的块 + 把正文里内嵌的 `<table>` 提升为独立 table 块。
 *
 *  ⚠️ 顺序约定：**去印刷拼音要在调用本函数之前做**（在学科模块里）。
 *  因为纯拼音块被去掉拼音后会变空，必须在"丢空块"之前完成，否则会留下空块。
 *  table 块原样透传（页码判定与去拼音对 HTML 标签名都无意义）。 */
export function tidyBlocks(blocks: Block[]): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    if (b.type === "table") {
      out.push(b)
      continue
    }
    const blockText = b.lines?.length ? joinLines(b.lines) : String(b.text ?? "")
    if (isPageNumberText(blockText)) continue // 整块是页码 → 丢弃
    if (!blockText.trim()) continue // 清洗后变空（如纯拼音块）→ 丢弃
    out.push(b)
  }
  // 正文块里若内嵌 HTML 表格 → 提升为 table 块，前端才会用可点读表格渲染
  return hoistHtmlTableBlocks(out)
}

/** 丢页码行，保留原空白行（段落分隔）。 */
export function dropPageNumberLines(text: string): string {
  const out: string[] = []
  for (const ln of (text || "").split("\n")) {
    if (isPageNumberText(ln)) continue
    out.push(ln)
  }
  return out.join("\n")
}

// ── parse-image 请求机制（三学科共用） ──

export interface ImageRequest {
  data: Uint8Array
  /** 原始文件名（用于推扩展名，决定落盘后缀） */
  fileName: string
  noCache: boolean
  /** 前端显式 engine 参数（已 trim + lowercase，可能为空串） */
  reqEngine: string
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

export type ImageRequestResult =
  | { ok: true; req: ImageRequest }
  | { ok: false; status: 400 | 422; detail: string }

/** 读表单里的图片（含 no_cache / engine 查询参数解析）。
 *  失败原因分两种，与改造前的响应码一致：无文件 → 400，图片为空 → 422。 */
export async function readImageRequest(c: Context): Promise<ImageRequestResult> {
  const form = await c.req.formData().catch(() => null)
  if (!form) return { ok: false, status: 400, detail: "缺少文件" }
  const file = form.get("file")
  if (!file || typeof file === "string") return { ok: false, status: 400, detail: "缺少文件" }
  const data = new Uint8Array(await (file as File).arrayBuffer())
  if (!data.length) return { ok: false, status: 422, detail: "图片为空" }
  return {
    ok: true,
    req: {
      data,
      fileName: typeof file.name === "string" ? file.name : "",
      noCache: c.req.query("no_cache") === "true",
      reqEngine: (c.req.query("engine") || "").trim().toLowerCase(),
    },
  }
}

/** 图片落盘 + EXIF 方向校正。校正失败则退回原路径（不阻塞主链路）。 */
export async function persistAndOrient(
  data: Uint8Array,
  imageDir: string,
  ext: string,
): Promise<{ path: string; oriented: string }> {
  const fname = `${crypto.randomUUID().replace(/-/g, "")}${ext}`
  const path = `${imageDir}/${fname}`
  await writeBlob(path, data, "image/jpeg")
  let oriented = path
  try {
    oriented = await autoOrient(path)
  } catch {
    /* 跳过：原图可用 */
  }
  return { path, oriented }
}

/** 从文件名推扩展名（拿不到就 .jpg） */
export function extOf(name: unknown): string {
  const m = typeof name === "string" ? name.match(/\.([a-zA-Z0-9]+)$/) : null
  return m ? "." + m[1] : ".jpg"
}

export async function readCacheJson(key: string): Promise<Record<string, unknown> | null> {
  try {
    const cached = await readCache(key)
    return cached && typeof cached === "object" ? (cached as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function writeCacheJson(key: string, payload: unknown): Promise<void> {
  await writeCache(key, payload)
}

// ── 学科链路的统一返回形状（= 前后端通信格式，故三学科一致；见契约 §1） ──

/** 一个学科跑完识别后的结果。字段与 parse-image 响应体一一对应，
 *  三个学科都返回这个形状，路由无需按学科分支拼响应。 */
export interface SubjectOcrOutcome {
  text: string
  blocks: Block[]
  questions: string[]
  pageBounds: unknown
  crops: unknown[]
  /** 非空 → 识别失败，路由据此回 422（内容为诊断串） */
  error?: string
  /** 需由路由挂到 `executionCtx.waitUntil` 的后台任务（如异步补多音字） */
  background?: Promise<unknown>[]
  /** 需下发给前端的 poly_token（前端凭它轮询补丁接口回填注音）。仅语文会用到。 */
  polyToken?: string
}
