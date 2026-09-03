/** Wordbank 路由 — /api/v1/wordbank/stats|query|search|add-word（读+写 data/wordbank.json） */
import { Hono } from "hono"
import { readJson, writeJson, dataPath } from "../lib/jsonfile.js"

import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
const WB_PATH = dataPath("wordbank.json")

interface WordBankItem {
  text: string
  tags: string[]
  type: string
  pinyin: string
  ipa: string
  ipa_uk: string
  letter: string
  phonemes: string[]
  phonemes_uk: string[]
  emoji: string
  difficulty: number
  translation: string
}

interface WordBankData {
  version: string
  chars: WordBankItem[]
  words: WordBankItem[]
}

let cache: WordBankData | null = null
const getData = (): WordBankData => {
  if (!cache) {
    const raw = readJson<Record<string, unknown>>(WB_PATH, {}) as Record<string, unknown>
    cache = {
      version: String(raw?.version ?? ""),
      chars: Array.isArray(raw?.chars) ? (raw.chars as WordBankItem[]) : [],
      words: Array.isArray(raw?.words) ? (raw.words as WordBankItem[]) : [],
    }
  }
  return cache
}

// GET /api/v1/wordbank/stats
router.get("/stats", (c) => {
  const data = getData()
  const all = [...data.chars, ...data.words]
  const tagCount = new Map<string, number>()
  for (const it of all) for (const tag of it.tags ?? []) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
  const stats = [...tagCount.entries()].map(([tag, count]) => ({ tag, count }))
  stats.sort((a, b) => a.tag.localeCompare(b.tag)) // 对齐 PY：按 tag 排序
  return c.json({
    total_chars: data.chars.length,
    total_words: data.words.length,
    stats,
  })
})

// GET /api/v1/wordbank/query
router.get("/query", (c) => {
  const grade = c.req.query("grade") ?? ""
  const semester = c.req.query("semester") ?? ""
  const type = c.req.query("type") ?? ""
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 1000)
  const data = getData()
  const items = [...data.chars, ...data.words].filter((e) => {
    // 对齐 PY：grade+semester 拼成完整 tag 精确匹配（两者都传才过滤）
    if (grade && semester) {
      const tag = grade + semester
      if (!(e.tags ?? []).includes(tag)) return false
    }
    if (type && e.type !== type) return false
    return true
  })
  // 对齐 PY：按 tags 长度降序（更多 tag 优先）
  items.sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0))
  return c.json({ total: items.length, items: items.slice(0, limit) })
})

// GET /api/v1/wordbank/search
router.get("/search", (c) => {
  const q = c.req.query("q") ?? ""
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 500)
  if (!q) return c.json({ total: 0, items: [] })
  const data = getData()
  const items = [...data.chars, ...data.words].filter((i) => i.text.includes(q))
  // 对齐 PY：tags 长度降序，text 升序二级
  items.sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0) || a.text.localeCompare(b.text))
  return c.json({ total: items.length, items: items.slice(0, limit) })
})

// POST /api/v1/wordbank/add-word
router.post("/add-word", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.text) return c.json({ detail: "缺少 text" }, 400)
  const text = String(body.text)
  const type = String(body?.type ?? "chars")
  const tags = Array.isArray(body?.tags) ? body.tags.map(String) : []
  const pinyin = String(body?.pinyin ?? "")
  const data = getData()
  const list = type === "words" ? data.words : data.chars
  // 对齐 PY：破坏式替换——命中则整体替换（旧字段全丢），未命中则追加
  const item: WordBankItem = {
    text,
    tags,
    type,
    pinyin,
    ipa: "",
    ipa_uk: "",
    letter: "",
    phonemes: [],
    phonemes_uk: [],
    emoji: "",
    difficulty: 1,
    translation: "",
  }
  const idx = list.findIndex((i) => i.text === text)
  const status = idx >= 0 ? "updated" : "added"
  if (idx >= 0) list[idx] = item
  else list.push(item)
  writeJson(WB_PATH, data)
  cache = data
  return c.json({ status })
})

export default router
