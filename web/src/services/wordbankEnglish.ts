/** 英语数据客户端 — 加载静态资源 wordbank.json（字母/词/音素）+ english_vocabulary.json */

export interface Letter {
  char: string
  ipaName: string
  uppercase: string
  lowercase: string
  order: number
  pronunciations: string[]
}

export type PhonemeCategory =
  | "SHORT_VOWEL" | "LONG_VOWEL" | "DIPHTHONG" | "CONSONANT" | "FRICATIVE" | "NASAL" | "PLOSIVE"

export interface Phoneme {
  symbol: string
  category: PhonemeCategory
  description: string
  tonguePosition: string
  lipShape: string
  commonMistakes: string[]
  exampleWords: string[]
  englishWordIds: string[]
  mnemonic: string
}

export interface Word {
  text: string
  ipa: string
  letter: string
  phonemes: string[]
  emoji: string
  difficulty: number
  ipa_uk: string
  phonemes_uk: string[]
}

export interface EnglishWordEntry {
  word: string
  phonetic: string
  meanings: string[]
  emoji: string
  phonemes: string[]
  ipa_uk: string
  phonemes_uk: string[]
}

interface WordbankFile {
  letters: Letter[]
  words: Word[]
  phonemes: Phoneme[]
}

interface EnglishVocabulary {
  words: EnglishWordEntry[]
}

let bankPromise: Promise<WordbankFile> | null = null
let vocabPromise: Promise<EnglishVocabulary> | null = null

function loadBank(): Promise<WordbankFile> {
  if (bankPromise) return bankPromise
  bankPromise = fetch("/web/wordbank.json").then((r) => {
    if (!r.ok) throw new Error(`词库加载失败 HTTP ${r.status}`)
    return r.json() as Promise<WordbankFile>
  })
  return bankPromise
}

function loadVocab(): Promise<EnglishVocabulary> {
  if (vocabPromise) return vocabPromise
  vocabPromise = fetch("/web/english_vocabulary.json").then((r) => {
    if (!r.ok) throw new Error(`词汇表加载失败 HTTP ${r.status}`)
    return r.json() as Promise<EnglishVocabulary>
  })
  return vocabPromise
}

export async function getAllLetters(): Promise<Letter[]> {
  return (await loadBank()).letters
}

export async function getLetter(char: string): Promise<Letter | undefined> {
  return (await loadBank()).letters.find((l) => l.char === char)
}

export async function getWordsForLetter(letter: string): Promise<Word[]> {
  return (await loadBank()).words.filter((w) => w.letter === letter)
}

export async function getWordsForPhoneme(phoneme: string): Promise<Word[]> {
  const sym = phoneme.replace(/^\/|\/$/g, "")
  return (await loadBank()).words.filter((w) => w.phonemes.includes(sym))
}

export async function getAllWords(): Promise<Word[]> {
  return (await loadBank()).words
}

export async function getAllPhonemes(): Promise<Phoneme[]> {
  return (await loadBank()).phonemes
}

export async function getPhoneme(symbol: string): Promise<Phoneme | undefined> {
  return (await loadBank()).phonemes.find((p) => p.symbol === symbol)
}

export async function getAllEnglishWords(): Promise<EnglishWordEntry[]> {
  return (await loadVocab()).words
}

/** 单词 → 中文释义 的本地词典（懒建，首次查询时同步命中、零网络等待）。
 *  数据源 english_vocabulary.json 的 meanings 是课标词义，比实时 LLM 更稳更快。 */
let meaningMap: Map<string, string> | null = null
/** 释义词典构建失败过 → 不再反复重试（词库缺失时避免每次查询都打一次网络） */
let meaningMapFailed = false

/** 同步查单词中文释义；词库未加载/查不到返回 ""（调用方再走服务端兜底）。 */
export function lookupWordZhSync(word: string): string {
  const key = word.trim().toLowerCase().replace(/[^a-z']/g, "")
  if (!key) return ""
  const m = meaningMap?.get(key)
  if (m) return m
  if (meaningMap || meaningMapFailed) return "" // 词典已就绪/已放弃 → 不必等
  // 词典还没建好：后台建好供下次命中，本次返回空（调用方异步兜底）
  void loadVocab()
    .then((v) => {
      const map = new Map<string, string>()
      for (const w of v.words) {
        const k = w.word.trim().toLowerCase()
        if (k && !map.has(k)) map.set(k, (w.meanings ?? []).filter(Boolean).join("；"))
      }
      meaningMap = map
    })
    .catch(() => {
      meaningMapFailed = true
      vocabPromise = null // 失败不缓存失败的 Promise，允许以后重试
    })
  return ""
}

export async function getEnglishWordsForLetter(letter: string): Promise<EnglishWordEntry[]> {
  const l = letter.toLowerCase()
  return (await loadVocab()).words.filter((w) => w.word.toLowerCase().startsWith(l))
}

/** 字母常见音素映射（复刻 Android letterToPrimaryPhoneme） */
export const LETTER_TO_PRIMARY_PHONEME: Record<string, string> = {
  a: "æ", b: "b", c: "k", d: "d", e: "e",
  f: "f", g: "g", h: "h", i: "ɪ", j: "dʒ",
  k: "k", l: "l", m: "m", n: "n", o: "ɒ",
  p: "p", q: "kw", r: "r", s: "s", t: "t",
  u: "ʌ", v: "v", w: "w", x: "ks", y: "j", z: "z",
}

/** 按音素找关联英语词（通过字母映射） */
export async function getEnglishWordsForPhoneme(phoneme: string): Promise<EnglishWordEntry[]> {
  const sym = phoneme.replace(/^\/|\/$/g, "")
  const matchingLetters = Object.entries(LETTER_TO_PRIMARY_PHONEME)
    .filter(([, v]) => v === sym)
    .map(([k]) => k)
  if (matchingLetters.length === 0) return []
  const words = await loadVocab()
  return words.words.filter((w) => matchingLetters.includes(w.word[0]?.toLowerCase() ?? ""))
}

/** 音素分类中文名 */
export const PHONEME_CATEGORY_NAMES: Record<PhonemeCategory, string> = {
  SHORT_VOWEL: "短元音",
  LONG_VOWEL: "长元音",
  DIPHTHONG: "双元音",
  CONSONANT: "辅音",
  FRICATIVE: "摩擦音",
  NASAL: "鼻音",
  PLOSIVE: "爆破音",
}
