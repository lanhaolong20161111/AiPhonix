/** ChinesePractice 路由 — /api/v1/llm/word-info|sentence-generate|sentence-batch-save + /api/v1/chinese/polyphone */
import { Hono } from "hono"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson, writeJson, dataPath } from "../lib/jsonfile.js"
import { chat } from "../lib/deepseek.js"
import { parsePinyin } from "../lib/pinyin.js"

const router = new Hono()

// server_ts/src/routes → server_py → AiPhonix 根
const HERE = dirname(fileURLToPath(import.meta.url))
const AI_PHONIX_ROOT = join(HERE, "../../../")
const WORD_BANK_PATH = join(AI_PHONIX_ROOT, "app", "src", "main", "assets", "chinese_wordbank.json")
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
let loaded = false

const ensureLoaded = () => {
  if (loaded) return
  // char_info.json
  const charInfoPath = dataPath("char_info.json")
  if (existsSync(charInfoPath)) {
    const data = readJson<Record<string, CharInfo> | CharInfo[]>(charInfoPath, [])
    const raw = Array.isArray(data) ? data : Object.values(data)
    for (const item of raw) {
      if (item?.char) charMap.set(item.char, item)
    }
  }
  // 拼音映射
  if (existsSync(WORD_BANK_PATH)) {
    try {
      const data = JSON.parse(readFileSync(WORD_BANK_PATH, "utf-8"))
      const chars = data?.chars ?? []
      for (const entry of chars) {
        if (entry?.pinyin) pinyinMap.set(entry.text, entry.pinyin)
      }
    } catch {
      /* ignore */
    }
  }
  // 造句缓存
  sentenceCache = readJson<Record<string, { sentence: string; source: string }>>(SENTENCE_CACHE_PATH, {})
  loaded = true
}
ensureLoaded()

const saveSentenceCache = () => {
  writeJson(SENTENCE_CACHE_PATH, sentenceCache)
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
  const body = await c.req.json().catch(() => null)
  const char = String(body?.char ?? "")
  if (!char) return c.json({ detail: "缺少 char" }, 400)
  ensureLoaded()

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
  const body = await c.req.json().catch(() => null)
  const word = String(body?.word ?? "")
  if (!word) return c.json({ detail: "缺少 word" }, 400)
  ensureLoaded()

  if (sentenceCache[word]) {
    return c.json({ word, sentence: sentenceCache[word].sentence, source: sentenceCache[word].source ?? "cache" })
  }
  const prompt = `为词语"${word}"造一个不超过15字的简单句子，适合小学生理解。\n只输出JSON：{"sentence": "句子"}`
  try {
    const reply = await chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "sentence_generate")
    const res = extractJson(reply)
    const sentence = String(res?.sentence ?? "")
    sentenceCache[word] = { sentence, source: "llm" }
    saveSentenceCache()
    return c.json({ word, sentence, source: "llm" })
  } catch (e) {
    return c.json({ detail: (e as Error).message }, 500)
  }
})

// POST /api/v1/llm/sentence-batch-save（挂载到 /llm 前缀）
router.post("/sentence-batch-save", async (c) => {
  const body = await c.req.json().catch(() => null)
  const sentences = body?.sentences ?? {}
  let added = 0
  for (const [word, item] of Object.entries(sentences) as [string, any][]) {
    if (item?.sentence) {
      sentenceCache[word] = { sentence: item.sentence, source: item?.source ?? "cache" }
      added++
    }
  }
  saveSentenceCache()
  return c.json({ added, total: Object.keys(sentenceCache).length })
})

export default router
