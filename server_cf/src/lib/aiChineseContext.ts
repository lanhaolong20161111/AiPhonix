/** ai_chinese 各拆分模块共享的目录常量与小工具 — Cloudflare 版（R2 + WASM）
 *
 * 与 server_ts/src/lib/aiChineseContext.ts 的差异：
 * - 目录常量是 R2 key 前缀（"data/..."），不再是本地路径
 * - autoCropWhite 用 @jsquash WASM 解码 + 像素扫描白边（原 sharp extract 语义逐行保留）
 * - resolveImagePath 变纯字符串归一化（无 fs），后续存在性检查由调用方 await exists()
 * - searchTitle 变 async（D1）
 */
import { createHash } from "node:crypto"
import { sqlFirst, sqlAll } from "../db/index.js"
import { readBlob, writeBlob, exists as keyExists } from "./storage.js"
import { decodeImage, encodeJpeg } from "./image.js"
import { readCache, writeCache, parseJsonObj } from "./aiShared.js"
import { chat as deepseekChat } from "./deepseek.js"
import { MULTIMODAL_MODEL, multimodalModel } from "./ark.js"

export const CACHE_DIR = "data/ai_chinese_cache"

export const IMAGE_DIR = "data/ai_chinese_images"

export const MAX_QUESTION_LEN = 18000

export { MULTIMODAL_MODEL, multimodalModel }

export const PROBLEM_IMAGE_DIR = "data/ai_chinese_problems"

export const SENTENCE_AUDIO_DIR = "data/ai_chinese_sentence_audio"

export const UPLOAD_DATA_DIR = "data/uploads"

export async function autoCropWhite(imageKey: string): Promise<string> {
  // 白边裁剪：检测四周白边并裁剪（失败返回原 key）
  try {
    const key = createHash("md5").update(imageKey).digest("hex").slice(0, 16)
    const out = `${IMAGE_DIR}/crop_${key}.jpg`
    if (await keyExists(out)) return out
    const raw = await readBlob(imageKey)
    if (!raw) return imageKey
    const { image } = await decodeImage(new Uint8Array(raw))
    const w = image.width
    const h = image.height
    if (w < 100 || h < 100) return imageKey
    const data = image.data
    const ch = 4 // ImageData 恒 RGBA
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
    if (cw < w * 0.4 || chh < h * 0.4 || (cw >= w * 0.98 && chh >= h * 0.98)) return imageKey
    // 裁剪（逐行拷贝像素到新 ImageData）
    const cropped = new ImageData(cw, chh)
    for (let y = 0; y < chh; y++) {
      const srcStart = ((y + top) * w + left) * 4
      cropped.data.set(data.subarray(srcStart, srcStart + cw * 4), y * cw * 4)
    }
    const jpg = await encodeJpeg(cropped, 85)
    await writeBlob(out, jpg, "image/jpeg")
    return out
  } catch (e) {
    console.warn("[ai-chinese] 白边裁剪失败:", (e as Error).message)
    return imageKey
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

/** 路径归一化（Cloudflare 版）：把历史存的 Windows 绝对/相对路径归一为 R2 key。
 * 返回值不保证存在——调用方用 `await exists(key)` 检查，可再按 basename 兜底。 */
export function resolveImagePath(path: string): string {
  if (!path) return path
  const p = (path || "").replace(/\\/g, "/")
  // Windows 盘符去掉
  let s = p.replace(/^[A-Za-z]:\//, "")
  // 截取 shared/ 之后的部分（历史记录多为 C:\...\AiPhonix\shared\data\<dir>\<file>）
  const m = s.match(/^(?:.*\/)?shared\/(.*)$/)
  if (m) return m[1]
  if (s.startsWith("data/") || s.startsWith("static/") || s.startsWith("cache/") || s.startsWith("downloads/")) return s
  // 相对路径（如 "uploads/x.jpg" 或 "ai_chinese_images/x.jpg"）：尝试补 data/ 前缀
  if (/^(ai_chinese_images|ai_chinese_problems|ai_chinese_sentence_audio|ai_chinese_cache|ai_homework_images|ai_homework_problems|uploads|subtitle_captures|char_images|char_audio)\//.test(s)) {
    return `data/${s}`
  }
  // 只有文件名：返回原名，调用方按目录兜底
  return s
}

/** 从一个裸路径里提取文件名（兜底查找用） */
export function basenameOf(path: string): string {
  const p = (path || "").replace(/\\/g, "/")
  return p.split("/").pop() || p
}

export function strList(v: unknown, max = 10): string[] {
  if (!Array.isArray(v)) return []
  return v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max)
}

/** 全文搜索（D1 无 FTS5，改用 LIKE 跨表扫描）。
 * 返回 {stype, sid, snip}，stype/sid 与 searchTitle 映射一致，snip 为命中上下文片段。 */
export async function chineseSearch(q: string, limit: number, ptype = ""): Promise<{ stype: string; sid: number; snip: string }[]> {
  const like = `%${q}%`
  const defs = [
    { stype: "wiki", table: "wiki_pages", cols: ["content", "title"] },
    { stype: "textbook", table: "chinese_textbook_pages", cols: ["content", "knowledge_points"] },
    { stype: "homework", table: "chinese_unit_knowledge", cols: ["content", "knowledge_points"] },
    { stype: "question", table: "chinese_question_items", cols: ["question", "answer"] },
    { stype: "reading", table: "chinese_reading_items", cols: ["passage", "question"] },
    { stype: "essay", table: "chinese_essay_knowledge", cols: ["content", "requirement", "guide"] },
  ]
  const parts: string[] = []
  const params: string[] = []
  for (const d of defs) {
    if (ptype && d.stype !== ptype) continue
    for (const col of d.cols) {
      parts.push(`SELECT '${d.stype}' AS stype, id AS sid, ${col} AS content FROM ${d.table} WHERE ${col} LIKE ?`)
      params.push(like)
    }
  }
  const rows = await sqlAll<{ stype: string; sid: number; content: string }>(parts.join(" UNION ALL "), ...params)
  const seen = new Set<string>()
  const out: { stype: string; sid: number; snip: string }[] = []
  for (const r of rows) {
    const key = `${r.stype}:${r.sid}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ stype: r.stype, sid: r.sid, snip: makeSnippet(r.content || "", q) })
    if (out.length >= limit) break
  }
  return out
}

function makeSnippet(content: string, q: string): string {
  const idx = content.indexOf(q)
  if (idx < 0) return content.slice(0, 48)
  const start = Math.max(0, idx - 24)
  const end = Math.min(content.length, idx + q.length + 24)
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "")
}

export async function searchTitle(stype: string, sid: number): Promise<string> {
  try {
    if (stype === "wiki") {
      const t = await sqlFirst<{ title: string }>("SELECT title FROM wiki_pages WHERE id=?", sid)
      return ((t?.title || "") || "词条")
    }
    if (stype === "textbook") {
      const t = await sqlFirst<{ page: string; lesson: string; page_type: string }>("SELECT page, lesson, page_type FROM chinese_textbook_pages WHERE id=?", sid)
      if (t) return `课本${t.page || "?"}页 ${t.lesson || t.page_type || ""}`
      return "课本页"
    }
    if (stype === "homework") {
      const t = await sqlFirst<{ unit: string; lesson: string; category: string }>("SELECT unit, lesson, category FROM chinese_unit_knowledge WHERE id=?", sid)
      if (t) return `${t.unit || ""} ${t.lesson || ""} ${t.category || ""}`.trim()
      return "练习页"
    }
    if (stype === "question") {
      const t = await sqlFirst<{ question: string; category: string }>("SELECT question, category FROM chinese_question_items WHERE id=?", sid)
      return ((t?.question || "").slice(0, 40) || t?.category || "题") || "题目"
    }
    if (stype === "reading") {
      const t = await sqlFirst<{ question: string; question_type: string }>("SELECT question, question_type FROM chinese_reading_items WHERE id=?", sid)
      return ((t?.question || "").slice(0, 40) || t?.question_type || "阅读题") || "阅读题"
    }
    if (stype === "essay") {
      const t = await sqlFirst<{ title: string }>("SELECT title FROM chinese_essay_knowledge WHERE id=?", sid)
      return ((t?.title || "") || "作文")
    }
  } catch {
    /* ignore */
  }
  return ""
}
