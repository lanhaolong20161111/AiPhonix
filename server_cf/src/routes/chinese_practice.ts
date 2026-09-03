/** ChinesePractice 路由 — /api/v1/llm/word-info|sentence-generate|sentence-batch-save + /api/v1/chinese/polyphone
 *  Cloud 版：模块级 ensureLoaded 变 async（懒加载，首个请求装载一次）；
 *  Android assets 的 chinese_wordbank.json → R2 key dataPath("chinese_wordbank.json")；
 *  fs 同步读写 → R2 async（exists/readText）+ readJson/writeJson await。
 */
import { Hono } from "hono"
import { exists, readText } from "../lib/storage.js"
import { readJson, writeJson, updateJson, dataPath } from "../lib/jsonfile.js"
import { ttlCache } from "../lib/ttlCache.js"
import { chat } from "../lib/deepseek.js"
import { parsePinyin } from "../lib/pinyin.js"
import { resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()

// Cloud 版：原 Android assets 路径 join(..., "app", "src", "main", "assets", "chinese_wordbank.json")
// → 改为 R2 key data/chinese_wordbank.json（种子时上传到 R2 data/ 前缀）
const WORD_BANK_PATH = dataPath("chinese_wordbank.json")
const SENTENCE_CACHE_PATH = dataPath("word_sentences.json")

// 静态汉字信息
interface CharInfo {
  char: string
  radical?: string
  decomposition?: string[]
  stroke_count?: number
  structure?: string
  words?: string[]
  sentence?: string
}

let charMap = new Map<string, CharInfo>()
let pinyinMap = new Map<string, string>()
let sentenceCache: Record<string, { sentence: string; source: string }> = {}

// 60s TTL 懒加载单飞（🟠6）：char_info/词库只读数据整体替换；sentenceCache 合并（本地已写键保留，其余取 R2）
const store = ttlCache<void>(
  async () => {
    // char_info.json → charMap（整体替换）
    const nextChar = new Map<string, CharInfo>()
    const charInfoPath = dataPath("char_info.json")
    if (await exists(charInfoPath)) {
      const data = await readJson<Record<string, CharInfo> | CharInfo[]>(charInfoPath, [])
      const raw = Array.isArray(data) ? data : Object.values(data)
      for (const item of raw) {
        if (item?.char) nextChar.set(item.char, item)
      }
    }
    charMap = nextChar

    // 拼音映射 → pinyinMap（整体替换）
    const nextPinyin = new Map<string, string>()
    if (await exists(WORD_BANK_PATH)) {
      try {
        const content = await readText(WORD_BANK_PATH)
        const data = JSON.parse(content ?? "{}")
        const chars = data?.chars ?? []
        for (const entry of chars) {
          if (entry?.pinyin) nextPinyin.set(entry.text, entry.pinyin)
        }
      } catch {
        /* ignore */
      }
    }
    pinyinMap = nextPinyin

    // 造句缓存 → 合并（本地已写键保留 = 本地最新；其余取 R2 = 跨 isolate 更新可见）
    const fresh = await readJson<Record<string, { sentence: string; source: string }>>(SENTENCE_CACHE_PATH, {})
    sentenceCache = { ...fresh, ...sentenceCache }
  },
  60_000
)

const ensureLoaded = (): Promise<void> => store.get()

// P1-6：用 updateJson 合并写回（读当前 R2 值再并入本地 sentenceCache 增量），同 key 串行，
// 避免并发请求在 await 处交错导致更新丢失（跨 isolate 限制见 jsonfile.ts 注释）。
const saveSentenceCache = async () => {
  await updateJson<Record<string, { sentence: string; source: string }>>(
    SENTENCE_CACHE_PATH,
    (current) => ({ ...current, ...sentenceCache }),
    {},
  )
  store.refresh() // 本地已写入，重置计时避免刚写完又重读
}

const extractJson = (raw: string): Record<string, unknown> | null => {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

// POST /api/v1/llm/word-info（挂载到 /llm 前缀）
router.post("/word-info", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const char = String(body?.char ?? "")
  if (!char) return c.json({ detail: "缺少 char" }, 400)
  await ensureLoaded()

  const info = charMap.get(char)
  if (info) {
    let sentence = ""
    try {
      const raw = await chat(
        "你是一个只输出JSON的小学语文造句助手。",
        `为汉字"${char}"造一个不超过12字的简单句子，适合小学生理解。\n只输出JSON：{"sentence": "句子"}`,
        1000,
        "word_info"
      )
      const res = extractJson(raw)
      sentence = String(res?.sentence ?? "")
    } catch {
      /* 忽略 */
    }
    if (!sentence) {
      sentence = info.words?.length ? `我们来学习 ${char} 这个字。` : `这是汉字 ${char}。`
    }
    let pinyinInfo: unknown = null
    const rawPinyin = pinyinMap.get(char)
    if (rawPinyin) {
      try {
        pinyinInfo = parsePinyin(rawPinyin)
      } catch {
        /* ignore */
      }
    }
    return c.json({
      char: info.char ?? char,
      radical: info.radical ?? "",
      decomposition: info.decomposition ?? [],
      stroke_count: info.stroke_count ?? 0,
      structure: info.structure ?? "",
      words: info.words ?? [],
      sentence,
      pinyin: pinyinInfo,
      source: "local",
    })
  }

  // LLM fallback
  const prompt = `你是一位小学语文教学专家。请为汉字"${char}"返回以下信息，只输出JSON：\n{"char":"${char}","radical":"偏旁部首","stroke_count":笔画数,"structure":"结构","words":["组词1","组词2","组词3"],"sentence":"包含该字的简单例句(不超过12字)"}`
  try {
    const reply = await chat("你是一个只输出JSON的语文教学助手。", prompt, 2000, "word_info_batch")
    const parsed = extractJson(reply)
    if (!parsed) {
      return c.json({
        char, radical: "", decomposition: [], stroke_count: 0, structure: "",
        words: [], sentence: "", pinyin: null, source: "llm", raw: reply,
      })
    }
    return c.json({
      char: parsed.char ?? char,
      radical: parsed.radical ?? "",
      decomposition: Array.isArray(parsed.decomposition) ? parsed.decomposition : [],
      stroke_count: Number(parsed.stroke_count ?? 0),
      structure: parsed.structure ?? "",
      words: Array.isArray(parsed.words) ? parsed.words.map(String) : [],
      sentence: parsed.sentence ?? "",
      pinyin: null,
      source: "llm",
    })
  } catch (e) {
    return c.json({ detail: (e as Error).message }, 500)
  }
})

// POST /api/v1/llm/sentence-generate（挂载到 /llm 前缀）
router.post("/sentence-generate", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const word = String(body?.word ?? "")
  if (!word) return c.json({ detail: "缺少 word" }, 400)
  await ensureLoaded()

  if (sentenceCache[word]) {
    return c.json({ word, sentence: sentenceCache[word].sentence, source: sentenceCache[word].source ?? "cache" })
  }
  const prompt = `为词语"${word}"造一个不超过15字的简单句子，适合小学生理解。\n只输出JSON：{"sentence": "句子"}`
  try {
    const reply = await chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "sentence_generate")
    const res = extractJson(reply)
    const sentence = String(res?.sentence ?? "")
    sentenceCache[word] = { sentence, source: "llm" }
    await saveSentenceCache()
    return c.json({ word, sentence, source: "llm" })
  } catch (e) {
    return c.json({ detail: (e as Error).message }, 500)
  }
})

// POST /api/v1/llm/sentence-batch-save（挂载到 /llm 前缀）
router.post("/sentence-batch-save", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const sentences = body?.sentences ?? {}
  let added = 0
  for (const [word, item] of Object.entries(sentences) as [string, any][]) {
    if (item?.sentence) {
      sentenceCache[word] = { sentence: item.sentence, source: item?.source ?? "cache" }
      added++
    }
  }
  await saveSentenceCache()
  return c.json({ added, total: Object.keys(sentenceCache).length })
})

export default router
