/** 字词库客户端 — 从静态资源加载内置词库，并提供按标签查询
 *
 * 与 Android WordBankRepository 对应。Web 端词库为打包进 public/ 的
 * chinese_wordbank.json（复制自 app/src/main/assets）。
 */

export interface WordBankEntry {
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

interface WordBankFile {
  version: number
  chars: WordBankEntry[]
  words: WordBankEntry[]
}

let bankPromise: Promise<WordBankFile> | null = null

function loadBank(): Promise<WordBankFile> {
  if (bankPromise) return bankPromise
  bankPromise = fetch("/web/chinese_wordbank.json").then((r) => {
    if (!r.ok) throw new Error(`词库加载失败 HTTP ${r.status}`)
    return r.json() as Promise<WordBankFile>
  })
  return bankPromise
}

/** 按标签过滤汉字（对应 queryChars("识字")/("写字")） */
export async function queryChars(...requiredTags: string[]): Promise<WordBankEntry[]> {
  const bank = await loadBank()
  return bank.chars.filter((e) => requiredTags.every((t) => e.tags.includes(t)))
}

/**
 * 该字是否可用于「认字」练习。
 *
 * ⚠️ 字库把「认+写」都要求的字合成一个 **`识写`** 标签，**不会同时给 `识字`**：
 * 全库 1849 字里 1566 个 `识字`、410 个 `识写`（其中 277 个**只有** `识写` 没有 `识字`）。
 * 所以判「能不能认」必须是「识字 **或** 识写」——只判 `识字` 会把这 277 个字误判成
 * 「字库没有」，家长从每日一练导入它们时全被拦成「无法练习」（朗/晶/珠/粘/印/案/展/列/规/则/凌/乱 里就有 4 个中招）。
 */
export function isRecogChar(e: WordBankEntry): boolean {
  return e.tags.includes("识字") || e.tags.includes("识写")
}

/** 按标签过滤词语（对应 queryWords("词语")） */
export async function queryWords(...requiredTags: string[]): Promise<WordBankEntry[]> {
  const bank = await loadBank()
  return bank.words.filter((e) => requiredTags.every((t) => e.tags.includes(t)))
}

/** 从词库中找第一个包含指定字的词语 */
export async function findWordContaining(char: string): Promise<string | null> {
  const bank = await loadBank()
  const hit = bank.words.find((w) => w.text.includes(char))
  return hit?.text ?? null
}

// ── 汉字 → 数字调拼音 词典（给 AI 语文识别结果逐字注音用） ──
let charPinyinDict: Record<string, string> | null = null
let charPinyinDictPromise: Promise<Record<string, string>> | null = null

/** 返回 汉字→数字调拼音 词典（来自 chinese_wordbank.json 的 chars，覆盖常见小学汉字；
 *  单字词语补全不覆盖已存在的项）。识别结果逐字注音时复用，避免重复加载词库。 */
export function getCharPinyinDict(): Promise<Record<string, string>> {
  if (charPinyinDict) return Promise.resolve(charPinyinDict)
  if (charPinyinDictPromise) return charPinyinDictPromise
  charPinyinDictPromise = loadBank().then((bank) => {
    const map: Record<string, string> = {}
    for (const e of bank.chars) {
      if (e.text && e.pinyin) map[e.text] = e.pinyin
    }
    for (const e of bank.words) {
      if (e.text && e.text.length === 1 && e.pinyin && !map[e.text]) map[e.text] = e.pinyin
    }
    charPinyinDict = map
    return map
  })
  return charPinyinDictPromise
}

/** 词库中所有年级批次（如 一年级上/下、二年级上/下、三年级上） */
export async function listGrades(): Promise<string[]> {
  const bank = await loadBank()
  const set = new Set<string>()
  for (const c of bank.chars) {
    for (const t of c.tags) {
      if (t.includes("年级")) set.add(t)
    }
  }
  for (const w of bank.words) {
    for (const t of w.tags) {
      if (t.includes("年级")) set.add(t)
    }
  }
  return [...set]
}

/** 按年级批次过滤汉字（任一匹配该年级标签） */
export async function queryCharsByGrades(grades: string[]): Promise<WordBankEntry[]> {
  if (!grades?.length) return queryCharsByTexts([]) // 空 = 全部可认字（isRecogChar）
  const bank = await loadBank()
  return bank.chars.filter((c) => isRecogChar(c) && grades.some((g) => c.tags.includes(g)))
}

/** 按年级批次过滤词语 */
export async function queryWordsByGrades(grades: string[]): Promise<WordBankEntry[]> {
  if (!grades?.length) return queryWords("词语")
  const bank = await loadBank()
  return bank.words.filter(
    (w) => w.tags.includes("词语") && grades.some((g) => w.tags.includes(g)),
  )
}

/** 按文本精确过滤识字汉字（每日一练手打列表用；空列表返回全部识字字） */
export async function queryCharsByTexts(texts: string[]): Promise<WordBankEntry[]> {
  const bank = await loadBank()
  if (!texts?.length) return bank.chars.filter(isRecogChar)
  const set = new Set(texts)
  return bank.chars.filter((c) => isRecogChar(c) && set.has(c.text))
}

/** 按文本精确过滤词语（每日一练手打列表用；空列表返回全部词语） */
export async function queryWordsByTexts(texts: string[]): Promise<WordBankEntry[]> {
  if (!texts?.length) return queryWords("词语")
  const bank = await loadBank()
  const set = new Set(texts)
  return bank.words.filter((w) => w.tags.includes("词语") && set.has(w.text))
}

/** 手打列表在词库中的命中数量（用于提示有多少能真的练到） */
export async function getCharCountByTexts(texts: string[]): Promise<number> {
  return (await queryCharsByTexts(texts)).length
}

export async function getWordCountByTexts(texts: string[]): Promise<number> {
  return (await queryWordsByTexts(texts)).length
}
