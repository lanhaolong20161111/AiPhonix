/** 学科无关内核 —— 只含「机制」，不含任何学科策略。
 *
 *  §7 学科隔离（2026-09-15，与 server_cf 同步）：parse-image 链路被切成三份自洽的垂直链路：
 *
 *      lib/subject/chinese.ts   语文
 *      lib/subject/english.ts   英语
 *      lib/subject/math.ts      数学
 *
 *  每个学科模块**自带**提示词选择、行文本清洗器、缩进规则、诗歌标记、分题函数、缓存键，
 *  没有任何 `profile` / `lineCleaner` / `isEnglish` 开关
 *  （元规则 3：学科差异只能内联在学科自己的文件里，不能表达成"调用方要记得传对"的参数）。
 *
 *  本文件只放三学科**逐字相同、且不属于任何学科决策**的东西：
 *    · Block 的格式归一化（type/align 枚举回退、indent 夹取、由 lines 推导 text）
 *    · 结构型归位（有序行缩进）
 *    · parse-image 的请求/缓存机制（读表单、sha256、缓存读写、图片落盘、EXIF 校正）
 *
 *  ⚠️ 判据：**"如果要在三个学科之间选一个值，就不该出现在这里。"**
 *  能出现在这里的只有"三学科必须完全一样、否则就是 bug"的东西。
 *
 *  ⚠️ 与 server_cf 的**有意差异**（勿盲目对齐）：server_ts 暂无 PaddleOCR 引擎、没有
 *  `MATH_OCR_JSON_PROMPT` / `DOUBAO_OCR_JSON_PROMPT` 那套结构化提示词，也还没有
 *  「去页码 / 提升内嵌 HTML 表格」两步后处理。因此 server_cf kernel.ts 里的
 *  `dropPageNumberLines` / `tidyBlocks` / `hoistHtmlTableBlocks` 本文件**暂不提供** ——
 *  §7 是结构重构，不做"为了对齐而引入行为变化"的事。等 server_ts 补上对应能力再加。
 */
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import type { Context } from "hono"
import type { Block, BlockLine } from "../aiTextUtils.js"
import { markOrderedIndent } from "../aiTextUtils.js"
import { autoOrient } from "../image.js"

// ── Block 格式归一化（契约 §1 硬性约定） ──

/** 允许的块类型（契约 §1）。`foot` = 页脚/页码行（试卷「第 1 页 共 4 页」）。
 *  ⚠️ 与 server_cf 的同名常量必须逐字一致（见 skill aiphonix-backend-parity）。
 *  注：本端（server_ts）数学链只出纯文本、blocks 恒空，故 foot 目前是**契约占位**；
 *  真要用需先补 MATH_OCR_JSON_PROMPT + extractBlocks({keepLineSpaces}) + finalizeMathBlocks
 *  （见本目录 math.ts 文件头）。 */
export const BLOCK_TYPES = ["title", "heading", "body", "question", "option", "note", "table", "foot"]
export const BLOCK_ALIGNS = ["left", "center", "right"]

/** 未归一化的原始 block（来自 ark JSON / 缓存，字段可能缺失）。
 *  finalize*Blocks 接受这个形状，归一化成 Block[]。 */
export interface RawBlock {
  type?: string
  text?: string
  align?: string
  lines?: unknown[]
  polyphones?: Record<string, unknown>
}
export interface RawLine {
  text?: string
  indent?: unknown
}

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

/** 块全文 = lines 逐行拼接 */
export function joinLines(lines: BlockLine[]): string {
  return lines.map((l) => l.text).join("\n")
}

/** 结构型收尾 —— 三学科一致，无学科差异。
 *
 *  只做"块序列的结构修正"，不碰任何学科规则：题号行抬到 indent=1（对数学也生效，无害）。
 *
 *  ⚠️ 这段逻辑**必须**保持单一实现：一旦按学科复制三份，就会出现文档 §5 记录过的
 *  "两份规则漂移 → 同一页走不同分支结果不同"。判据是"三学科必须一样"，正是内核该放的东西。 */
export function finishBlocks(blocks: Block[]): Block[] {
  markOrderedIndent(blocks)
  return blocks
}

// ── parse-image 请求机制（三学科共用） ──

export interface ImageRequest {
  data: Uint8Array
  /** 原始文件名（用于推扩展名，决定落盘后缀） */
  fileName: string
  noCache: boolean
  /** 前端显式 engine 参数（已 trim + lowercase，可能为空串）。
   *  server_ts 目前没有 Paddle 引擎，该值只用于日志与调用形状对齐。 */
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

/** 从文件名推扩展名（拿不到就 .jpg） */
export function extOf(name: unknown): string {
  const m = typeof name === "string" ? name.match(/\.([a-zA-Z0-9]+)$/) : null
  return m ? "." + m[1] : ".jpg"
}

/** 图片落盘 + EXIF 方向校正。校正失败则退回原路径（不阻塞主链路）。 */
export async function persistAndOrient(
  data: Uint8Array,
  imageDir: string,
  ext: string,
): Promise<{ path: string; oriented: string }> {
  const fname = `${randomUUID().replace(/-/g, "")}${ext}`
  const path = `${imageDir}/${fname}`.replace(/\\/g, "/")
  await mkdir(imageDir, { recursive: true })
  await writeFile(path, data)
  let oriented = path
  try {
    // sharp 在 Windows 上可能回反斜杠路径，统一成正斜杠（Node 接受正斜杠，下游也按 "/" 取 basename）
    oriented = (await autoOrient(path)).replace(/\\/g, "/")
  } catch {
    /* 跳过：原图可用 */
  }
  return { path, oriented }
}

export async function readCacheJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    if (!existsSync(file)) return null
    const parsed = JSON.parse(await readFile(file, "utf-8"))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null // 缓存损坏 → 当作未命中，继续走识别
  }
}

export async function writeCacheJson(file: string, payload: unknown): Promise<void> {
  await mkdir(file.replace(/[\\/][^\\/]+$/, ""), { recursive: true })
  await writeFile(file, JSON.stringify(payload), "utf-8")
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
}
