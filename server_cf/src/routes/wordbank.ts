/** Wordbank 路由 — /api/v1/wordbank/stats|query|search|add-word（读+写 D1 wordbank_item 表）
 *  Cloud 版：2026-08-28 起 data/wordbank.json → D1（migrations/0002）。
 *  json 列整体保存原条目对象，API 响应与旧行为字节级一致；add-word 走 UPSERT 消写竞态。
 */
import { Hono } from "hono"
import { asc, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { wordbankItem } from "../db/schema.js"

import { requireAuth } from "../middleware/auth.js"

const router = new Hono()

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

const parseRow = (r: { kind: string; json: string }): { kind: string; item: Record<string, unknown> } => {
  let item: Record<string, unknown> = {}
  try {
    item = r.json ? (JSON.parse(r.json) as Record<string, unknown>) : {}
  } catch {
    /* 坏 JSON 容错 */
  }
  return { kind: r.kind, item }
}

// 全量加载（本表 ≤ 数百行，直接查）；kind asc 即 chars 在前、words 在后，对齐旧数组顺序
const loadAll = async (): Promise<{ kind: string; item: Record<string, unknown> }[]> => {
  const rows = await getDb().select().from(wordbankItem).orderBy(asc(wordbankItem.kind)).all()
  return rows.map(parseRow)
}

// GET /api/v1/wordbank/stats
router.get("/stats", async (c) => {
  const all = await loadAll()
  const tagCount = new Map<string, number>()
  for (const { item } of all) {
    const tags = Array.isArray(item.tags) ? (item.tags as string[]) : []
    for (const tag of tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
  }
  const stats = [...tagCount.entries()].map(([tag, count]) => ({ tag, count }))
  stats.sort((a, b) => a.tag.localeCompare(b.tag)) // 对齐旧行为：按 tag 排序
  let totalChars = 0
  let totalWords = 0
  for (const { kind } of all) {
    if (kind === "words") totalWords++
    else totalChars++
  }
  return c.json({ total_chars: totalChars, total_words: totalWords, stats })
})

// GET /api/v1/wordbank/query
router.get("/query", async (c) => {
  const grade = c.req.query("grade") ?? ""
  const semester = c.req.query("semester") ?? ""
  const type = c.req.query("type") ?? ""
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 1000)
  const all = await loadAll()
  const items = all
    .map((x) => x.item)
    .filter((e) => {
      // 对齐旧行为：grade+semester 拼成完整 tag 精确匹配（两者都传才过滤）
      if (grade && semester) {
        const tag = grade + semester
        if (!(Array.isArray(e.tags) && (e.tags as string[]).includes(tag))) return false
      }
      if (type && e.type !== type) return false
      return true
    })
  // 对齐旧行为：按 tags 长度降序（更多 tag 优先）
  items.sort((a, b) => (Array.isArray(b.tags) ? (b.tags as string[]).length : 0) - (Array.isArray(a.tags) ? (a.tags as string[]).length : 0))
  return c.json({ total: items.length, items: items.slice(0, limit) })
})

// GET /api/v1/wordbank/search
router.get("/search", async (c) => {
  const q = c.req.query("q") ?? ""
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 500)
  if (!q) return c.json({ total: 0, items: [] })
  const all = await loadAll()
  const items = all.map((x) => x.item).filter((i) => String(i.text ?? "").includes(q))
  // 对齐旧行为：tags 长度降序，text 升序二级
  items.sort(
    (a, b) =>
      (Array.isArray(b.tags) ? (b.tags as string[]).length : 0) - (Array.isArray(a.tags) ? (a.tags as string[]).length : 0) ||
      String(a.text).localeCompare(String(b.text))
  )
  return c.json({ total: items.length, items: items.slice(0, limit) })
})

// POST /api/v1/wordbank/add-word
router.post("/add-word", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.text) return c.json({ detail: "缺少 text" }, 400)
  const text = String(body.text)
  const kind = body?.type === "words" ? "words" : "chars"
  const tags = Array.isArray(body?.tags) ? body.tags.map(String) : []
  // 对齐旧行为：破坏式替换——命中则整体替换（旧字段全丢），未命中则追加
  const item: WordBankItem = {
    text,
    tags,
    type: kind,
    pinyin: String(body?.pinyin ?? ""),
    ipa: "",
    ipa_uk: "",
    letter: "",
    phonemes: [],
    phonemes_uk: [],
    emoji: "",
    difficulty: 1,
    translation: "",
  }
  const existing = await getDb().select({ text: wordbankItem.text }).from(wordbankItem).where(eq(wordbankItem.text, text)).get()
  const status = existing ? "updated" : "added"
  await getDb()
    .insert(wordbankItem)
    .values({ text, kind, json: JSON.stringify(item) })
    .onConflictDoUpdate({
      target: wordbankItem.text,
      set: { kind, json: JSON.stringify(item) },
    })
    .run()
  return c.json({ status })
})

export default router