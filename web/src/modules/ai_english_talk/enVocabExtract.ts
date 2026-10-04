/** 英语识图取词 —— 从 OCR 文本里抽出「所有单词」和「所有句子」（纯函数，便于单测）。
 *
 *  用途：AI 英语对话页「📷 拍照识词」。拍课本/单词表 → 整页识别 → 这里抽出词句 →
 *  回填「练习单词 / 练习句子」→ 交给 /llm/en-dialogue-setup 编多轮对话。
 *
 *  为什么不把这步交给大模型：① 识别结果本来就是文字，抽词是确定性规则，没必要再等一次 LLM；
 *  ② 断网/额度耗尽也能用；③ 规则可单测。代价是虚词过滤靠词表，所以弹层里给了
 *  「包含虚词（a/the/is…）」开关兜底，实测不对时可以一键还原全部词。
 */

/** 高频虚词（冠词/代词/系动词/助动词/介词/连词）—— 不是值得练的目标词，默认剔除。
 *  ⚠️ 刻意保守：do/have/look/go/play 等小学课标词汇**不要**放进来（它们常常就是本课要练的词）。
 *  宁可漏删也不要错删；用户勾「包含虚词」即可全部保留。 */
const STOP_WORDS = new Set<string>([
  // 冠词 / 限定词
  "a", "an", "the", "this", "that", "these", "those", "some", "any", "all", "both", "each", "every",
  // 代词
  "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her", "hers",
  "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs",
  // 系动词 / 助动词
  "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did",
  // 情态动词
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  // 介词
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "about", "over",
  "under", "up", "down", "out", "off", "as", "than", "during", "between", "near",
  // 连词 / 副词
  "and", "or", "but", "if", "so", "because", "then", "not", "there", "here",
  "very", "too", "also", "just", "only", "again", "still", "well",
  // 疑问词
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
])

/** 句末标点（中英混排一起认）：英语教材照片常出现「英文 + 中文注释」同行 */
const SENT_END = new Set([".", "!", "?", "。", "！", "？", "…"])

/** 明显是版面结构/指令而非句子的行首（Unit 3 / Lesson 2 / Page 5 / "Read and write."…）。
 *  ⚠️ 只匹配「词组」不匹配单词：`read` 单独出现不算（"Read a book." 可能就是要练的句子），
 *  但 `read and` 这种教材指令必是噪声。 */
const STRUCT_START =
  /^(unit|module|lesson|chapter|part|section|page|exercise|grade|book|test|activity|review)\b|^(read|listen|say|look|write|circle|tick|match|fill)\s+(and|the following)\b|^let'?s\b/i

/** 默认上限：一页课本抽出的量。超了截断并在弹层里提示，避免把整本书的内容塞进 dialogue 提示词。 */
export const MAX_WORDS = 80
export const MAX_SENTENCES = 24

export interface EnVocab {
  /** 去重后的内容词（顺序 = 首次出现顺序；词形见 extractWords 的词形归一规则） */
  words: string[]
  /** 去重后的句子（已去中文注释/排版符号） */
  sentences: string[]
  /** 单词数超上限被截断 */
  wordsTruncated: boolean
  /** 句子数超上限被截断 */
  sentencesTruncated: boolean
}

export interface ExtractVocabOptions {
  /** true = 保留 a/the/is 等虚词（默认 false 剔除） */
  keepStop?: boolean
  maxWords?: number
  maxSentences?: number
}

/** OCR 原文归一化：换行统一、全角→半角、弯引号→直引号、连字→普通字母、去控制字符。
 *  识别结果里 `（  ）` `，` `？` 这类全角标点会破坏英文断句，必须先转掉。 */
export function normalizeOcrText(raw: string): string {
  let t = raw ?? ""
  t = t.replace(/\r\n?/g, "\n")
  t = t.replace(/[ \t\u00a0\u2000-\u200b\u3000]/g, " ")
  t = t.replace(/[\u2018\u2019\u201b\u2032]/g, "'")
  t = t.replace(/[\u201c\u201d\u2033]/g, '"')
  t = t.replace(/\ufb01/g, "fi").replace(/\ufb02/g, "fl")
  // 全角字母/数字/标点（！-～ 段）→ 半角；中文标点「。、」不在该段，留给 cleanSentence 处理
  t = t.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
  return t
}

/** 按句末标点 + 换行切候选句（**只切不洗**，清洗交给 cleanSentence） */
function splitRawSentences(text: string): string[] {
  const out: string[] = []
  let buf = ""
  const flush = () => {
    const t = buf
    buf = ""
    if (t.trim()) out.push(t)
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "\n") {
      flush()
      continue
    }
    buf += ch
    if (!SENT_END.has(ch)) continue
    const prev = text[i - 1] ?? ""
    const next = text[i + 1] ?? ""
    // 小数点（3.5）不切
    if (ch === "." && /\d/.test(prev) && /\d/.test(next)) continue
    // 缩写（Mr. / U.S. / e.g.）：点号后面紧跟字母 → 不切
    if (ch === "." && /[A-Za-z]/.test(next)) continue
    flush()
  }
  flush()
  return out
}

/** 洗一个候选句：去中文注释/排版符号/行首序号；不像句子就返回 ""
 *
 *  判定「像不像句子」的门槛刻意分开两档：
 *  - 有句末标点：≥2 个词、≥4 个字母即可（"It is." 也算）；
 *  - 没有句末标点：≥4 个词（否则 "apple banana orange" 这种单词表会被当成句子）。
 */
export function cleanSentence(raw: string): string {
  let s = raw
  s = s.replace(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/g, " ") // 汉字 + 中日韩标点
  s = s.replace(/[^\x20-\x7e]/g, " ") // 其余非 ASCII（° · © £ 等）
  s = s.replace(/[*_#>|~^`{}=+\\/[\]]/g, " ") // 排版符号（保留 , . ' - ! ? ; : ( ) ）
  s = s.replace(/^[\s\d]+[.)、]\s*/, "") // 行首序号 1. / 2)
  s = s.replace(/\s+/g, " ").trim()
  s = s.replace(/\s+([.!?,;:])/g, "$1") // "Hello ." → "Hello."
  s = s.replace(/^[\s'",;:.!?-]+/, "")
  s = s.replace(/[\s'",;:-]+$/, "") // 末尾只去杂符（保留 . ! ?）
  if (!s) return ""
  if (STRUCT_START.test(s)) return "" // Unit 3 / Lesson 2 之类版面标题
  const tokens = s.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  if (tokens.length < 2) return ""
  const letters = (s.match(/[A-Za-z]/g) ?? []).length
  if (letters < 4) return ""
  const hasEnd = /[.!?]$/.test(s)
  if (!hasEnd && tokens.length < 4) return ""
  return s
}

/** 该位置是否为「句首/行首」：前一非空格字符是换行或句末标点。
 *  用途：句首的 This/Look/Read 不算专有名词（见 extractWords 词形归一）。 */
function isInitialPos(text: string, idx: number): boolean {
  let i = idx - 1
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--
  if (i < 0) return true
  const p = text[i]
  return p === "\n" || /[.!?。！？]/.test(p)
}

/** 抽词前先整行剔除「版面/指令行」：否则 "Unit 3 My Family" 会贡献 unit、"Read and write." 会贡献 write。
 *  与句子过滤的区别：这里是**按行**判（行首命中即整行丢掉），因为同一行里可能还夹着正常句子；
 *  句子过滤走 cleanSentence（在切好的候选句上判）。 */
function stripStructLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = normalizeOcrText(line).replace(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/g, " ").replace(/\s+/g, " ").trim()
      return !t || !STRUCT_START.test(t)
    })
    .join("\n")
}

/** 抽单词（去重、归一大小写、剔虚词/噪声）。
 *
 *  词形归一规则（顺序执行）：
 *  1. 同一个小写键只要在原文里出现过小写形态 → 用小写（句首的 "My/Father" 落成 my/father）；
 *  2. 否则若该大写形态**从未出现在非句首位置**（只做过句首 "Look/Read/New"）→ 也用小写；
 *  3. 否则保留出现最多的原形（"Tom/China" 这类真专有名词——它们至少有一次出现在句中）。
 *
 *  单字母词（a / I）不进词表：作练习词没有意义，且 keepStop 打开时也不该冒出来。
 */
export function extractWords(text: string, keepStop = false): string[] {
  /** lower → (surface → count) */
  const forms = new Map<string, Map<string, number>>()
  /** 曾以大写形态出现在「非句首」位置的词（小写键）——只有这类才可能是专有名词 */
  const capNonInitial = new Set<string>()
  const re = /[A-Za-z][A-Za-z'-]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const w = m[0].replace(/^[-']+/, "").replace(/[-']+$/, "")
    if (w.length < 2) continue
    const lower = w.toLowerCase()
    if (!keepStop && STOP_WORDS.has(lower)) continue
    // TV/mm/qq 之类噪声：≤3 字母且无元音
    if (w.length <= 3 && !/[aeiouy]/.test(lower)) continue
    if (w !== lower && !isInitialPos(text, m.index)) capNonInitial.add(lower)
    const bucket = forms.get(lower) ?? new Map<string, number>()
    bucket.set(w, (bucket.get(w) ?? 0) + 1)
    forms.set(lower, bucket)
  }
  const out: string[] = []
  for (const [lower, bucket] of forms) {
    if (bucket.has(lower) || !capNonInitial.has(lower)) {
      out.push(lower)
      continue
    }
    let pick = lower
    let best = -1
    for (const [form, n] of bucket) {
      if (n > best) {
        pick = form
        best = n
      }
    }
    out.push(pick)
  }
  return out
}

/** 主入口：OCR 文本 → { words, sentences } */
export function extractEnglishVocab(raw: string, opts: ExtractVocabOptions = {}): EnVocab {
  const { keepStop = false, maxWords = MAX_WORDS, maxSentences = MAX_SENTENCES } = opts
  const text = normalizeOcrText(raw)

  const seen = new Set<string>()
  const sentences: string[] = []
  for (const cand of splitRawSentences(text)) {
    const s = cleanSentence(cand)
    if (!s) continue
    const key = s.toLowerCase().replace(/[^a-z0-9']/g, "")
    if (!key || seen.has(key)) continue
    seen.add(key)
    sentences.push(s)
  }

  // 单词从**去掉版面前缀行后的全文**抽（含没被当成句子的行，如 "apple banana orange" 这类单词表）
  const wordSource = stripStructLines(text)
  let words = extractWords(wordSource, keepStop)
  // 兜底：整页全是虚词（理论上不会）→ 退回不过滤，至少给 AI 一点练习内容
  if (words.length === 0 && !keepStop) words = extractWords(wordSource, true)

  return {
    words: words.slice(0, maxWords),
    sentences: sentences.slice(0, maxSentences),
    wordsTruncated: words.length > maxWords,
    sentencesTruncated: sentences.length > maxSentences,
  }
}
