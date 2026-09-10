/** 预生成 TTS 音频缓存：命中后不再调用实时百度 TTS。
 *  2026-09-10：英文单词/句子预生成库（火山 Tim 旧音频）已删除，英文改由百度 4193 实时合成并沉淀到
 *  R2（cache/tts）。下方英文索引读取逻辑保留，便于将来重新灌入统一音色的音频库。 */
import { getEnv } from "../env.js"
import { readBlob } from "./storage.js"

const CHAR_DIR = "data/tts_char"
const EN_DIR = "data/tts_english"
const ASSET_ROOT = "/tts-cache"
const EN_INDEX = `${ASSET_ROOT}/english/index.json`
const POEM_INDEX = `${ASSET_ROOT}/poem/index.json`

type PoemIndex = {
  /** 诗句原文（含标点）→ 文件名 */
  lines?: Record<string, string>
}

let poemIndexPromise: Promise<PoemIndex | null> | null = null

function loadPoemIndex(): Promise<PoemIndex | null> {
  poemIndexPromise ??= readAssetJson<PoemIndex>(POEM_INDEX)
  return poemIndexPromise
}

/** 古诗原文（度逍遥 per=3 预生成）查找：仅在请求音色为古诗音色时调用 */
export async function lookupPoemTts(text: string): Promise<CachedTts | null> {
  const normalized = text.trim()
  if (!normalized) return null
  const idx = await loadPoemIndex()
  const file = idx?.lines?.[normalized]
  if (!file) return null
  const assetPath = `${ASSET_ROOT}/poem/${file}`
  const assetData = await readAsset(assetPath)
  if (assetData) return { data: assetData, source: "pre-generated" }
  const data = await readBlob(`${poemKeyDir()}/${file}`)
  return data ? { data, source: "pre-generated" } : null
}

function poemKeyDir(): string {
  return "data/tts_poem"
}

type EnglishIndex = {
  words?: Record<string, string>
  sentences?: Record<string, string>
}

let englishIndexPromise: Promise<EnglishIndex | null> | null = null

async function readAsset(path: string): Promise<ArrayBuffer | null> {
  const res = await getEnv().ASSETS.fetch(new Request(`https://tts-cache.internal${path}`))
  if (!res.ok) return null
  return res.arrayBuffer()
}

async function readAssetJson<T>(path: string): Promise<T | null> {
  const data = await readAsset(path)
  if (!data) return null
  try {
    return JSON.parse(new TextDecoder().decode(data)) as T
  } catch {
    return null
  }
}

function loadEnglishIndex(): Promise<EnglishIndex | null> {
  englishIndexPromise ??= readAssetJson<EnglishIndex>(EN_INDEX)
  return englishIndexPromise
}

export type CachedTts = {
  data: ArrayBuffer
  source: "pre-generated"
}

function isSingleHanzi(text: string): boolean {
  return /^[\u4e00-\u9fff]$/.test(text)
}

function isEnglishWord(text: string): boolean {
  return /^[A-Za-z]+(?:['’\u2019-][A-Za-z]+)*$/.test(text)
}

function englishKey(text: string, index: EnglishIndex | null): string | null {
  const normalized = text.trim()
  const kind = isEnglishWord(normalized) ? "words" : "sentences"
  const map = kind === "words" ? index?.words : index?.sentences
  const key = map?.[isEnglishWord(normalized) ? normalized.toLowerCase() : normalized]
  if (!key) return null
  return `${EN_DIR}/${key}`
}

/**
 * 查找与请求文本完全匹配的预生成音频。
 * - 单汉字 -> data/tts_char/{字}.mp3
 * - 英文单词 -> data/tts_english/words/{小写编码}.mp3
 * - 其它英文文本（通常是例句）-> data/tts_english/sentences/{编码}.mp3
 * 未命中返回 null，由调用方继续走原实时 TTS。
 */
export async function lookupPreGenerated(text: string): Promise<CachedTts | null> {
  const normalized = text.trim()
  if (!normalized) return null

  let key: string
  if (isSingleHanzi(normalized)) key = `${CHAR_DIR}/${normalized}.mp3`
  else if (/^[A-Za-z]/.test(normalized) && !/[\u4e00-\u9fff]/.test(normalized)) {
    const englishKeyValue = englishKey(normalized, await loadEnglishIndex())
    if (!englishKeyValue) return null
    key = englishKeyValue
  } else return null

  // 预生成包随 Worker Assets 原子部署，优先读取；R2 是回退，便于旧部署/分批上传期间不中断。
  const assetPath = normalized.length === 1 && isSingleHanzi(normalized)
    ? `${ASSET_ROOT}/${key}`
    : `${ASSET_ROOT}/${key.replace(/^data\/tts_english\//, "english/")}`
  const assetData = await readAsset(assetPath)
  if (assetData) return { data: assetData, source: "pre-generated" }

  const data = await readBlob(key)
  return data ? { data, source: "pre-generated" } : null
}
