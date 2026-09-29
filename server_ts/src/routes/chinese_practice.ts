/** ChinesePractice 路由 — /api/v1/llm/word-info|sentence-generate|sentence-batch-save + /api/v1/chinese/polyphone */
import { Hono } from "hono"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson, writeJson, dataPath, findFirstExisting } from "../lib/jsonfile.js"
import { chat } from "../lib/deepseek.js"
import { parsePinyin } from "../lib/pinyin.js"
import { ruleCheckSentence, buildCheckPrompt, parseCheckResult, generateWithGuard } from "../lib/sentenceGuard.js"

const router = new Hono()

// server_ts/src/routes → server_py → AiPhonix 根（dist/routes 同深度，构建后仍成立）
const HERE = dirname(fileURLToPath(import.meta.url))
const AI_PHONIX_ROOT = join(HERE, "../../../")
/** 词库 JSON：挂载卷可覆盖 → 本机 dev 原位置 → 前端 public 副本 → 容器镜像内自包含副本 */
const WORD_BANK_PATH =
  findFirstExisting([
    dataPath("chinese_wordbank.json"),
    join(AI_PHONIX_ROOT, "app", "src", "main", "assets", "chinese_wordbank.json"),
    join(AI_PHONIX_ROOT, "web", "public", "chinese_wordbank.json"),
    join(AI_PHONIX_ROOT, "server_ts", "assets", "chinese_wordbank.json"),
  ]) ?? join(AI_PHONIX_ROOT, "app", "src", "main", "assets", "chinese_wordbank.json")
const SENTENCE_CACHE_PATH = dataPath("word_sentences.json")
/** 词语结构规律缓存（独立文件，低频整写安全） */
const STRUCTURE_CACHE_PATH = dataPath("word_structure.json")

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

interface SentenceCacheItem {
  sentence: string
  sentence2?: string
  source: string
}

/** 词语结构规律（结构高亮 + AI 讲解用）：pattern=结构名，roles=逐字角色（与字序一一对应），summary=给小学生的一句话讲解 */
interface WordStructure {
  pattern: string
  roles: { char: string; role: string }[]
  summary: string
}

let charMap = new Map<string, CharInfo>()
let pinyinMap = new Map<string, string>()
let sentenceCache: Record<string, SentenceCacheItem> = {}
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
  sentenceCache = readJson<Record<string, SentenceCacheItem>>(SENTENCE_CACHE_PATH, {})
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

/** 单字例句生成：规则审核（必须含 char + 长度合理），不过自动重试。
 * 三次不过返回 fallback（宁缺毋滥，不阻塞查字主流程）。 */
async function checkedWordExample(char: string, fallback: string): Promise<string> {
  const attempt = async (feedback: string): Promise<string> => {
    let prompt = `为汉字"${char}"造一个不超过12字的简单句子，适合小学生理解。\n只输出JSON：{"sentence": "句子"}`
    if (feedback) prompt += `\n注意：上次生成未通过审核，原因：${feedback}。请修正：例句必须包含"${char}"且语法通顺、语义合理。`
    const reply = await chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "word_info")
    const res = extractJson(reply)
    return String(res?.sentence ?? "").trim()
  }
  const verify = async (s: string): Promise<{ ok: boolean; reason: string }> => {
    if (!s) return { ok: false, reason: "返回为空" }
    // 规则审核（免费、快）：必须含该字 + 长度合理，不再单独调 LLM 审核语法/语义（省一次 LLM 往返）
    const rule = ruleCheckSentence(s, [char], { min: 2, max: 20 })
    if (!rule.ok) return { ok: false, reason: rule.reasons.join("；") }
    return { ok: true, reason: "" }
  }
  try {
    return await generateWithGuard(attempt, verify)
  } catch {
    return fallback
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
    const fallback = info.words?.length ? `我们来学习 ${char} 这个字。` : `这是汉字 ${char}。`
    let sentence = ""
    try {
      sentence = await checkedWordExample(char, fallback)
    } catch {
      sentence = fallback
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

  // LLM fallback（字不在本地词库）：整包取信息，例句单独走审核生成（必须含该字）
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
    const sentence = await checkedWordExample(char, "").catch(() => "")
    return c.json({
      char: parsed.char ?? char,
      radical: parsed.radical ?? "",
      decomposition: Array.isArray(parsed.decomposition) ? parsed.decomposition : [],
      stroke_count: Number(parsed.stroke_count ?? 0),
      structure: parsed.structure ?? "",
      words: Array.isArray(parsed.words) ? parsed.words.map(String) : [],
      sentence,
      pinyin: null,
      source: "llm",
    })
  } catch (e) {
    return c.json({ detail: (e as Error).message }, 500)
  }
})

/** 调 LLM 造 n 句：n=1 走旧 prompt（兼容旧调用），n≥2 一次要多个不同句子。
 * 生成后过规则审核（每句必须包含目标词/长度/无重复），不过自动重试（最多 2 次尝试）。
 * 返回去空且通过审核的句子数组。 */
async function generateSentences(word: string, count: number): Promise<string[]> {
  const attempt = async (feedback: string): Promise<string[]> => {
    let prompt: string
    if (count <= 1) {
      prompt = `为词语"${word}"造一个不超过15字的简单句子，适合小学生理解。\n只输出JSON：{"sentence": "句子"}`
    } else {
      prompt = `为词语"${word}"造${count}个不同的、各不超过15字的简单句子，适合小学生理解。\n只输出JSON：{"sentences":["句子1","句子2"]}`
    }
    if (feedback) prompt += `\n注意：上次生成未通过审核，原因：${feedback}。请修正：句子必须真正用上"${word}"且语法通顺、语义合理。`
    const reply = await chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "sentence_generate")
    const res = extractJson(reply)
    if (count <= 1) {
      const s = String(res?.sentence ?? "").trim()
      return s ? [s] : []
    }
    const arr = Array.isArray(res?.sentences)
      ? res.sentences.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
      : []
    return arr.slice(0, count)
  }
  const verify = async (list: string[]): Promise<{ ok: boolean; reason: string }> => {
    if (!list.length) return { ok: false, reason: "返回为空" }
    // 规则审核（免费、快）：每句必须包含目标词、长度合理、无重复粘贴（防乱编核心）。
    // 造句是低风险短句，规则 + 生成 prompt 已足够，不再单独调 LLM 审核语法/语义，
    // 省一次 LLM 往返，速度近乎减半（用户反馈「例句生成太慢」）。
    for (const s of list) {
      const r = ruleCheckSentence(s, [word], { min: 3, max: 30 })
      if (!r.ok) return { ok: false, reason: `"${s.slice(0, 12)}…" ${r.reasons.join("；")}` }
    }
    return { ok: true, reason: "" }
  }
  try {
    return await generateWithGuard(attempt, verify, 2) // 1 次生成 + 最多 1 次重试（速度优先）
  } catch {
    return [] // 重试后仍不过 → 返回空，调用方降级（宁缺毋滥）
  }
}

// POST /api/v1/llm/sentence-generate（挂载到 /llm 前缀）
// body: { word, count? } —— count 默认 1（兼容旧调用），≥2 时一次造两句并缓存 sentence2
router.post("/sentence-generate", async (c) => {
  const body = await c.req.json().catch(() => null)
  const word = String(body?.word ?? "")
  if (!word) return c.json({ detail: "缺少 word" }, 400)
  ensureLoaded()
  const count = Math.max(1, Math.min(3, Number(body?.count) || 1))

  const cached = sentenceCache[word]
  if (cached?.sentence) {
    // 命中：请求≥2句且缺第2句 → 补造第2句（失败降级为只有第1句，不阻塞）
    if (count >= 2 && !cached.sentence2) {
      try {
        const arr = await generateSentences(word, 2)
        cached.sentence2 = arr[1] ?? arr[0] ?? ""
        saveSentenceCache()
      } catch {
        /* 保留1句 */
      }
    }
    return c.json({
      word,
      sentence: cached.sentence,
      sentence2: cached.sentence2 ?? "",
      sentences: [cached.sentence, cached.sentence2].filter(Boolean),
      source: cached.source ?? "cache",
    })
  }

  try {
    const sentences = await generateSentences(word, count)
    const sentence = sentences[0] ?? ""
    const sentence2 = sentences[1] ?? ""
    sentenceCache[word] = { sentence, sentence2: sentence2 || undefined, source: "llm" }
    saveSentenceCache()
    return c.json({ word, sentence, sentence2: sentence2 ?? "", sentences, source: "llm" })
  } catch (e) {
    return c.json({ detail: (e as Error).message }, 500)
  }
})

// POST /api/v1/llm/sentence-batch-save（挂载到 /llm 前缀）
router.post("/sentence-batch-save", async (c) => {
  const body = await c.req.json().catch(() => null)
  const sentences = body?.sentences ?? {}
  let added = 0
  for (const [word, item] of Object.entries(sentences) as [string, { sentence?: string; source?: string }][]) {
    if (item?.sentence) {
      sentenceCache[word] = { sentence: item.sentence, source: item?.source ?? "cache" }
      added++
    }
  }
  saveSentenceCache()
  return c.json({ added, total: Object.keys(sentenceCache).length })
})

// POST /api/v1/llm/sentence-complete — 语音造句补全（本地开发 parity）
router.post("/sentence-complete", async (c) => {
  const body = await c.req.json().catch(() => null)
  const lang = String(body?.lang ?? "zh").trim() === "en" ? "en" : "zh"
  const partial = String(body?.partial ?? "").trim()
  if (!partial) return c.json({ detail: "缺少 partial" }, 400)
  if (partial.length > 60) return c.json({ detail: "内容过长" }, 422)

  const COMPLETE_CACHE_PATH = dataPath("sentence_complete.json")
  const hash = createHash("sha256").update(`${lang}|${partial}`).digest("hex")
  let cacheAll: Record<string, string[]> = {}
  try { cacheAll = (readJson<Record<string, string[]>>(COMPLETE_CACHE_PATH, {}) ?? {}) as Record<string, string[]> } catch { cacheAll = {} }
  if (cacheAll[hash]?.length) {
    return c.json({ lang, partial, sentences: cacheAll[hash], source: "cache" })
  }

  const core = partial.replace(/[。！？!?，,、\s]+$/g, "").trim()
  const mustContain = core.length >= 2 ? core : partial

  const attempt = async (feedback: string): Promise<string[]> => {
    let prompt =
      lang === "en"
        ? `A child is speaking English and said: "${partial}". Complete it into 3 different natural, grammatically correct full sentences suitable for an elementary student. Each must naturally keep what the child said. Max 10 words each. Output JSON only: {"sentences":["...","...","..."]}`
        : `孩子开口说了一句中文：${partial}。请把它补成 3 个不同、通顺、完整的句子，适合小学生。每句必须自然地保留孩子已经说的内容，不超过 20 字。只输出 JSON：{"sentences":["句子1","句子2","句子3"]}`
    if (feedback) prompt += `\n注意：上次生成未通过审核，原因：${feedback}。请修正后重新生成。`
    const reply = await chat("你是一个只输出JSON的小学语文/英语老师。", prompt, 1500, "sentence_complete")
    const res = extractJson(reply)
    const arr = Array.isArray(res?.sentences) ? res.sentences.map((x: unknown) => String(x ?? "").trim()).filter(Boolean) : []
    return Array.from(new Set(arr)).slice(0, 3)
  }

  const verify = async (list: string[]): Promise<{ ok: boolean; reason: string }> => {
    if (!list.length) return { ok: false, reason: "返回为空" }
    for (const s of list) {
      const r = ruleCheckSentence(s, [mustContain], { min: 3, max: lang === "en" ? 60 : 40 })
      if (!r.ok) return { ok: false, reason: `候选"${s.slice(0, 15)}…"${r.reasons.join("；")}` }
    }
    try {
      const joined = list.join("\n")
      const reply = await chat(
        "你是一个只输出JSON的严格审核老师。",
        buildCheckPrompt(joined, { kind: "word-sentence", targets: [mustContain] }),
        300,
        "sentence_complete_check",
      )
      return parseCheckResult(reply)
    } catch {
      return { ok: true, reason: "" }
    }
  }

  try {
    const sentences = await generateWithGuard(attempt, verify)
    try { cacheAll[hash] = sentences; writeJson(COMPLETE_CACHE_PATH, cacheAll) } catch { /* 缓存失败忽略 */ }
    return c.json({ lang, partial, sentences, source: "llm" })
  } catch (e) {
    return c.json({ detail: `补全未通过审核：${(e as Error).message}` }, 422)
  }
})

// ── AI 英语对话陪练：剧情/目标句生成 + 整句判定（本地 parity） ──

// POST /api/v1/llm/en-dialogue-setup — 支持 lang=zh 走中文口语对话（造句小助手等复用）
router.post("/en-dialogue-setup", async (c) => {
  const body = await c.req.json().catch(() => null)
  const lang = body?.lang === "zh" ? "zh" : "en"
  const topic = String(body?.topic ?? "").trim()
  const words = (Array.isArray(body?.words) ? body.words : []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
  const sentences = (Array.isArray(body?.sentences) ? body.sentences : []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
  // 词、句、主题三者至少给一个：只给主题时按主题自由对话（前端设置页允许「只填场景」）
  if (!words.length && !sentences.length && !topic) return c.json({ detail: "请至少提供一个词、句子或主题" }, 400)

  const DIALOGUE_CACHE_PATH = dataPath(lang === "zh" ? "zh_dialogue.json" : "en_dialogue.json")
  const REJECTS_PATH = dataPath("en_dialogue_rejects.json")
  const MAX_REJECT_RECORDS = 200
  const key = `${lang}|${topic}|${words.join("、")}|${sentences.join("、")}`
  const hash = createHash("sha256").update(key).digest("hex")
  let cacheAll: Record<string, unknown> = {}
  try { cacheAll = (readJson<Record<string, unknown>>(DIALOGUE_CACHE_PATH, {}) ?? {}) as Record<string, unknown> } catch { cacheAll = {} }
  if (cacheAll[hash]) return c.json(cacheAll[hash])

  const wordsTxt = words.length ? words.join(lang === "zh" ? "、" : ", ") : "（无）"
  const sentsTxt = sentences.length ? sentences.join(lang === "zh" ? "；" : " | ") : "（无）"
  const prompt =
    lang === "zh"
      ? `你是小学语文老师，给 7-10 岁的中国孩子编一段简短自然的中文口语对话（AI 角色说一句，孩子接一句）。\n` +
        `主题/场景：${topic ? topic : "未指定——请根据下面的练习词语/句子挑一个最合适的场景（如家里、公园、学校）。"}\n` +
        `练习词语：${wordsTxt}\n` +
        `练习句子（尽量自然用上）：${sentsTxt}\n` +
        `规则：\n` +
        `1. 共 3-5 轮。每轮 "ai" 是 AI 台词（≤18 字，口语自然），"target" 是孩子应接的一句话（≤22 字），必须自然用上至少一个练习词/句。\n` +
        `2. AI 台词要为 target 铺垫，让 target 像是孩子顺着说的话；台词与回答连起来要通顺。\n` +
        `3. "hint_words" = 把 target 按「词/短语」切好放在数组里（如 ["今天","天气","真","好"]；词或两字短语为单位，不要逐字拆碎，也不要把整句当一个）。\n` +
        `4. 对话温暖、简单，有小小的故事感。\n` +
        `5. 每行额外给 "chunks"：把 target 切成 2~4 个词的发音意群（介词/助词如“的/了/在/去”不要放在片段开头），如 "今天天气真好，我们一起去公园。" -> chunks ["今天天气真好","我们","一起去公园"]。chunks 按序拼接（忽略空格标点）必须等于 target。\n` +
        `只输出 JSON：{"title":"简短标题","lines":[{"ai":"...","target":"...","hint_words":[...],"chunks":[...]}]}`
      : `You are an English teacher creating a short dialogue for a Chinese elementary student (age 7-10).\n` +
        (topic
          ? `Topic/scene (fixed): ${topic}\n`
          : `Topic/scene: NOT given — you decide the most natural scene that fits the practice words/sentences below (e.g. park, zoo, classroom, home).\n`) +
        `Words to practice: ${wordsTxt}\n` +
        `Sentences to practice (use naturally if possible): ${sentsTxt}\n` +
        `Create 3-5 turns of a natural dialogue (a friendly AI character speaks, the child answers). Rules:\n` +
        `1. Each turn: "ai" is the AI line (<=12 words, natural English).\n` +
        `2. "target" is the child's expected reply (<=10 words), must naturally use at least one practice word/sentence.\n` +
        `3. "hint_words" = target split into words in order (punctuation removed).\n` +
        `4. Dialogue should be simple, warm, build a little story arc.\n` +
        `5. Every "target" must read as a natural reply to the AI line right before it; imagine them spoken together.\n` +
        `6. If a practice sentence is a greeting/introduction (e.g. "Nice to meet you", "Hello", "My name is ..."), ` +
        `start the dialogue at a FIRST MEETING so it fits: the AI greets/introduces itself first, then the child's reply can say it naturally. ` +
        `Never reuse such a greeting later after the meeting already happened.\n` +
        `7. Each "target" also gets "chunks": break it into 2-4 word natural pronunciation chunks (do NOT start a chunk with "to/the/and/of"), ` +
        `e.g. target "I want to go to the park." -> chunks ["I want","to go","to the park"]. Chunks joined (case/spaces/punct ignored) must equal target.\n` +
        `Output JSON only: {"title":"short title","lines":[{"ai":"...","target":"...","hint_words":[...],"chunks":[...]}]}`

  const attempt = async (feedback: string): Promise<{
    title: string
    lines: { ai: string; target: string; hint_words: string[]; chunks?: string[] }[]
  }> => {
    let p = prompt
    if (feedback) p += `\n上次结果被拒：${feedback}。请修正，并换一个不同的开场（不要重复同样的剧情设定）。`
    const reply = await chat(lang === "zh" ? "你只输出 JSON。" : "You only output JSON.", p, 2500, lang === "zh" ? "zh_dialogue_setup" : "en_dialogue_setup", true)
    const j = extractJson(reply)
    const title = String(j?.title ?? "").trim()
    const rawLines = Array.isArray(j?.lines) ? j.lines : []
    const lines = rawLines
      .map((l: Record<string, unknown>) => {
        const ai = String(l?.ai ?? "").trim()
        const target = String(l?.target ?? "").trim()
        let hint_words: string[]
        if (Array.isArray(l?.hint_words)) {
          hint_words = l.hint_words
            .map((w: unknown) => String(w ?? "").trim())
            .filter(Boolean)
            .slice(0, 20)
        } else if (lang === "zh") {
          // 兜底：模型没给切分时按字拆（LLM 正常应给词/短语）
          hint_words = [...target].filter((ch) => !/\s/.test(ch)).map((ch) => ch)
        } else {
          hint_words = target.split(/\s+/).map((w) => w.replace(/[^A-Za-z']+/g, "")).filter(Boolean)
        }
        const chunks = Array.isArray(l?.chunks)
          ? l.chunks.map((w: unknown) => String(w ?? "").trim()).filter(Boolean).slice(0, 10)
          : undefined
        return { ai, target, hint_words, chunks: chunks && chunks.length ? chunks : undefined }
      })
      .filter((l: { ai: string; target: string }) => l.ai && l.target)
      .slice(0, 5)
    return { title, lines }
  }

  const normFor = (s: string) =>
    lang === "zh"
      ? s.replace(/[^\u4e00-\u9fff0-9a-z]/gi, "").toLowerCase()
      : s.toLowerCase().replace(/[^a-z0-9']/g, "")

  const verify = async (out: {
    title: string
    lines: { ai: string; target: string; chunks?: string[] }[]
  }): Promise<{ ok: boolean; reason: string }> => {
    if (!out.lines.length) return { ok: false, reason: "没有生成有效轮次" }
    // 意群一致性：chunks 按序拼接（忽略空格/标点/大小写）必须等于 target
    for (const l of out.lines) {
      if (Array.isArray(l.chunks) && l.chunks.length) {
        if (normFor(l.chunks.join(" ")) !== normFor(l.target)) {
          return { ok: false, reason: `意群 chunks 与 target 拼接不一致：${l.chunks.join(" / ").slice(0, 40)}` }
        }
      }
    }
    for (const l of out.lines) {
      // 单轮基础规则：非空 + 长度合理（不在单轮强制出现练习词——允许练习词分散在不同轮次）
      const r = ruleCheckSentence(l.target, [], { min: 2, max: lang === "zh" ? 40 : 80 })
      if (!r.ok) return { ok: false, reason: `目标句 "${l.target.slice(0, 20)}…" ${r.reasons.join("；")}` }
      const aiLen = lang === "zh" ? [...l.ai].length : l.ai.split(/\s+/).length
      if (aiLen > (lang === "zh" ? 40 : 20)) return { ok: false, reason: "台词过长" }
      // 英文题句禁止混入中文（防止台词自带翻译被 TTS 一起朗读）
      if (lang === "en" && (/[\u4e00-\u9fff]/.test(l.ai) || /[\u4e00-\u9fff]/.test(l.target))) {
        return { ok: false, reason: "英文台词/目标句里混入了中文，请只保留英文" }
      }
    }
    // 整段覆盖规则：所有目标句合起来至少用到任一练习单词（多词句子交给 LLM 语义审）
    const singleWords = words.filter((w: unknown) => !/\s/.test(String(w ?? "")))
    if (singleWords.length) {
      const allTargets = out.lines.map((l) => l.target).join(" ")
      const hit = singleWords.some((w: unknown) =>
        lang === "zh" ? allTargets.includes(String(w).trim()) : allTargets.toLowerCase().includes(String(w).toLowerCase()),
      )
      if (!hit) return { ok: false, reason: `整个对话都没用到练习词"${String(singleWords[0])}"` }
    }
    // 练习句全程至多自然使用一次：en 按 ≥3 词、zh 按 ≥4 字才做子串计数（防短句误伤）。
    // 拦截"告别轮又把问候句说一遍"这类重复，触发换开场重试。
    const longSentences = sentences.filter((s: unknown) => {
      const t = String(s ?? "").trim()
      return lang === "zh" ? [...t].length >= 4 : t.split(/\s+/).length >= 3
    })
    if (longSentences.length) {
      const whole = out.lines.map((l) => `${l.ai} ${l.target}`).join(" ")
      for (const s of longSentences) {
        const needle = String(s).trim()
        const hay = lang === "zh" ? whole : whole.toLowerCase()
        const n = lang === "zh" ? needle : needle.toLowerCase()
        let cnt = 0
        let idx = hay.indexOf(n)
        while (idx !== -1) {
          cnt++
          idx = hay.indexOf(n, idx + n.length)
        }
        if (cnt > 1) return { ok: false, reason: `练习句"${needle}"在整段出现 ${cnt} 次，每句全程至多自然使用一次` }
      }
    }
    try {
      const sample = out.lines.map((l) => `AI: ${l.ai}  孩子：${l.target}`).join("\n")
      const practiceHint =
        (words.length ? `练习词：${words.join("、")}。` : "") +
        (sentences.length ? `练习句：${sentences.join("；")}。` : "")
      const reply = await chat(
        lang === "zh" ? "你只输出 JSON。" : "You only output JSON.",
        lang === "zh"
          ? `请评审这段给中国孩子（7-10 岁）的中文口语对话：是否自然？符合孩子年龄？每一句孩子的回答（target）是否顺着上一句 AI 台词？是否自然用上了 ${practiceHint || "（无必用词，只求自然）"}\n${sample}\n只输出 JSON：{"ok":true|false,"reason":"为 false 时给出简短中文原因"}`
          : `Rate this short English dialogue for a Chinese child. Check: natural? age-appropriate? each child reply (target) fits the AI line? ` +
            `and does the dialogue naturally use the ${practiceHint || "(no required words, just make it natural)"}\n` +
            `${sample}\nOutput JSON: {"ok":true|false,"reason":"if false, short reason"}`,
        300,
        lang === "zh" ? "zh_dialogue_check" : "en_dialogue_check",
        true,
      )
      return parseCheckResult(reply)
    } catch {
      return { ok: true, reason: "" }
    }
  }

  try {
    const out = await generateWithGuard(attempt, verify, 3) // 至多 3 次：问候/初次见面类句子需要多次才能自然融入
    try { cacheAll[hash] = out; writeJson(DIALOGUE_CACHE_PATH, cacheAll) } catch { /* 缓存失败忽略 */ }
    return c.json(out)
  } catch (e) {
    // 记录被拒原因（供同类审核问题归类排查）；记录失败不影响本次 422
    try {
      const errMsg = String((e as Error).message ?? e)
      const rejects = (readJson<Record<string, unknown>>(REJECTS_PATH, {}) ?? {}) as Record<string, unknown>
      rejects[hash] = { key, lang, topic, words, sentences, error: errMsg, at: new Date().toISOString() }
      const entries = Object.entries(rejects)
      if (entries.length > MAX_REJECT_RECORDS) {
        writeJson(REJECTS_PATH, Object.fromEntries(entries.slice(entries.length - MAX_REJECT_RECORDS)))
      } else {
        writeJson(REJECTS_PATH, rejects)
      }
    } catch {
      /* 忽略 */
    }
    return c.json({ detail: `剧情生成未通过审核：${(e as Error).message}` }, 422)
  }
})

// POST /api/v1/llm/en-answer-judge — 支持 lang=zh（中文整句判定）
router.post("/en-answer-judge", async (c) => {
  const body = await c.req.json().catch(() => null)
  const lang = body?.lang === "zh" ? "zh" : "en"
  const target = String(body?.target ?? "").trim()
  const said = String(body?.said ?? "").trim()
  if (!target || !said) return c.json({ detail: "缺少 target 或 said" }, 400)

  const prompt =
    lang === "zh"
      ? `中国孩子在做中文口语对话练习，他（她）说了一句话来回应上一句。请与期望句比较。\n` +
        `期望句："${target}"\n孩子说的："${said}"\n` +
        `对孩子宽松一些：漏掉或换成个别虚词（的/了/吗等）、用更简单的说法但意思相同，都算对；只有核心意思不同或关键词语用错/含糊才算不对。\n` +
        `通过时用 1 句简短的**中文**鼓励话表扬；不通过时 "correct" 原样给出期望句，并给一句简短的中文鼓励。\n` +
        `只输出 JSON：{"ok":true|false,"praise":"中文鼓励语","correct":"不通过时为期望句原文，通过则为空"}`
      : `A Chinese child practicing English said a sentence to complete a dialogue. Compare with the expected answer.\n` +
        `Expected: "${target}"\nChild said: "${said}"\n` +
        `Judge leniently for a child: missing a small function word (the/a/is) is OK; same meaning with simpler words is OK. ` +
        `Only mark NOT OK if core meaning differs or key words are wrong/unclear.\n` +
        `If OK, praise warmly in 1 short English sentence. If NOT OK, provide "correct" as the expected sentence verbatim and a gentle encouragement.\n` +
        `Output JSON only: {"ok":true|false,"praise":"English praise or gentle nudge","correct":"expected sentence if not ok, else empty"}`

  try {
    const reply = await chat(lang === "zh" ? "你只输出 JSON。" : "You only output JSON.", prompt, 600, lang === "zh" ? "zh_answer_judge" : "en_answer_judge", true)
    const j = extractJson(reply)
    const ok = j?.ok === true || j?.ok === "true"
    return c.json({
      ok,
      praise: String(j?.praise ?? "").trim() || (ok ? (lang === "zh" ? "真棒！" : "Great job!") : lang === "zh" ? "再试一次！" : "Try again!"),
      correct: ok ? "" : String(j?.correct ?? target).trim(),
    })
  } catch (e) {
    return c.json({ detail: `判定失败：${(e as Error).message}` }, 500)
  }
})

// POST /api/v1/llm/zh-teach-setup — 语文教学剧本：覆盖全部考查词/句的逐题问答（含分级提示与参考回答）
router.post("/zh-teach-setup", async (c) => {
  const body = await c.req.json().catch(() => null)
  const topic = String(body?.topic ?? "").trim()
  const words = (Array.isArray(body?.words) ? body.words : []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
  const sentences = (Array.isArray(body?.sentences) ? body.sentences : []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
  if (!words.length && !sentences.length) return c.json({ detail: "请至少提供一个词或句子" }, 400)

  const CACHE_PATH = dataPath("zh_teach.json")
  const REJECTS_PATH = dataPath("en_dialogue_rejects.json")
  const MAX_REJECT_RECORDS = 200
  const key = `${topic}|${words.join("、")}|${sentences.join("、")}`
  const hash = createHash("sha256").update(`zhTeach|${key}`).digest("hex")
  let cacheAll: Record<string, unknown> = {}
  try { cacheAll = (readJson<Record<string, unknown>>(CACHE_PATH, {}) ?? {}) as Record<string, unknown> } catch { cacheAll = {} }
  if (cacheAll[hash]) return c.json(cacheAll[hash])

  const units = [...words, ...sentences]
  const wordsTxt = words.length ? words.join("、") : "（无）"
  const sentsTxt = sentences.length ? sentences.join("；") : "（无）"
  const prompt =
    `你是小学语文老师，为 7-10 岁孩子把下面的词语/句子设计成「一问一答」的对话练习，目标是帮孩子理解词意和句型表达。\n` +
    `主题/场景：${topic ? topic : "未指定——请按考查词句挑最合适场景"}\n` +
    `考查词语：${wordsTxt}\n` +
    `考查句子：${sentsTxt}\n` +
    `要求：\n` +
    `1. 题目数量 ≥ ${units.length} 道，尽量一个考查词/句对应一道引导题（可加过渡题）。\n` +
    `2. 每题输出 {"q":引导提问(口语、≤30字,让孩子能答出), "ref":参考回答(≤22字), "focus":本题考查的词/句原文, "hints":[意思解释(12~30字), 含该词/句的自然例句, 只给答案句型骨架或前半句]}\n` +
    `3. "ref" 必须自然用上该题考查词/句。所有题目里，每一个考查词/句至少要出现在某题的 ref 中。\n` +
    `4. hints 是"孩子答不出时逐级加深的提示"，共 3 条：先是意思，再给例句，最后给答案开头/骨架。\n` +
    `只输出 JSON：{"title":"简短标题","items":[{"q":"...","ref":"...","focus":"...","hints":["...","...","..."]}]}`

  const attempt = async (feedback: string) => {
    let p = prompt
    if (feedback) p += `\n上次结果被拒：${feedback}。请修正并换一种编排（不要重复同一批题目）。`
    const reply = await chat("你只输出 JSON。", p, 3000, "zh_teach_setup", true)
    const j = extractJson(reply)
    const title = String(j?.title ?? "").trim()
    const items = (Array.isArray(j?.items) ? j.items : [])
      .map((it: Record<string, unknown>) => ({
        q: String(it?.q ?? "").trim(),
        ref: String(it?.ref ?? "").trim(),
        focus: String(it?.focus ?? "").trim(),
        hints: (Array.isArray(it?.hints) ? it.hints : [])
          .map((h: unknown) => String(h ?? "").trim())
          .filter(Boolean)
          .slice(0, 3),
      }))
      .filter((it: { q: string; ref: string }) => it.q && it.ref)
      .slice(0, 20)
    return { title, items }
  }

  const verify = async (out: { title: string; items: { q: string; ref: string; hints: string[] }[] }) => {
    if (!out.items.length) return { ok: false, reason: "没有生成有效题目" }
    for (const it of out.items) {
      if ([...it.q].length > 40) return { ok: false, reason: `提问过长："${it.q.slice(0, 20)}…"` }
      if ([...it.ref].length < 2 || [...it.ref].length > 40) return { ok: false, reason: `参考回答长度不合理："${it.ref.slice(0, 20)}…"` }
      if (!it.hints.length || [...it.hints[0]].length < 3) return { ok: false, reason: "提示不完整（至少第一级提示要有内容）" }
    }
    const refs = out.items.map((i) => i.ref).join(" ")
    const missing = units.filter((u) => !refs.includes(u))
    if (missing.length) return { ok: false, reason: `考查内容没有被参考回答覆盖：${missing.join("、")}` }
    return { ok: true, reason: "" }
  }

  try {
    const out = await generateWithGuard(attempt, verify, 4)
    try { cacheAll[hash] = out; writeJson(CACHE_PATH, cacheAll) } catch { /* 缓存失败忽略 */ }
    return c.json(out)
  } catch (e) {
    try {
      const errMsg = String((e as Error).message ?? e)
      const rejects = (readJson<Record<string, unknown>>(REJECTS_PATH, {}) ?? {}) as Record<string, unknown>
      rejects[hash] = { kind: "zh_teach", key, topic, words, sentences, error: errMsg, at: new Date().toISOString() }
      const entries = Object.entries(rejects)
      if (entries.length > MAX_REJECT_RECORDS) {
        writeJson(REJECTS_PATH, Object.fromEntries(entries.slice(entries.length - MAX_REJECT_RECORDS)))
      } else {
        writeJson(REJECTS_PATH, rejects)
      }
    } catch { /* 忽略 */ }
    return c.json({ detail: `教学剧本生成未通过审核：${(e as Error).message}` }, 422)
  }
})

// POST /api/v1/llm/zh-teach-judge — 文本作答判定（宽松语义，对则表扬/错则给参考并引导）
router.post("/zh-teach-judge", async (c) => {
  const body = await c.req.json().catch(() => null)
  const q = String(body?.q ?? "").trim()
  const ref = String(body?.ref ?? "").trim()
  const answer = String(body?.answer ?? "").trim()
  if (!q || !answer) return c.json({ detail: "缺少 q 或 answer" }, 400)

  const prompt =
    `小学语文对话练习：\nAI 问：${q}\n参考回答：${ref}\n孩子回答：${answer}\n` +
    `判定对孩子宽松：意思相近、换了说法但正确都算对；答非所问或核心意思错才算不对。\n` +
    `对 → 用 1 句简短中文热情表扬；不对 → correct 填参考回答原文，并给 1 句简短引导孩子明白错在哪。\n` +
    `只输出 JSON：{"ok":true|false,"praise":"中文表扬/鼓励","correct":"不对时参考回答原文，对则为空"}`

  try {
    const reply = await chat("你只输出 JSON。", prompt, 700, "zh_teach_judge", true)
    const j = extractJson(reply)
    const ok = j?.ok === true || j?.ok === "true"
    return c.json({
      ok,
      praise: String(j?.praise ?? "").trim() || (ok ? "真棒！" : "再想想，听听下面的说法。"),
      correct: ok ? "" : String(j?.correct ?? ref).trim(),
    })
  } catch (e) {
    return c.json({ detail: `判定失败：${(e as Error).message}` }, 500)
  }
})

// POST /api/v1/llm/zh-poem-setup — 古诗练习：整体概括 + 逐句原文/白话意思 + 逐字释义
router.post("/zh-poem-setup", async (c) => {
  const body = await c.req.json().catch(() => null)
  const poem = String(body?.poem ?? "").trim()
  if (!poem) return c.json({ detail: "请提供要练的古诗" }, 400)

  const CACHE_PATH = dataPath("zh_poem.json")
  const REJECTS_PATH = dataPath("en_dialogue_rejects.json")
  const MAX_REJECT_RECORDS = 200
  const hash = createHash("sha256").update(`zhPoem|${poem}`).digest("hex")
  let cacheAll: Record<string, unknown> = {}
  try { cacheAll = (readJson<Record<string, unknown>>(CACHE_PATH, {}) ?? {}) as Record<string, unknown> } catch { cacheAll = {} }
  if (cacheAll[hash]) return c.json(cacheAll[hash])

  const norm = (s: string) => s.replace(/[^\u4e00-\u9fff0-9a-zA-Z]/g, "")
  const prompt =
    `给 7-12 岁孩子讲下面这首古诗，用于"逐句跟读+理解"练习。\n` +
    `古诗原文：\n${poem}\n` +
    `要求：\n` +
    `1. "summary"：整体概括（现代汉语，≤80 字，说清写了什么、什么心情/画面）。\n` +
    `2. "lines"：按原诗顺序逐句拆开（每句 4~7 字为常见，也可按逗号/句号切）。每句：\n` +
    `   - "verse"：该句原文（保留原字，不要改动）。\n` +
    `   - "meaning"：该句现代文意思（≤40 字，给孩子讲明白）。\n` +
    `   - "chars"：该句逐字释义数组（不含标点，顺序与 verse 一致），每项 {"c":"字","m":"这个字在本句中的意思(≤12字)"}。\n` +
    `只输出 JSON：{"title":"诗题","summary":"...","lines":[{"verse":"...","meaning":"...","chars":[{"c":"...","m":"..."}]}]}`

  const attempt = async (feedback: string) => {
    let p = prompt
    if (feedback) p += `\n上次结果被拒：${feedback}。请修正后重新输出。`
    const reply = await chat("你只输出 JSON。", p, 3000, "zh_poem_setup", true)
    const j = extractJson(reply)
    const title = String(j?.title ?? "").trim()
    const summary = String(j?.summary ?? "").trim()
    const lines = (Array.isArray(j?.lines) ? j.lines : [])
      .map((l: Record<string, unknown>) => ({
        verse: String(l?.verse ?? "").trim(),
        meaning: String(l?.meaning ?? "").trim(),
        chars: (Array.isArray(l?.chars) ? l.chars : [])
          .map((ch: Record<string, unknown>) => ({ c: String(ch?.c ?? "").trim(), m: String(ch?.m ?? "").trim() }))
          .filter((ch: { c: string }) => ch.c),
      }))
      .filter((l: { verse: string }) => l.verse)
      .slice(0, 12)
    return { title, summary, lines }
  }

  const verify = async (out: { title: string; summary: string; lines: { verse: string; meaning: string; chars: { c: string; m: string }[] }[] }) => {
    if (!out.summary) return { ok: false, reason: "缺少整体概括" }
    if (!out.lines.length) return { ok: false, reason: "没有拆出诗句" }
    if (norm(out.lines.map((l) => l.verse).join("")) !== norm(poem)) {
      return { ok: false, reason: "拆出的诗句拼接与原诗不一致（不要增删或改字）" }
    }
    for (const l of out.lines) {
      if (!l.meaning) return { ok: false, reason: `"${l.verse}" 缺少白话意思` }
      const verseChars = [...norm(l.verse)]
      if (l.chars.length !== verseChars.length) {
        return { ok: false, reason: `"${l.verse}" 逐字释义数量与字数不符（应 ${verseChars.length} 个）` }
      }
      if (l.chars.some((ch, i) => ch.c !== verseChars[i])) {
        return { ok: false, reason: `"${l.verse}" 逐字释义的字序与原文不一致` }
      }
      if (l.chars.some((ch) => !ch.m)) return { ok: false, reason: `"${l.verse}" 有字缺少释义` }
    }
    return { ok: true, reason: "" }
  }

  try {
    const out = await generateWithGuard(attempt, verify, 3)
    try { cacheAll[hash] = out; writeJson(CACHE_PATH, cacheAll) } catch { /* 缓存失败忽略 */ }
    return c.json(out)
  } catch (e) {
    // 兜底：LLM 慢/不可用时不阻塞练习 —— 直接按标点把原诗切句返回（讲解留空，仍可朗读+测评）
    try {
      const segs = poem.match(/[^，。！？；：\n]+[，。！？；：]?/g) ?? []
      const lines = segs.map((s) => s.trim()).filter(Boolean)
      if (lines.length) {
        return c.json({
          title: "古诗练习",
          summary: "（AI 讲解暂时没准备好，我们先练朗读，正文和意思稍后补上。）",
          lines: lines.map((v) => ({ verse: v, meaning: "", chars: [] })),
          fallback: true,
        })
      }
    } catch { /* 继续走错误返回 */ }
    try {
      const errMsg = String((e as Error).message ?? e)
      const rejects = (readJson<Record<string, unknown>>(REJECTS_PATH, {}) ?? {}) as Record<string, unknown>
      rejects[hash] = { kind: "zh_poem", poem, error: errMsg, at: new Date().toISOString() }
      const entries = Object.entries(rejects)
      if (entries.length > MAX_REJECT_RECORDS) {
        writeJson(REJECTS_PATH, Object.fromEntries(entries.slice(entries.length - MAX_REJECT_RECORDS)))
      } else {
        writeJson(REJECTS_PATH, rejects)
      }
    } catch { /* 忽略 */ }
    return c.json({ detail: `古诗内容生成未通过审核：${(e as Error).message}` }, 422)
  }
})

// ── 词语结构规律（结构高亮 + AI 一句话讲解；二字/四字词） ──
/** 解析并校验 LLM 返回的 structure JSON；不合法返回 null（由调用方降级，不阻塞） */
function parseStructure(raw: unknown, word: string): WordStructure | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const pattern = String(r.pattern ?? "").trim()
  const summary = String(r.summary ?? "").trim()
  const chars = [...word]
  const rolesRaw = Array.isArray(r.roles) ? r.roles : []
  const roles = rolesRaw
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>
      return { char: String(o.char ?? "").trim(), role: String(o.role ?? "").trim() }
    })
    .filter((x) => x.role)
  // 规则校验：结构名非空且 ≤12 字；roles 数量必须与字数完全一致（前端按位置取色，顺序即字序）；
  // summary 4~60 字（一句话讲解）。
  if (!pattern || pattern.length > 12) return null
  if (roles.length !== chars.length) return null
  if (summary.length < 4 || summary.length > 60) return null
  return { pattern, roles, summary }
}

/** 调 LLM 分析词语结构：pattern + 逐字 roles + 一句话 summary（generateWithGuard 规则审核重试） */
async function analyzeStructure(word: string): Promise<WordStructure | null> {
  const attempt = async (feedback: string): Promise<WordStructure | null> => {
    const example = word.length <= 2
      ? `{"pattern":"偏正","roles":[{"char":"红","role":"形容词"},{"char":"花","role":"名词"}],"summary":"“红”修饰“花”，像“白云”一样。"}`
      : `{"pattern":"动宾+动宾","roles":[{"char":"摇","role":"动词"},{"char":"头","role":"名词·身体部位"},{"char":"晃","role":"动词"},{"char":"脑","role":"名词·身体部位"}],"summary":"“摇”和“晃”都是动作，后面跟着身体部位，像“点头哈腰”一样。"}`
    let prompt =
      `分析词语"${word}"的结构规律，让小学生一看就懂。只输出一个JSON对象，不要输出任何其他文字。格式如下：\n${example}\n说明：\n` +
      `- pattern：结构名称。二字词如 近义并列/反义并列/动宾/偏正/主谓/叠词；四字词如 动宾+动宾/ABAC式/AABC式/ABCC式/AABB式/近义并列/含身体部位 等。\n` +
      `- roles：按字顺序逐字给出该字在词中的作用，个数必须与词语字数完全一致。角色可用 动词/名词/形容词/副词/数词/量词/重叠 等，可带·说明。\n` +
      `- summary：用一句不超过45字的话向小学生解释这个词语的结构规律，可举一个同类词语的例子。`
    if (feedback) prompt += `\n上次结果不符合要求：${feedback}。请修正后重新生成。`
    const reply = await chat("你是一个只输出JSON的小学语文教学助手。", prompt, 1000, "word_structure")
    const parsed = extractJson(reply)
    return parseStructure(parsed, word)
  }
  const verify = async (s: WordStructure | null): Promise<{ ok: boolean; reason: string }> => {
    if (!s) return { ok: false, reason: "返回为空或格式不符" }
    return { ok: true, reason: "" }
  }
  try {
    return await generateWithGuard(attempt, verify, 2) // 1 次生成 + 最多 1 次重试（速度优先）
  } catch {
    return null // 重试后仍不过 → 返回 null，前端不展示结构（不阻塞例句）
  }
}

// POST /api/v1/llm/word-structure — 词语结构规律（结构高亮 + AI 一句话讲解）。
// body: { word } —— 仅支持二字或四字词；命中独立缓存秒回，冷缓存调 LLM。
router.post("/word-structure", async (c) => {
  const body = await c.req.json().catch(() => null)
  const word = String(body?.word ?? "").trim()
  const chars = [...word]
  if (!word) return c.json({ detail: "缺少 word" }, 400)
  if (chars.length < 2 || chars.length > 4) return c.json({ detail: "仅支持二字或四字词语" }, 422)

  let cacheAll: Record<string, WordStructure> = {}
  try { cacheAll = (readJson<Record<string, WordStructure>>(STRUCTURE_CACHE_PATH, {}) ?? {}) as Record<string, WordStructure> } catch { cacheAll = {} }
  if (cacheAll[word]?.pattern) {
    return c.json({ word, structure: cacheAll[word], source: "cache" })
  }

  try {
    const structure = await analyzeStructure(word)
    if (structure) {
      cacheAll[word] = structure
      try { writeJson(STRUCTURE_CACHE_PATH, cacheAll) } catch { /* 缓存失败忽略 */ }
      return c.json({ word, structure, source: "llm" })
    }
    return c.json({ word, structure: null, source: "none" })
  } catch (e) {
    return c.json({ detail: `结构分析失败：${(e as Error).message}` }, 500)
  }
})

// ── 文章背诵（AI 对话学语文·文章练习）──

/** 文章背诵提示缓存（按句子列表 hash） */
const RECITE_CACHE_PATH = dataPath("article_recite.json")

/** 归一化：去掉标点/空白，用于把 LLM 回显的句子与前端切句对齐 */
function normRecite(s: string): string {
  return s.replace(/[^\u4e00-\u9fff0-9a-zA-Z]/g, "")
}

// POST /api/v1/llm/article-recite — 文章背诵：为每一句生成 ≤12 字的「简洁缩写」（背诵框架提示）。
router.post("/article-recite", async (c) => {
  const body = await c.req.json().catch(() => null)
  const raw = Array.isArray(body?.sentences) ? (body.sentences as unknown[]) : []
  const sentences = raw.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 120)
  if (!sentences.length) return c.json({ detail: "请提供要练的句子" }, 400)

  const hash = createHash("sha256").update(`articleRecite|v1|${sentences.join("\u0001")}`).digest("hex")
  let cacheAll: Record<string, unknown> = {}
  try { cacheAll = (readJson<Record<string, unknown>>(RECITE_CACHE_PATH, {}) ?? {}) as Record<string, unknown> } catch { cacheAll = {} }
  if (cacheAll[hash]) return c.json(cacheAll[hash])

  const prompt =
    `给 7-12 岁孩子做「背诵提示」。下面是一篇文章按句切好的句子（JSON 数组，顺序即文章顺序）。\n` +
    `请为**每一句**生成一条极简提示，帮孩子记住这句话的框架和要点顺序。\n` +
    `要求：\n` +
    `- 每条 ≤12 个字，只保留这句话的关键词/顺序线索（可用「·」或「→」连接），不翻译、不解释、不加多余文字；\n` +
    `- 条数与句子数完全一致，且与输入顺序一一对应（第 i 条对应第 i 句）；\n` +
    `- 句子很短（一两个字）时，提示可与原句相同。\n` +
    `句子：${JSON.stringify(sentences)}\n` +
    `只输出 JSON：{"items":[{"text":"第1句原文","short":"第1句提示"}]}`

  try {
    const maxTokens = Math.min(2400, 200 + sentences.length * 48)
    const reply = await chat("你只输出 JSON。", prompt, maxTokens, "article_recite", true)
    const j = extractJson(reply)
    const arr: unknown[] = Array.isArray(j?.items) ? (j!.items as unknown[]) : []
    const byText = new Map<string, string>()
    for (const x of arr) {
      const o = (x ?? {}) as Record<string, unknown>
      const t = normRecite(String(o?.text ?? ""))
      const s = String(o?.short ?? "").trim()
      if (t && s && !byText.has(t)) byText.set(t, s)
    }
    const items = sentences.map((text, i) => {
      const o = (arr[i] ?? {}) as Record<string, unknown>
      const short = (byText.get(normRecite(text)) || String(o?.short ?? "")).trim().slice(0, 20)
      return { text, short }
    })
    const out = { items }
    try { writeJson(RECITE_CACHE_PATH, { ...cacheAll, [hash]: out }) } catch { /* 缓存失败忽略 */ }
    return c.json(out)
  } catch {
    return c.json({ items: sentences.map((text) => ({ text, short: "" })), fallback: true })
  }
})

export default router
