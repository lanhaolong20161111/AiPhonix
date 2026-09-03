/**
 * 智聆 SOE 音素 → 国际音标（IPA）映射
 *
 * 依据腾讯官方文档《音素标注》（cloud.tencent.com/document/product/884/33698）的
 * 智聆音素映射表，支持英式（IPA88 UK）与美式（KK）两种记法。
 *
 * 智聆返回的元音命名与 ARPAbet 大写不同（如 ae/ah/iy/ow），本表同时兼容大写。
 */

export type PronStyle = "us" | "uk"

/** 智聆/ARPAbet 音素 → { 英式 IPA, 美式 IPA }。键统一存大写，查询时 toUpperCase */
const PHONE_TO_IPA: Record<string, { uk: string; us: string }> = {
  // ── 元音（官方表） ──
  AA: { uk: "ɑː", us: "ɑ" },
  AE: { uk: "æ", us: "æ" },
  AH: { uk: "ʌ", us: "ʌ" }, // 也作 schwa ə（弱读，见 AH0）
  AH0: { uk: "ə", us: "ə" },
  AO: { uk: "ɔː", us: "ɔ" },
  AW: { uk: "aʊ", us: "aʊ" },
  AY: { uk: "aɪ", us: "aɪ" },
  EH: { uk: "e", us: "ɛ" },
  ER: { uk: "ɜː", us: "ɜ" },
  ER0: { uk: "ɜː", us: "ɚ" }, // r-colored schwa（美式）
  EY: { uk: "eɪ", us: "e" },
  IH: { uk: "ɪ", us: "ɪ" },
  IY: { uk: "iː", us: "i" },
  OW: { uk: "əʊ", us: "oʊ" },
  OY: { uk: "ɔɪ", us: "ɔɪ" },
  UH: { uk: "ʊ", us: "ʊ" },
  UW: { uk: "uː", us: "u" },
  // 带 r 的双元音（官方表 ih,r / eh,r / uh,r → 英式集中双元音）
  "IHR": { uk: "ɪə", us: "ɪr" },
  "EHR": { uk: "eə", us: "ɛr" },
  "UHR": { uk: "ʊə", us: "ʊr" },
  // ── 辅音（英/美一致） ──
  B: { uk: "b", us: "b" },
  CH: { uk: "tʃ", us: "tʃ" },
  D: { uk: "d", us: "d" },
  DH: { uk: "ð", us: "ð" },
  F: { uk: "f", us: "f" },
  G: { uk: "ɡ", us: "ɡ" },
  HH: { uk: "h", us: "h" },
  JH: { uk: "dʒ", us: "dʒ" },
  K: { uk: "k", us: "k" },
  L: { uk: "l", us: "l" },
  M: { uk: "m", us: "m" },
  N: { uk: "n", us: "n" },
  NG: { uk: "ŋ", us: "ŋ" },
  P: { uk: "p", us: "p" },
  R: { uk: "r", us: "r" },
  S: { uk: "s", us: "s" },
  SH: { uk: "ʃ", us: "ʃ" },
  T: { uk: "t", us: "t" },
  TH: { uk: "θ", us: "θ" },
  V: { uk: "v", us: "v" },
  W: { uk: "w", us: "w" },
  Y: { uk: "j", us: "j" },
  Z: { uk: "z", us: "z" },
  ZH: { uk: "ʒ", us: "ʒ" },
}

/** 智聆音素 → 国际音标（IPA）。已含斜杠则跳过，未知符号保留原文。 */
export function arpabetToIpa(phone: string, style: PronStyle = "uk"): string {
  if (phone.startsWith("/")) return phone // 已经是 IPA
  const key = phone
    // 兼容智聆小写 → 大写；去掉尾随重音数字（ah0→ah）
    .toUpperCase()
    .replace(/[012]$/, "")
  // 带 r 双元音：ih,r / eh,r / uh,r → 拼接键 IHR/EHR/UHR
  const mergedKey = key.replace(/,R$/, "R")
  const hit = PHONE_TO_IPA[mergedKey] ?? PHONE_TO_IPA[key]
  if (hit) return `/${hit[style]}/`
  return `/${phone}/`
}

// ────────────────────────────────────────────────────────────
// 中文 / 拼音评测（16k_zh）音素显示
//
// 腾讯 SOE 中文引擎返回的 Phone 不是 IPA，也不是英文 ARPAbet，
// 而是拼音标记：声母原样（b / zh / sh…），韵母带数字声调
// （o1 / ui1 / i4 / ang4…，ü 写作 v）。展示时应转成课本式
// 带调拼音（ō / uī / ì / àng），不能丢给英语 IPA 表。
// ────────────────────────────────────────────────────────────

/** 声母表（含零声母 y/w；与 pinyin.ts 的 INITIALS 一致） */
const PINYIN_INITIALS = [
  "zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
  "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w",
]

/** 数字声调 → 带调元音（ü 写作 v 存键） */
const TONE_MARKS: Record<number, Record<string, string>> = {
  1: { a: "ā", o: "ō", e: "ē", i: "ī", u: "ū", v: "ǖ" },
  2: { a: "á", o: "ó", e: "é", i: "í", u: "ú", v: "ǘ" },
  3: { a: "ǎ", o: "ǒ", e: "ě", i: "ǐ", u: "ǔ", v: "ǚ" },
  4: { a: "à", o: "ò", e: "è", i: "ì", u: "ù", v: "ǜ" },
}

/** 找韵腹标调位置：a > o > e > (i/u/v 中靠后者)。返回索引，找不到返回 -1 */
function findToneVowelIndex(body: string): number {
  for (const ch of ["a", "o", "e"]) {
    const idx = body.indexOf(ch)
    if (idx >= 0) return idx
  }
  let last = -1
  for (const ch of ["i", "u", "v"]) {
    const idx = body.indexOf(ch)
    if (idx >= 0 && idx > last) last = idx
  }
  return last
}

/**
 * 腾讯中文/拼音评测音素 → 课本式带调拼音。
 * - 声母：原样返回（b → b，zh → zh）
 * - 韵母带数字声调：数字转声调符号标在韵腹上（o1 → ō，ui1 → uī，i4 → ì）
 * - 韵母无声调：原样返回（ao → ao）；轻声（5）不标调
 * - ü 写作 v：转回 ü 并标调（v2 → ǘ）
 */
export function pinyinPhoneToDisplay(phone: string): string {
  const p = phone.trim().toLowerCase()
  if (!p) return phone
  if (PINYIN_INITIALS.includes(p)) return p
  const m = p.match(/^(.*?)([1-5])$/)
  if (!m) return p.replace(/v/g, "ü") // 无声调（如 ao / er）
  const body = m[1]
  const tone = Number(m[2])
  if (!body) return p
  if (tone === 5) return body.replace(/v/g, "ü") // 轻声不标调
  const idx = findToneVowelIndex(body)
  if (idx < 0) return p.replace(/v/g, "ü")
  const vowel = body[idx]
  const marked = TONE_MARKS[tone]?.[vowel]
  if (!marked) return p.replace(/v/g, "ü")
  return `${body.slice(0, idx)}${marked}${body.slice(idx + 1)}`.replace(/v/g, "ü")
}
