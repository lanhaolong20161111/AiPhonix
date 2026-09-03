/** WordSuggestions 路由 — /api/v1/llm/word-suggestions（对齐 Python routes/word_suggestions.py）
 *
 * - 缓存文件 data/word_suggestions.json 格式 = [{char, words}]（与 Python 共享，读写兼容）
 * - 先查缓存 → 命中直接返回；否则取静态 fallback 词，词不足 3 个才调 LLM
 * - LLM 调用走 chat()，BudgetExceededError 不捕获 → 全局 429
 * - 无需登录（与 Python 一致）
 */
import { Hono } from "hono"
import { readJson, writeJson, dataPath } from "../lib/jsonfile.js"
import { chat } from "../lib/deepseek.js"

const router = new Hono()
const CACHE_PATH = dataPath("word_suggestions.json")

interface WordEntry {
  char: string
  words: string[]
}

let cache: Map<string, string[]> = new Map()
let fallbackWords: WordEntry[] = []

function loadFile(): void {
  const data = readJson<unknown>(CACHE_PATH, [])
  const entries: WordEntry[] = []
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== "object") continue
      const obj = item as Record<string, unknown>
      const char = String(obj.char ?? "").trim()
      if (!char) continue
      const words = Array.isArray(obj.words) ? obj.words.map(String).filter((w) => w) : []
      entries.push({ char, words })
    }
  }
  cache = new Map(entries.map((e) => [e.char, e.words]))
  fallbackWords = entries
}

loadFile()

function saveCache(): void {
  const data: WordEntry[] = []
  for (const [char, words] of cache.entries()) {
    data.push({ char, words })
  }
  writeJson(CACHE_PATH, data)
}

function getFallbackWords(char: string): string[] {
  for (const item of fallbackWords) {
    if (item.char === char) {
      return item.words.slice(0, 5)
    }
  }
  return [char]
}

function extractWords(raw: string): string[] {
  // 剥离 markdown 围栏后尝试解析 JSON 数组
  let candidate = (raw || "").trim()
  if (candidate.startsWith("```")) {
    candidate = candidate.replace(/^```(?:json)?\s*/i, "")
    candidate = candidate.replace(/\s*```\s*$/, "")
  }
  const m = candidate.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const v = JSON.parse(m[0])
      if (Array.isArray(v) && v.length > 0) return v.map(String).filter((w) => w.trim()).slice(0, 6)
    } catch {
      /* ignore */
    }
  }
  return []
}

// POST /api/v1/llm/word-suggestions
router.post("/word-suggestions", async (c) => {
  const body = await c.req.json().catch(() => null)
  const char = String(body?.char ?? "").trim()
  if (!char) return c.json({ detail: "缺少 char" }, 400)

  // 1) 查缓存
  const cached = cache.get(char)
  if (cached && cached.length) {
    return c.json({ char, words: cached, source: "cache" })
  }

  // 2) 优先从静态数据取组词
  let words = getFallbackWords(char)

  // 3) 词不够才调 LLM（BudgetExceededError 不捕获 → 全局 429）
  if (words.length < 3) {
    const prompt =
      `为小学一年级学生生成汉字"${char}"的常用词语，要求：\n` +
      "- 只输出3-5个最常见、最简单的词语\n" +
      "- 每个词不超过4个字\n" +
      "- 直接输出JSON数组，不要其他文字\n" +
      `["词1","词2","词3"]`
    try {
      const reply = await chat("你是一个只输出JSON的小学语文助手。", prompt, 500, "word_suggestions")
      const llmWords = extractWords(reply)
      if (llmWords.length > 0) {
        words = llmWords
      }
    } catch (e) {
      // BudgetExceededError 必须向上抛出（全局 429）
      if ((e as { budget?: boolean }).budget) throw e
      console.warn(`[word_suggestions] LLM 失败: ${(e as Error).message}`)
    }
  }

  // 4) 截断到 5 个
  if (words.length > 5) words = words.slice(0, 5)

  // 5) 写缓存
  cache.set(char, words)
  saveCache()

  return c.json({ char, words, source: "llm" })
})

export default router
