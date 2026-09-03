/** 生成字词内容路由 — /api/v1/generated-dict
 *
 * 场景：每日一练加入了「字库/词库」里没有的字词时，按需调用大模型生成
 *   - 字（char）：拼音 + 2 个组词 + 1 个句子
 *   - 词（word）：1 个句子
 * 生成结果缓存到 R2（data/generated_dict.json，按 type:text 去重），下次直接命中，
 * 不重复消耗 LLM。TTS 音频由前端按需调用 /tts/synthesize（R2 缓存）。
 *
 * 与 chinese_practice.ts 一致的缓存模式：ttlCache 单飞 + writeJson 落 R2 + refresh。
 */
import { Hono } from "hono"
import { readJson, writeJson, dataPath } from "../lib/jsonfile.js"
import { ttlCache } from "../lib/ttlCache.js"
import { chat } from "../lib/deepseek.js"

const router = new Hono()

const GEN_PATH = dataPath("generated_dict.json")

export interface GenEntry {
  type: "char" | "word"
  text: string
  /** 组词（仅 char 有，最多 2 个） */
  words: string[]
  /** 句子 */
  sentence: string
  /** 拼音（仅 char 有，含声调数字，如 ma3） */
  pinyin?: string
  source: "llm" | "cache" | "error"
}

type GenMap = Record<string, GenEntry>

let cache: GenMap = {}
const keyOf = (type: "char" | "word", text: string) => `${type}:${text}`

const store = ttlCache<void>(
  async () => {
    cache = await readJson<GenMap>(GEN_PATH, {})
  },
  60_000,
)
const ensureLoaded = (): Promise<void> => store.get()
const save = async () => {
  await writeJson(GEN_PATH, cache)
  store.refresh()
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

/** 为单字生成 拼音 + 2 组词 + 1 句子 */
async function generateChar(ch: string): Promise<GenEntry> {
  const prompt = `你是一位小学语文教学专家。请为汉字"${ch}"返回以下信息，只输出JSON：\n{"pinyin":"拼音(含声调数字,如 ma3)","words":["组词1","组词2"],"sentence":"包含该字的简单例句,不超过15字"}`
  const reply = await chat(
    "你是一个只输出JSON的语文教学助手。",
    prompt,
    2000,
    "gen_dict_char",
  )
  const p = extractJson(reply)
  const rawWords = Array.isArray(p?.words) ? p!.words.map(String).filter(Boolean) : []
  const words = rawWords.slice(0, 2)
  return {
    type: "char",
    text: ch,
    words,
    sentence: String(p?.sentence ?? ""),
    pinyin: String(p?.pinyin ?? ""),
    source: "llm",
  }
}

/** 为词语生成 1 个句子 */
async function generateWord(w: string): Promise<GenEntry> {
  const prompt = `为词语"${w}"造一个不超过15字的简单句子,适合小学生理解。\n只输出JSON：{"sentence":"句子"}`
  const reply = await chat(
    "你是一个只输出JSON的小学语文造句助手。",
    prompt,
    1000,
    "gen_dict_word",
  )
  const p = extractJson(reply)
  return {
    type: "word",
    text: w,
    words: [],
    sentence: String(p?.sentence ?? ""),
    source: "llm",
  }
}

/** POST /api/v1/generated-dict/ensure
 * body: { items: [{ type: "char"|"word", text: "火" }] }
 * 返回: { items: GenEntry[] }（已生成/缓存的内容；缺失则现场生成并落库）
 */
router.post("/ensure", async (c) => {
  const body = await c.req.json().catch(() => null)
  const items = Array.isArray(body?.items) ? body.items : []
  await ensureLoaded()

  const out: GenEntry[] = []
  let changed = false
  for (const it of items) {
    const type: "char" | "word" = it?.type === "word" ? "word" : "char"
    const text = String(it?.text ?? "").trim()
    if (!text) continue
    const k = keyOf(type, text)
    if (cache[k]) {
      out.push({ ...cache[k], source: "cache" })
      continue
    }
    try {
      const entry = type === "char" ? await generateChar(text) : await generateWord(text)
      cache[k] = entry
      changed = true
      out.push({ ...entry, source: "llm" })
    } catch (e) {
      // 生成失败（预算/网络）不阻断其余项；返回 error 源供前端降级展示
      out.push({ type, text, words: [], sentence: "", source: "error" })
      console.warn(`[generated-dict] 生成失败 ${type}:${text}:`, (e as Error).message)
    }
  }
  if (changed) await save()
  return c.json({ items: out })
})

/** GET /api/v1/generated-dict/:type/:text — 单条查询（仅缓存命中，未生成返回 404） */
router.get("/:type/:text", async (c) => {
  const type: "char" | "word" = c.req.param("type") === "word" ? "word" : "char"
  const text = c.req.param("text")
  await ensureLoaded()
  const e = cache[keyOf(type, text)]
  if (!e) return c.json({ detail: "未生成" }, 404)
  return c.json(e)
})

export default router
