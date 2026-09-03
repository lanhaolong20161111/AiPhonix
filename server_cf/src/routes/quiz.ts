/** Quiz 路由 — /api/v1/llm/quiz|quiz-generate（读写 data/quiz_cache_{video}.json + DeepSeek）
 *  Cloud 版：fs 同步读写 → R2 async（exists/readText/writeText）。
 */
import { Hono } from "hono"
import { exists, readText, writeText } from "../lib/storage.js"
import { dataPath } from "../lib/jsonfile.js"
import { chat } from "../lib/deepseek.js"
import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
// quiz 缓存是用户级写入：统一要求登录，避免匿名任意写入 R2
router.use(requireAuth())

interface QuizItem {
  english: string
  chinese: string
  difficulty: number
  display: string
  blankAnswer: string
}

const cachePath = (videoName: string) => dataPath(`quiz_cache_${videoName}.json`)

/** 清洗 video_name：仅允许字母/数字/下划线/中文/连字符，长度 1-64。
 *  非法（含 .. / / 等遍历字符）一律回退 "default"，杜绝路径遍历写。 */
function safeVideoName(name: unknown): string {
  const n = String(name ?? "").trim()
  if (!/^[-\w一-龥]{1,64}$/.test(n)) return "default"
  return n
}

// 清洗字幕：去时间戳行（含 -->）、纯数字序号行、空行（对齐 Python _clean_subtitle）
function cleanSubtitle(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.includes("-->") && !/^\d+$/.test(l))
    .join("\n")
}

// 抽取 [ ... ] JSON 数组文本（取第一个 [ 到最后一个 ]）
function extractJsonArrayText(raw: string): string {
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return raw
}

// 容错解析：坏条目丢弃，不整体失败（对齐 Python QuizItem 校验）
function parseItems(raw: string): QuizItem[] {
  let text = extractJsonArrayText(raw)
  try {
    JSON.parse(text)
  } catch {
    return []
  }
  let arr: unknown
  try {
    arr = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: QuizItem[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue
    const o = entry as Record<string, unknown>
    const english = String(o.english ?? "")
    if (!english) continue // 无英文原文视为无效条目
    out.push({
      english,
      chinese: String(o.chinese ?? ""),
      difficulty: Math.min(5, Math.max(1, Math.round(Number(o.difficulty)) || 1)),
      display: String(o.display ?? ""),
      blankAnswer: String(o.blankAnswer ?? ""),
    })
  }
  return out
}

const generateQuiz = async (subtitleText: string, count: number): Promise<string> => {
  let cleaned = cleanSubtitle(subtitleText)
  if (cleaned.length > 4000) cleaned = cleaned.slice(0, 4000)
  const prompt =
    `从字幕中提取 ${count} 条英语填空题，适合中国儿童学习。\n` +
    "要求：日常实用、含中英文、难度1-5、按易到难排列。\n" +
    "只输出JSON数组：\n" +
    '[{"english":"原句","chinese":"中文","difficulty":1-5,"display":"用___填空","blankAnswer":"答案"}]\n\n' +
    `字幕：\n${cleaned}`
  const sys = "你是一个儿童英语教学专家，负责从动画字幕中提取适合中国儿童学习的英语材料。"
  let reply = await chat(sys, prompt, 4096, "quiz")
  // 单次 JSON 校验 + 失败重试一次（对齐 Python）
  try {
    JSON.parse(extractJsonArrayText(reply))
  } catch {
    reply = await chat(sys, prompt + "\n务必只输出JSON数组，不要其他文字。", 4096, "quiz_retry")
  }
  return reply
}

// POST /api/v1/llm/quiz（有缓存用缓存）
router.post("/quiz", async (c) => {
  const body = await c.req.json().catch(() => null)
  const subtitleText = String(body?.subtitle_text ?? "")
  const videoName = safeVideoName(body?.video_name)
  const count = Number(body?.count) > 0 ? Number(body?.count) : 30
  if (!subtitleText) return c.json({ detail: "缺少 subtitle_text" }, 400)

  const file = cachePath(videoName)
  if (await exists(file)) {
    try {
      const content = await readText(file)
      if (content != null && content !== "") {
        const cached = JSON.parse(content)
        if (Array.isArray(cached) && cached.length) return c.json({ source: "cache", items: cached })
      }
    } catch {
      /* 缓存损坏，忽略 */
    }
  }
  const items = parseItems(await generateQuiz(subtitleText, count))
  await writeText(file, JSON.stringify(items, null, 2))
  return c.json({ source: "llm", items })
})

// POST /api/v1/llm/quiz-generate（强制生成，忽略缓存）
router.post("/quiz-generate", async (c) => {
  const body = await c.req.json().catch(() => null)
  const subtitleText = String(body?.subtitle_text ?? "")
  const count = Number(body?.count) > 0 ? Number(body?.count) : 30
  if (!subtitleText) return c.json({ detail: "缺少 subtitle_text" }, 400)
  const items = parseItems(await generateQuiz(subtitleText, count))
  return c.json({ source: "llm", items })
})

export default router
