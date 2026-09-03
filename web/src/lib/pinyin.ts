/** 拼音解析工具 — 复刻 Android PinyinPart.kt 逻辑 */

import { SHENGMU_MNEMONIC, YUNMU_MNEMONIC, ZHENGTI_MNEMONIC } from "../data/pinyinMnemonic"

export interface PinyinParts {
  initial: string
  medial: string
  final: string
  tone: number
  isOverall: boolean
}

/** 带声调符号的字符 → (字母, 声调号)。ü 系列写作 v。 */
const TONE_CHAR_MAP: Record<string, [string, number]> = {
  "ā": ["a", 1], "á": ["a", 2], "ǎ": ["a", 3], "à": ["a", 4],
  "ō": ["o", 1], "ó": ["o", 2], "ǒ": ["o", 3], "ò": ["o", 4],
  "ē": ["e", 1], "é": ["e", 2], "ě": ["e", 3], "è": ["e", 4],
  "ī": ["i", 1], "í": ["i", 2], "ǐ": ["i", 3], "ì": ["i", 4],
  "ū": ["u", 1], "ú": ["u", 2], "ǔ": ["u", 3], "ù": ["u", 4],
  "ǖ": ["v", 1], "ǘ": ["v", 2], "ǚ": ["v", 3], "ǜ": ["v", 4],
  "ü": ["v", 0],
}

/** 把带声调符号的拼音归一化为数字声调格式："xī guā" → "xi1 gua1"；"ü" 写作 "v" */
export function normalizePinyin(input: string): string {
  let out = ""
  let tone = 0
  for (const c of input.trim().toLowerCase()) {
    const mapped = TONE_CHAR_MAP[c]
    if (mapped) {
      out += mapped[0]
      tone = mapped[1]
    } else if (c === " ") {
      if (tone !== 0) {
        out += tone
        tone = 0
      }
      out += c
    } else {
      out += c
    }
  }
  if (tone !== 0) out += tone
  return out
}

const INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
  "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"]

const WHOLE = new Set(["zhi", "chi", "shi", "ri", "zi", "ci", "si",
  "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"])

const I_MEDIAL = ["iong", "iang", "iao", "ia"]
const U_MEDIAL = ["uang", "uai", "uo", "ua"]
const V_MEDIAL = ["van", "vong"]
// 这些韵母整体看待（不拆介母）：ian/nian, uan/luan, van(j/q/x + üan 读"渊")
const SPECIAL_FINALS = new Set(["ian", "uan", "van"])

function splitMedial(rest: string): [string, string] {
  if (!rest) return ["", ""]
  if (SPECIAL_FINALS.has(rest)) return ["", rest]

  switch (rest[0]) {
    case "i":
      for (const p of [...I_MEDIAL].sort((a, b) => b.length - a.length)) {
        if (rest.startsWith(p)) return ["i", rest.slice(1)]
      }
      break
    case "u":
      for (const p of [...U_MEDIAL].sort((a, b) => b.length - a.length)) {
        if (rest.startsWith(p)) return ["u", rest.slice(1)]
      }
      break
    case "v":
      for (const p of [...V_MEDIAL].sort((a, b) => b.length - a.length)) {
        if (rest.startsWith(p)) return ["v", rest.slice(1)]
      }
      break
  }
  return ["", rest]
}

/** 解析拼音为 声母/介母/韵母/声调 部件 */
export function parsePinyin(pinyin: string): PinyinParts {
  const s = normalizePinyin(pinyin).trim().toLowerCase()
  if (!s) return { initial: "", medial: "", final: "", tone: 0, isOverall: false }

  const last = s[s.length - 1]
  const tone = last >= "1" && last <= "5" ? Number(last) : 0
  const body = tone >= 1 && tone <= 5 ? s.slice(0, -1) : s

  if (WHOLE.has(body)) return { initial: "", medial: "", final: body, tone, isOverall: true }

  for (const init of INITIALS) {
    if (body.startsWith(init)) {
      let rest = body.slice(init.length)
      if (!rest) return { initial: init, medial: "", final: "", tone, isOverall: false }

      const normalized =
        "jqx".includes(init) && rest === "uan" ? "van"  // j/q/x + üan：韵母读"渊"，不再是"弯"
        : "jqx".includes(init) && rest.startsWith("u") ? "v" + rest.slice(1)
        : rest
      const [medial, fin] = splitMedial(normalized)
      return { initial: init, medial, final: fin, tone, isOverall: false }
    }
  }

  const [medial, fin] = splitMedial(body)
  return { initial: "", medial, final: fin, tone, isOverall: false }
}

/** 校验用户输入的拼音是否与标准拼音一致（认字拼音填空） */
export function isPinyinCorrect(input: string, stored: string): boolean {
  const correct = parsePinyin(stored)
  const inp = input.trim().toLowerCase()
  if (correct.isOverall) {
    // 整体认读音节：只要韵母部分匹配 + 声调一致
    const parsedInput = parsePinyin(inp)
    return parsedInput.final === correct.final && parsedInput.tone === correct.tone
  }
  const parsedInput = parsePinyin(inp)
  const initOk = correct.initial === "" ? true : parsedInput.initial === correct.initial
  const medialOk = correct.medial === "" ? true : parsedInput.medial === correct.medial
  const finalOk = parsedInput.final === correct.final
  return initOk && medialOk && finalOk && parsedInput.tone !== 0 && parsedInput.tone === correct.tone
}

// ── 拼音部件（声母/韵母）点击发音 ──

const _SIMPLE_FINALS = ["a", "o", "e", "i", "u", "v"]
const _COMPOUND_FINALS = ["ai", "ei", "ui", "ao", "ou", "iu", "ie", "ve", "er"]
const _NASAL_FINALS = ["an", "en", "in", "un", "vn", "ang", "eng", "ing", "ong"]

/** 韵母 → 声调音频子目录（文件名用 v 表示 ü） */
export function finalToneDir(finalV: string): string {
  if (_SIMPLE_FINALS.includes(finalV)) return "单韵母声调"
  if (_COMPOUND_FINALS.includes(finalV)) return "复韵母声调"
  if (_NASAL_FINALS.includes(finalV)) return "鼻韵母声调"
  return "特殊韵母声调"
}

const _TONE_MARKS: Record<string, string[]> = {
  a: ["ā", "á", "ǎ", "à"],
  o: ["ō", "ó", "ǒ", "ò"],
  e: ["ē", "é", "ě", "è"],
  i: ["ī", "í", "ǐ", "ì"],
  u: ["ū", "ú", "ǔ", "ù"],
  v: ["ǖ", "ǘ", "ǚ", "ǜ"],
}

/** 给拼音串（无调，v=ü）按规则标上调号："ao"+1 → "āo"，"ui"+3 → "uǐ" */
export function applyToneStr(fin: string, tone: number): string {
  if (!tone) return fin
  let idx = -1
  for (const ch of ["a", "o", "e"]) {
    idx = fin.indexOf(ch)
    if (idx >= 0) break
  }
  if (idx < 0) {
    for (let k = fin.length - 1; k >= 0; k--) {
      if (fin[k] === "i" || fin[k] === "u" || fin[k] === "v") {
        idx = k
        break
      }
    }
  }
  if (idx < 0) return fin
  const mark = _TONE_MARKS[fin[idx]]?.[tone - 1] ?? fin[idx]
  return fin.slice(0, idx) + mark + fin.slice(idx + 1)
}

/** 一个可点击的拼音部件 */
export interface PinyinChip {
  label: string // 显示文字（如 "m"、"āo"、"zhī"）
  audioUrl: string
  mnemonic?: string // 该部件的助记汉字（形近字速记），如 声母 b→波
}

/**
 * 把拼音拆成可点击部件（声母 / 韵母 / 整体认读音节），每个部件对应标准音频文件。
 * 支持多字拼音（空格分隔），按字分组返回：外层数组每个元素 = 一个字的部件行。
 * 如 "píng shí" → [[p][íng], [shí]]；"chūn tiān" → [[ch][ūn], [t][iān]]。
 * baseUrl 用于拼 /pinyin-audio（如 "/api/v1"）。
 */
export function pinyinChips(pinyin: string, baseUrl = "/api/v1"): PinyinChip[][] {
  const q = (file: string) => `${baseUrl}/pinyin-audio?file=${encodeURIComponent(file)}`
  // 按空格拆分多字拼音，逐字生成部件
  const syllables = normalizePinyin(pinyin).trim().split(/\s+/).filter(Boolean)
  const rows: PinyinChip[][] = []
  for (const syl of syllables) {
    const p = parsePinyin(syl)
    if (!p.final && !p.initial) continue
    const chips: PinyinChip[] = []

    // 整体认读音节：整体一个部件
    if (p.isOverall) {
      const s = p.final || p.initial || ""
      const dir = p.tone > 0 ? "整体认读声调" : "整体认读音节"
      chips.push({ label: applyToneStr(s, p.tone), audioUrl: q(`${dir}/${s}${p.tone || ""}.mp3`), mnemonic: ZHENGTI_MNEMONIC[s] })
      rows.push(chips)
      continue
    }

    if (p.initial) chips.push({ label: p.initial, audioUrl: q(`声母/${p.initial}.mp3`), mnemonic: SHENGMU_MNEMONIC[p.initial] })
    // 介母（i/u/ü）单独一个部件
    if (p.medial) {
      const mv = p.medial.replace("ü", "v")
      const label = "jqx".includes(p.initial) && mv === "v"
        ? "u"
        : p.medial.replace(/v/g, "ü")
      chips.push({ label, audioUrl: q(`韵母/${mv}.mp3`), mnemonic: YUNMU_MNEMONIC[mv] || "" })
    }
    // 韵母（韵腹+韵尾）带声调
    if (p.final) {
      const finalV = p.final.replace("ü", "v")
      const file = p.tone > 0
        ? `${finalToneDir(finalV)}/${finalV}${p.tone}.mp3`
        : `韵母/${finalV}.mp3`
      const display = "jqx".includes(p.initial) && finalV.startsWith("v")
        ? applyToneStr("u" + finalV.slice(1), p.tone)
        : applyToneStr(finalV, p.tone).replace(/v/g, "ü")
      chips.push({ label: display, audioUrl: q(file), mnemonic: YUNMU_MNEMONIC[finalV] || "" })
    }
    if (chips.length) rows.push(chips)
  }
  return rows
}


// ── 识别文本中的拼音音节切分（AI 语文识别结果点读用）──

/** 带声调符号的拼音音节序列（至少含一个声调符号，OCR 保留的注音都带调） */
const PINYIN_SEQ_RE =
  /[a-zA-Z]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ][a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]*/g

export interface PinyinTextToken {
  type: "pinyin" | "text"
  text: string
}

/** 把文本切分为 拼音音节 / 普通文本 片段（拼音音节 = 含声调符号的字母串） */
export function tokenizePinyinText(text: string): PinyinTextToken[] {
  const out: PinyinTextToken[] = []
  let last = 0
  for (const m of text.matchAll(PINYIN_SEQ_RE)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) })
    out.push({ type: "pinyin", text: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) })
  return out
}

/** 贪心切分连写的拼音串（空格被去除后的场景）：按 声母+韵母/整体认读 最长匹配切出音节 */
export function splitRunPinyin(run: string): string[] {
  // 先归一化为 声调数字 形式（如 qīng → qing1），切分才有唯一边界
  run = normalizePinyin(run)
  const out: string[] = []
  let i = 0
  while (i < run.length) {
    let matched = ""
    const maxLen = Math.min(7, run.length - i)
    for (let len = maxLen; len >= 1; len--) {
      const cand = run.slice(i, i + len)
      const p = parsePinyin(cand)
      if (p.isOverall || p.final) {
        matched = cand
        break
      }
    }
    if (matched) {
      out.push(matched)
      i += matched.length
    } else {
      out.push(run[i])
      i++
    }
  }
  return out
}

/** ASCII 拉丁字母连续段（无声调拼音，如 zh / pin / yin / guo） */
const ASCII_LETTER_RUN_RE = /[A-Za-z]+/g
/** CJK 统一汉字（含扩展） */
const HAN_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g

/**
 * 去除文本中的拼音，只保留汉字。
 * 适用于「识别带拼音的课本照片」后，仅留下正文汉字（拼音、数字、标点、空白一并去除）。
 *
 * 策略：
 * 1. 删除带声调标记的拉丁字母段（拼音的强特征）；
 * 2. 再删除残留的纯 ASCII 拉丁字母连续段（无声调拼音，如 "zh"、"yin"）；
 * 3. 最后只保留汉字字符，去掉数字、英文、标点与空白。
 *
 * @param separate 为 true 时每个汉字之间用空格隔开（适合「练字」场景，逐字点读/拆分；
 *                 false 时保持连写，保留词/句边界，适合「练词 / 练句」）。
 */
export function stripPinyin(input: string, separate = false): string {
  if (!input) return ""
  // 1) 带声调的拉丁字母（含其两侧紧邻的拉丁字母一起剔除）
  let t = input.replace(/[A-Za-z]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü][A-Za-z]*/g, "")
  // 2) 残留的无声调 ASCII 字母段（拼音）
  t = t.replace(ASCII_LETTER_RUN_RE, "")
  // 3) 只保留汉字，去掉数字/英文/标点/空白；separate 时字与字之间用空格隔开
  const han = t.match(HAN_CHAR_RE)
  return han ? (separate ? han.join(" ") : han.join("")) : ""
}

/**
 * 去除文本中的拼音，但保留中文之间的分隔符（空格、换行、顿号、逗号、分号等）。
 * 适用于「练词 / 练句」场景：OCR 通常把每个词/句放在独立行或用空格隔开，
 * stripPinyin 会把所有分隔符和中文一并打平成一个长串，导致下游 splitText 无法按词语拆分。
 * 这里只去拼音和残留拉丁字母，保留其它字符不变。
 */
export function stripPinyinKeepDelimiters(input: string): string {
  if (!input) return ""
  // 1) 带声调的拉丁字母段（拼音）
  let t = input.replace(/[A-Za-z]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü][A-Za-z]*/g, "")
  // 2) 残留的无声调 ASCII 字母段（拼音）
  t = t.replace(ASCII_LETTER_RUN_RE, "")
  return t
}
