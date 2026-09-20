/** ai_chinese 各拆分模块共享的目录常量与小工具 — Cloudflare 版（R2）
 *
 * 与 server_ts/src/lib/aiChineseContext.ts 的差异：
 * - 目录常量是 R2 key 前缀（"data/..."），不再是本地路径
 * - **autoCropWhite 已降级为原样返回**：它原来是「@jsquash WASM 解码 + 像素扫描白边」，
 *   而 Worker 侧不能用 wasm（CPU 限制，详见 lib/image.ts 文件头），故直接返回原 key
 * - resolveImagePath 变纯字符串归一化（无 fs），后续存在性检查由调用方 await exists()
 * - searchTitle 变 async（D1）
 */
import { sqlFirst, sqlAll } from "../db/index.js"
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
  // Cloudflare 版：不做白边裁剪（像素解码依赖 wasm，Worker 侧禁用；见 lib/image.ts 文件头）。
  // 保留函数与签名，调用方（ai_chinese 报告存档）无需改动，行为 = 原样使用原图。
  return imageKey
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
