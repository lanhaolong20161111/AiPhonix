/** 看图识词句子客户端 — 从静态资源加载豆包生成的词语句子
 *
 * 数据由 server_py/scripts/gen_char_sentences.py 用免费 ARK（doubao-seed-2-1-turbo-260628）批量生成：
 * {"词语": "句子"}
 * 前端按词语查询，点击 TTS 发音 / 评测。
 */

type CharSentencesFile = Record<string, string>

let sentencesPromise: Promise<CharSentencesFile> | null = null

function loadSentences(): Promise<CharSentencesFile> {
  if (sentencesPromise) return sentencesPromise
  sentencesPromise = fetch("/web/char_sentences.json").then((r) => {
    if (!r.ok) throw new Error(`词句加载失败 HTTP ${r.status}`)
    return r.json() as Promise<CharSentencesFile>
  })
  return sentencesPromise
}

/** 查询某个词语的句子（词不在库中返回空串） */
export async function getCharSentence(word: string): Promise<string> {
  const data = await loadSentences()
  return data[word] ?? ""
}

/** 一次性取回全部词句映射（词卡页批量展示用） */
export async function getAllCharSentences(): Promise<CharSentencesFile> {
  return loadSentences()
}

/** 看图识词【英文单词】句子客户端 — 豆包（doubao-seed-2-1-turbo-260628）批量生成：{"word": "English sentence"} */

type EnglishWordSentencesFile = Record<string, string>

let enSentencesPromise: Promise<EnglishWordSentencesFile> | null = null

function loadEnglishWordSentences(): Promise<EnglishWordSentencesFile> {
  if (enSentencesPromise) return enSentencesPromise
  enSentencesPromise = fetch("/web/english_word_sentences.json").then((r) => {
    if (!r.ok) throw new Error(`英文词句加载失败 HTTP ${r.status}`)
    return r.json() as Promise<EnglishWordSentencesFile>
  })
  return enSentencesPromise
}

/** 查询某个英文单词的句子（单词不在库中返回空串） */
export async function getEnglishWordSentence(word: string): Promise<string> {
  const data = await loadEnglishWordSentences()
  return data[word] ?? ""
}

/** 一次性取回全部英文单词→句子映射（英词卡页批量展示用） */
export async function getAllEnglishWordSentences(): Promise<EnglishWordSentencesFile> {
  return loadEnglishWordSentences()
}
