/** ai_chinese 各拆分模块共享的目录常量与小工具
 * （2026-08-27 自主路由原样提升；逻辑未改动。子模块与主路由统一从这里取。） */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { DATA_DIR, getConfig } from "../env.js"
import { sqlite } from "../db/index.js"
import { readCache, writeCache, parseJsonObj } from "./aiShared.js"
import { chat as deepseekChat } from "./deepseek.js"

export const CACHE_DIR = join(DATA_DIR, "ai_chinese_cache")

export const IMAGE_DIR = join(DATA_DIR, "ai_chinese_images")

export const MAX_QUESTION_LEN = 18000

export const MULTIMODAL_MODEL = "doubao-seed-2-1-turbo-260628"

/** 当前生效的多模态识图模型：优先环境变量 ARK_VISION_MODEL / cfg.ark_chat.vision_model，未设则用默认。
 * 对齐 server_cf：统一 doubao-seed-2-1-turbo-260628（旧视觉模型已弃用）。 */
export function multimodalModel(): string {
  try {
    const m = getConfig().ark_chat.vision_model
    if (m && m.trim()) return m.trim()
  } catch {
    /* env 未初始化（单测等场景）时回退默认 */
  }
  return MULTIMODAL_MODEL
}

export const PROBLEM_IMAGE_DIR = join(DATA_DIR, "ai_chinese_problems")

export const SENTENCE_AUDIO_DIR = join(DATA_DIR, "ai_chinese_sentence_audio")

export const UPLOAD_DATA_DIR = join(DATA_DIR, "uploads")

export async function autoCropWhite(imagePath: string): Promise<string> {
  // sharp 简化版：检测四周白边并裁剪（失败返回原路径）
  try {
    const key = createHash("md5").update(imagePath).digest("hex").slice(0, 16)
    const out = join(IMAGE_DIR, `crop_${key}.jpg`)
    if (existsSync(out)) return out
    const img = sharp(imagePath)
    const meta = await img.metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    if (w < 100 || h < 100) return imagePath
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    const isWhite = (x: number, y: number): boolean => {
      const i = (y * w + x) * ch
      return data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200
    }
    const rowWhite = (y: number): boolean => {
      let cnt = 0
      let n = 0
      for (let x = 0; x < w; x += 3) { n++; if (isWhite(x, y)) cnt++ }
      return n > 0 && cnt / n >= 0.85
    }
    let top = 0
    while (top < h - 2 && rowWhite(top)) top++
    let bottom = h - 1
    while (bottom > top + 2 && rowWhite(bottom)) bottom--
    const colWhite = (x: number): boolean => {
      let cnt = 0
      let n = 0
      for (let y = top; y <= bottom; y += 3) { n++; if (isWhite(x, y)) cnt++ }
      return n > 0 && cnt / n >= 0.85
    }
    let left = 0
    while (left < w - 2 && colWhite(left)) left++
    let right = w - 1
    while (right > left + 2 && colWhite(right)) right--
    const cw = right + 1 - left
    const chh = bottom + 1 - top
    if (cw < w * 0.4 || chh < h * 0.4 || (cw >= w * 0.98 && chh >= h * 0.98)) return imagePath
    await sharp(imagePath).extract({ left, top, width: cw, height: chh }).jpeg({ quality: 85 }).toFile(out)
    return out
  } catch (e) {
    console.warn("[ai-chinese] 白边裁剪失败:", (e as Error).message)
    return imagePath
  }
}

export async function chatJson(
  system: string, prompt: string, maxTokens: number, caller: string,
  validate: (d: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await deepseekChat(system, prompt, maxTokens, caller, true)
    const data = parseJsonObj(reply)
    if (data && validate(data)) return data
    console.warn(`[ai-chinese] ${caller} 校验不过（attempt=${attempt}）`)
  }
  return {}
}

export function loadJsonArr(s: string | null | undefined): unknown[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export const nowIso = () => new Date().toISOString()

export function resolveImagePath(path: string): string {
  if (!path) return path
  const p = (path || "").replace(/\\/g, "/")
  const candidates = [p]
  if (!p.startsWith("/") && !/^[A-Za-z]:/.test(p)) {
    candidates.push(join(process.cwd(), p))
    candidates.push(join(process.cwd(), "data", p))
    candidates.push(join(DATA_DIR, p))
    candidates.push(join(process.env.USERPROFILE || "", "Desktop", p))
  }
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return path
}

export function strList(v: unknown, max = 10): string[] {
  if (!Array.isArray(v)) return []
  return v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max)
}

export function searchTitle(stype: string, sid: number): string {
  try {
    if (stype === "wiki") {
      const t = sqlite.prepare("SELECT title FROM wiki_pages WHERE id=?").get(sid) as { title?: string } | undefined
      return (t?.title || "") || "词条"
    }
    if (stype === "textbook") {
      const t = sqlite.prepare("SELECT page, lesson, page_type FROM chinese_textbook_pages WHERE id=?").get(sid) as { page?: string; lesson?: string; page_type?: string } | undefined
      if (t) return `课本${t.page || "?"}页 ${t.lesson || t.page_type || ""}`
      return "课本页"
    }
    if (stype === "homework") {
      const t = sqlite.prepare("SELECT unit, lesson, category FROM chinese_unit_knowledge WHERE id=?").get(sid) as { unit?: string; lesson?: string; category?: string } | undefined
      if (t) return `${t.unit || ""} ${t.lesson || ""} ${t.category || ""}`.trim()
      return "练习页"
    }
    if (stype === "question") {
      const t = sqlite.prepare("SELECT question, category FROM chinese_question_items WHERE id=?").get(sid) as { question?: string; category?: string } | undefined
      return ((t?.question || "").slice(0, 40) || t?.category || "题") || "题目"
    }
    if (stype === "reading") {
      const t = sqlite.prepare("SELECT question, question_type FROM chinese_reading_items WHERE id=?").get(sid) as { question?: string; question_type?: string } | undefined
      return ((t?.question || "").slice(0, 40) || t?.question_type || "阅读题") || "阅读题"
    }
    if (stype === "essay") {
      const t = sqlite.prepare("SELECT title FROM chinese_essay_knowledge WHERE id=?").get(sid) as { title?: string } | undefined
      return (t?.title || "") || "作文"
    }
  } catch {
    /* ignore */
  }
  return ""
}
