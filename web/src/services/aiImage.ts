/** AI 图片识别 API 客户端 — 对应 server_py/routes/ai_homework.py + ai_chinese.py 的 parse-image
 *
 * 服务端识图链路（已实现，前端仅透传）：
 * Ark 豆包多模态（doubao-seed-evolving）识图 → EasyOCR 回退 → 题目拆分
 */

import { api } from "./api"
import { prepareImageFile } from "../lib/imageCompress"
import { fingerprintBlob, getCachedParse, putCachedParse } from "../lib/ocrResultCache"
import { getOcrEngine } from "../stores/ocrEngineStore"

export interface ParseImageResult {
  text: string
  questions: string[]
  blocks?: TextBlock[]
  page_bounds?: { left: number; top: number; right: number; bottom: number } | null
  /** 页面按题目/区域裁剪的小图（Vision 检测 bbox），前端附图对照 */
  crops?: CropItem[]
  /** 服务端异步补多音字：true=注音尚未就绪（正文已可用），前端凭 poly_token 轮询回填 */
  poly_pending?: boolean
  poly_token?: string
  /** 本地缓存指纹（前端算，非服务端字段）：供多音字补丁回写本地缓存 */
  fingerprint?: string
  /** mergeParseResults 产出的分段信息：每个子结果对应的 token/指纹/blocks 区间 */
  poly_parts?: PolyPart[]
}

/** 合并结果的注音分段（切块/多框选时，每块独立异步补注音） */
export interface PolyPart {
  token: string
  fingerprint: string
  /** 该子结果 blocks 在合并数组中的区间 [start, end) */
  start: number
  end: number
}

export interface CropItem {
  id: number
  title: string
  image: string
  bbox: number[]
}

export interface TextBlockLine {
  text: string
  indent: number
}

export interface TextBlock {
  type: string // title / heading / body / question / option / note / image
  text: string
  align: string // left / center / right
  lines: TextBlockLine[]
  polyphones: Record<string, string>
  /** PP-StructureV3 坐标渲染：相对原图 0~1000 [left, top, right, bottom] */
  bbox?: number[] | null
  /** PP 阅读顺序（小→大；图片块为 null） */
  order?: number | null
}

/** parseImage 的分阶段进度（2026-09-02）：替代笼统的"处理中"，降低用户等待焦虑。
 * recognizing 为时间推进入口（上传发出 ~4s 后服务端必在识别，fetch 无上传进度可用）。 */
export type ParseStage = "preparing" | "uploading" | "recognizing"

/**
 * 上传图片识别题目/课文。
 * @param file 图片文件
 * @param module "math"（ai-homework）、"chinese"（ai-chinese）或 "english"
 *   （english 复用 ai-chinese 接口但带 mode=english：服务端跳过多音字/中文去噪）
 * @param noCache true=跳过服务端缓存强制重新识别（识别成功会覆盖缓存）
 * @param onStage 可选：识别各阶段回调（处理图片 → 上传 → AI 识别中），供页面展示进度文案
 */
export async function parseImage(
  file: File | Blob,
  module: "math" | "chinese" | "english",
  noCache = false,
  onStage?: (stage: ParseStage) => void,
): Promise<ParseImageResult> {
  const base = module === "math" ? "/ai-homework/parse-image" : "/ai-chinese/parse-image"
  const form = new FormData()
  // 上传前单次图像处理（2026-09-02）：EXIF 转正 + 缩放到 1600px + JPEG 编码一次完成
  // （原 compressImageFile 只缩放不转正，依赖调用方先 orientImageFile，双重解码编码）。
  // 快路径：JPEG+方向正常+≤800KB 原样返回；小切块（OcrPickSheet/ImageSliceSheet 裁剪产物）直接命中。
  onStage?.("preparing")
  const prepared = await prepareImageFile(file, 1600, 0.85)
  const name = file instanceof File && file.name ? file.name : "image.jpg"
  form.append("file", prepared, name)
  const params = new URLSearchParams()
  if (module === "english") params.set("mode", "english")
  if (noCache) params.set("no_cache", "true")
  // 识别前用户显式选择的模型（auto/doubao/paddle）；auto 不传，走服务端默认
  const engine = getOcrEngine()
  if (engine && engine !== "auto") params.set("engine", engine)
  const qs = params.toString()
  let url = qs ? `${base}?${qs}` : base
  // 异步补多音字：仅语文（数学走 /ai-homework 独立端点且不用 blocks/注音；英语无注音需求）。
  // 服务端先返回正文，注音后台补齐后前端轮询回填。
  if (module === "chinese") {
    url += qs ? "&poly_async=1" : "?poly_async=1"
  }
  // 本地结果缓存（2026-09-02）：同图重复识别秒出，跳过整条服务端链路
  const fp = await fingerprintBlob(prepared)
  if (!noCache) {
    const hit = getCachedParse(module, fp, engine)
    if (hit) {
      onStage?.("recognizing")
      return { ...hit, fingerprint: fp }
    }
  }
  onStage?.("uploading")
  // 上传发出 ~4s 后仍在等待 → 大概率是服务端 OCR/视觉模型在跑（上传 300KB 级 JPEG 通常 <2s）
  const stageTimer =
    onStage && typeof window !== "undefined" ? window.setTimeout(() => onStage("recognizing"), 4000) : undefined
  try {
    const res = await api<ParseImageResult>(url, {
      method: "POST",
      body: form,
      timeoutMs: 120000,
    })
    res.fingerprint = fp
    putCachedParse(module, fp, res, engine)
    return res
  } catch (e) {
    // 超时/取消：返回更友好的提示，避免暴露底层 AbortError / "signal is aborted without reason"
    if (isTimeoutError(e)) {
      throw new Error("图片识别超时，请稍候重试，或换一张更清晰、小一点的图片")
    }
    throw e
  } finally {
    if (stageTimer) clearTimeout(stageTimer)
  }
}

/**
 * 合并多个切块识别结果为一个整页结果（切块识别专用）。
 * - text：各块 text 用换行连接（过滤空块）
 * - questions：各块 questions 顺序合并
 * - blocks：各块 blocks 顺序合并
 * - page_bounds / crops：取第一块的（整页坐标在切块下无意义）
 */
export function mergeParseResults(results: ParseImageResult[]): ParseImageResult {
  const texts: string[] = []
  const questions: string[] = []
  const blocks: TextBlock[] = []
  const polyParts: PolyPart[] = []
  let crops: CropItem[] = []
  let pageBounds: ParseImageResult["page_bounds"] = null
  for (const r of results) {
    const t = (r.text ?? "").trim()
    if (t) texts.push(t)
    if (Array.isArray(r.questions)) questions.push(...r.questions)
    // 记录每个子结果的 blocks 区间：异步注音补丁只能回填到属于自己的那一段
    if (Array.isArray(r.blocks)) {
      const start = blocks.length
      blocks.push(...r.blocks)
      if (r.poly_token) {
        polyParts.push({ token: r.poly_token, fingerprint: r.fingerprint ?? "", start, end: blocks.length })
      }
    }
    if (Array.isArray(r.crops) && crops.length === 0) crops = r.crops
    if (!pageBounds && r.page_bounds) pageBounds = r.page_bounds
  }
  return {
    text: texts.join("\n"),
    questions,
    blocks,
    crops,
    page_bounds: pageBounds,
    poly_parts: polyParts.length ? polyParts : undefined,
    poly_pending: polyParts.length ? true : undefined,
  }
}

/** 判断是否为超时/取消类错误（api.ts 已统一转成带「超时」的友好 Error，旧浏览器可能直接抛 AbortError） */
function isTimeoutError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true
  if (e instanceof Error && (e.name === "AbortError" || /abort|超时|signal is aborted/i.test(e.message))) return true
  return false
}
