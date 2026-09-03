/** 拼音解析 — 从 Python utils/pinyin.py 移植 */

const INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"]

const WHOLE_SYLLABLES = new Set([
  "zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying",
])

const TONE_MARKS: Record<string, string[]> = {
  a: ["ā", "á", "ǎ", "à", "a"],
  o: ["ō", "ó", "ǒ", "ò", "o"],
  e: ["ē", "é", "ě", "è", "e"],
  i: ["ī", "í", "ǐ", "ì", "i"],
  u: ["ū", "ú", "ǔ", "ù", "u"],
  ü: ["ǖ", "ǘ", "ǚ", "ǜ", "ü"],
}

export interface PinyinInfo {
  original: string
  initial: string
  medial: string
  final: string
  tone: number
  display: string
  is_overall: boolean
}

const extractTone = (pinyin: string): [number, string] => {
  if (pinyin && /[12345]/.test(pinyin[pinyin.length - 1])) {
    return [Number(pinyin[pinyin.length - 1]), pinyin.slice(0, -1)]
  }
  return [0, pinyin]
}

const hasPrefix = (s: string, prefixes: string[]): boolean => prefixes.some((p) => s.startsWith(p))

const splitMedial = (rest: string): [string, string] => {
  if (!rest) return ["", ""]
  const first = rest[0]
  if (first === "i" && hasPrefix(rest, ["iong", "iang", "iao", "ian", "ia"])) return ["i", rest.slice(1)]
  if (first === "u" && hasPrefix(rest, ["uang", "uai", "uan", "uo", "ua"])) return ["u", rest.slice(1)]
  if (first === "v" && hasPrefix(rest, ["van", "vong"])) return ["v", rest.slice(1)]
  return ["", rest]
}

const splitPinyin = (body: string): [string, string, string] => {
  if (!body) return ["", "", ""]
  // 零声母 y/w
  if (!WHOLE_SYLLABLES.has(body) && body.length > 1) {
    const first = body[0]
    if (first === "y") {
      const [m, f] = splitMedial("i" + body.slice(1))
      return ["", m, f]
    }
    if (first === "w") {
      const [m, f] = splitMedial("u" + body.slice(1))
      return ["", m, f]
    }
  }
  for (const init of INITIALS) {
    if (body.startsWith(init)) {
      const rest = body.slice(init.length)
      if (!rest) return [init, "", ""]
      const [m, f] = splitMedial(rest)
      return [init, m, f]
    }
  }
  const [m, f] = splitMedial(body)
  return ["", m, f]
}

const findTonePosition = (pinyin: string): number => {
  pinyin = pinyin.replace(/ü/g, "v")
  let aPos = -1, oPos = -1, ePos = -1, iPos = -1, uPos = -1
  for (let i = 0; i < pinyin.length; i++) {
    const ch = pinyin[i]
    if (ch === "a") aPos = i
    else if (ch === "o") oPos = i
    else if (ch === "e") ePos = i
    else if (ch === "i") iPos = i
    else if (ch === "u") uPos = i
    else if (ch === "v" && uPos < 0) uPos = i
  }
  if (aPos >= 0) return aPos
  if (oPos >= 0) return oPos
  if (ePos >= 0) return ePos
  if (iPos >= 0 && uPos >= 0) return uPos > iPos ? uPos : iPos
  if (iPos >= 0) return iPos
  if (uPos >= 0) return uPos
  return -1
}

const applyToneMark = (pinyin: string, tone: number): string => {
  if (tone < 1 || tone > 5) return pinyin
  if (tone === 5) return pinyin
  const pos = findTonePosition(pinyin)
  if (pos < 0) return pinyin
  const ch = pinyin[pos]
  const vowel = ch === "v" ? "ü" : ch
  const marks = TONE_MARKS[vowel]
  if (marks && tone - 1 >= 0 && tone - 1 < marks.length) {
    return pinyin.slice(0, pos) + marks[tone - 1] + pinyin.slice(pos + 1)
  }
  return pinyin
}

// ── 拼音音节拆分（从 Python ai_chinese.py _split_syllable 移植，用于拼音关卡） ──

const SHENGMU = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"]
const JIEMU = ["i", "u", "ü"]
const ZHENGTI = ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"]
const DANYUN = new Set(["a", "e", "i", "o", "u", "v"])
const FUYUN = new Set(["ai", "ei", "ao", "ou", "ie", "iu", "er"])
const BIYUN = new Set(["an", "en", "in", "ang", "eng", "ing", "ong"])
const TEYUN = new Set(["ian", "uan"])
const TONE_NUM: Record<string, string> = {
  "ā": "1", "á": "2", "ǎ": "3", "à": "4",
  "ē": "1", "é": "2", "ě": "3", "è": "4",
  "ī": "1", "í": "2", "ǐ": "3", "ì": "4",
  "ō": "1", "ó": "2", "ǒ": "3", "ò": "4",
  "ū": "1", "ú": "2", "ǔ": "3", "ù": "4",
  "ǖ": "1", "ǘ": "2", "ǚ": "3", "ǜ": "4",
}

export interface PinyinPart {
  text: string
  label: string // shengmu / jiemu / yunmu / zhengtiren
  audio: string
}

export function stripTone(s: string): string {
  return s
    .replace(/[āáǎà]/g, "a")
    .replace(/[ēéěè]/g, "e")
    .replace(/[īíǐì]/g, "i")
    .replace(/[ōóǒò]/g, "o")
    .replace(/[ūúǔù]/g, "u")
    .replace(/[ǖǘǚǜ]/g, "v")
}

export function toneOf(s: string): number {
  for (const ch of s) {
    if (TONE_NUM[ch]) return Number(TONE_NUM[ch])
  }
  return 0
}

function yunmuAudio(yunmuText: string): string {
  const base = stripTone(yunmuText)
  const tone = toneOf(yunmuText)
  if (DANYUN.has(base)) return tone ? `单韵母声调/${base}${tone}.mp3` : `韵母/${base}.mp3`
  if (FUYUN.has(base)) return tone ? `复韵母声调/${base}${tone}.mp3` : `韵母/${base}.mp3`
  if (BIYUN.has(base)) return tone ? `鼻韵母声调/${base}${tone}.mp3` : `韵母/${base}.mp3`
  if (TEYUN.has(base)) return tone ? `特殊韵母声调/${base}${tone}.mp3` : `韵母/${base}.mp3`
  return `韵母/${base}.mp3`
}

function zhengtirenAudio(text: string): string {
  const base = stripTone(text)
  const tone = toneOf(text)
  return tone ? `整体认读声调/${base}${tone}.mp3` : `整体认读音节/${base}.mp3`
}

export function splitSyllable(syl: string): PinyinPart[] {
  if (!syl) return []
  const noTone = stripTone(syl)
  for (const z of ZHENGTI) {
    if (noTone === z) return [{ text: syl, label: "zhengtiren", audio: zhengtirenAudio(syl) }]
  }
  let shengmu = ""
  for (const sm of SHENGMU) {
    if (noTone.startsWith(sm) && sm.length > shengmu.length) shengmu = sm
  }
  const parts: PinyinPart[] = []
  const smText = shengmu ? syl.slice(0, shengmu.length) : ""
  if (smText) parts.push({ text: smText, label: "shengmu", audio: `声母/${shengmu}.mp3` })
  let restText = shengmu ? syl.slice(shengmu.length) : syl
  const restPlain = stripTone(restText)
  if (restText && restPlain.length >= 3 && JIEMU.includes(restPlain[0])) {
    const jiemu = restText[0]
    const jiemuPlain = restPlain[0] === "ü" ? "v" : restPlain[0]
    parts.push({ text: jiemu, label: "jiemu", audio: `单韵母声调/${jiemuPlain}1.mp3` })
    restText = restText.slice(1)
    if (restText) parts.push({ text: restText, label: "yunmu", audio: yunmuAudio(restText) })
  } else if (restText) {
    parts.push({ text: restText, label: "yunmu", audio: yunmuAudio(restText) })
  }
  if (!parts.length) parts.push({ text: syl, label: "zhengtiren", audio: zhengtirenAudio(syl) })
  return parts
}

export function splitPinyinWord(pinyin: string): PinyinPart[] {
  const out: PinyinPart[] = []
  for (const syl of pinyin.split(/\s+/)) {
    out.push(...splitSyllable(syl))
  }
  return out
}

export function parsePinyin(pinyinStr: string): PinyinInfo {
  pinyinStr = pinyinStr.trim().toLowerCase()
  if (!pinyinStr) throw new Error("空拼音")
  const [tone, body] = extractTone(pinyinStr)
  const isOverall = WHOLE_SYLLABLES.has(body)
  const [init, medial, fin] = splitPinyin(body)
  const display = applyToneMark(init + medial + fin, tone)
  return {
    original: pinyinStr,
    initial: init,
    medial,
    final: fin,
    tone,
    display,
    is_overall: isOverall,
  }
}
