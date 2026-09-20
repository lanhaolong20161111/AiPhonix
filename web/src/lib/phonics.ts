/** 英语拼读着色 —— 把英文单词切成「拼读单元」，按读音类别上色。
 *
 * 教学意图：让孩子一眼看出单词是由哪几块「音块」拼起来的。
 * 六类颜色（与设置页图例一一对应）：
 *
 * | 类型 | 含义 | 例 |
 * |---|---|---|
 * | `vowel-single` | 单字母元音（短元音） | c**a**t / b**e**d / p**i**g |
 * | `vowel-long`   | 长元音（magic-e 或长音组合） | c**a**k**e** / r**ai**n / n**igh**t |
 * | `vowel-team`   | 组合元音 / r 控制元音 / 成音节 | b**oo**k / c**ar** / tab**le** |
 * | `digraph`      | 辅音组合（含双写、含 -tion 的 ti） | **sh**ip / wa**tch** / na**ti**on |
 * | `silent`       | 不发音字母 | mak**e** / **k**nife / lam**b** |
 * | `consonant`    | 普通辅音 | **c**a**t** 里的 c、t |
 * | `other`        | 非字母（撇号/连字符/标点） | don**'**t |
 *
 * ## 两条设计原则（2026-09-16 重写时确立）
 *
 * 1. **块数优先于标签**。「色块数 == 真实元音音素个数」是硬指标（用 CMU 发音词典
 *    13.4 万条量化过，见 skill `phonics-rule-eval`）；某个块该标"长"还是"短"是软指标。
 *    两者冲突时先保块数。
 * 2. **例外交给词表，不硬凑规则**。英语拼读例外极多（have / give / one / said…），
 *    规约不了的一律落进 `phonicsExceptions.ts` 显式切分表——那里可以一个词一个词地写对，
 *    而规则里堆特例只会互相打架。
 *
 * 纯函数 + 结果缓存，可在识别结果页这种词量大的场景反复调用。
 */

import { POLYPHONE_EXCEPTIONS } from "./phonicsExceptions"

export type PhonicType =
  | "vowel-single"
  | "vowel-long"
  | "vowel-team"
  | "digraph"
  | "silent"
  | "consonant"
  | "other"

export interface PhonicChunk {
  text: string
  type: PhonicType
}

/** 元音字母（y 单独判定：词尾 y 当元音读 /i/ 或 /aɪ/，词中前后皆辅音时也当元音） */
const VOWELS = "aeiou"

/** 长音元音组合：两个元音字母一起读长音（name 的 a、rain 的 ai 同类） */
const LONG_TEAMS = [
  "eigh", "igh",
  "ai", "ay", "ea", "ee", "ei", "ey", "ie", "oa", "oe", "ue", "ui", "ew",
]

/** r 控制元音：元音 + r 一起读（car / her / bird / for / turn / air / ear） */
const R_TEAMS = ["air", "are", "ear", "eer", "oor", "our", "ure", "ore", "ire", "ar", "er", "ir", "or", "ur"]

/** 其他元音组合（两个元音字母一起读一个音，但不是长音） */
const OTHER_VOWEL_TEAMS = ["oo", "oi", "oy", "ou", "ow", "au", "aw"]

/** 辅音组合：两个/三个字母一起读一个音（含双写辅音） */
const CONSONANT_TEAMS = [
  "tch", "dge",
  "sh", "ch", "th", "ph", "wh", "ck", "ng", "nk", "qu", "gh",
  // 双写辅音：ll/ss/tt 等也是「两个字母一个音」
  "ll", "ss", "ff", "tt", "pp", "mm", "nn", "bb", "dd", "gg", "rr", "zz", "cc",
]

/** 组合 → 类别。同长度下靠前的先匹配，故「长音组合」先于「其他元音组合」注册 */
const TEAM_TYPE = new Map<string, PhonicType>()
for (const t of LONG_TEAMS) TEAM_TYPE.set(t, "vowel-long")
for (const t of [...R_TEAMS, ...OTHER_VOWEL_TEAMS]) TEAM_TYPE.set(t, "vowel-team")
for (const t of CONSONANT_TEAMS) TEAM_TYPE.set(t, "digraph")

/** 按长度降序匹配（tch 优先于 ch、igh 优先于 gh 之类） */
const TEAM_LIST = [...TEAM_TYPE.keys()].sort((a, b) => b.length - a.length)

/** 词尾「后面还跟着一个哑 e」也要读长音的族：
 *  `-ild/-ind/-old/-olt/-ost/-oll/-all/-alk`（child / find / cold / most / ball / walk）
 *  与 `-ange/-aste`（change / taste）、`-ation`（nation）——都没有 magic-e 结构。 */
const TAIL_LONG_RE = /(ild|ind|old|olt|ost|oll|all|alk|ange|aste|ation)$/

/** 软音标记后缀：ti/ci/si 在这些后缀里读 /ʃ/ 或 /ʒ/，不是「元音 + 元音」 */
const SOFT_IO_RE = /^(on|al|ous)/

/** 图例：类型 → 中文名 + 一句话说明（设置页展示） */
export const PHONIC_LABELS: { type: PhonicType; name: string; hint: string }[] = [
  { type: "vowel-single", name: "单字母元音", hint: "一个元音字母单独出现，多读短音：cat 的 a" },
  { type: "vowel-long", name: "长元音", hint: "读字母本音：cake 的 a、rain 的 ai、night 的 igh" },
  { type: "vowel-team", name: "组合元音", hint: "多个字母一起读一个元音，或成音节的 l：book 的 oo、car 的 ar、table 的 le" },
  { type: "digraph", name: "辅音组合", hint: "两三个字母读一个辅音：ship 的 sh、watch 的 tch、nation 的 ti" },
  { type: "silent", name: "不发音字母", hint: "看着有、读时不发音：make 的 e、knife 的 k、lamb 的 b" },
  { type: "consonant", name: "普通辅音", hint: "一个字母一个音：cat 的 c、t" },
]

/** 某个类型对应的 CSS 后缀（.ph-vowel-single 等） */
export function phonicClass(type: PhonicType): string {
  return `ph-${type}`
}

/** 是否是一个英文单词（纯字母 + 可选撇号/连字符）。
 *  生词本这类「中英文混排」的列表靠它决定要不要着色——给汉字上拼读色没有意义。 */
export function isEnglishWord(text: string): boolean {
  return /^[A-Za-z][A-Za-z'\u2019-]*$/.test((text ?? "").trim())
}

/** word = 可选前导标点 + 词核（字母/撇号/连字符）+ 可选尾部标点 */
const WORD_RE = /^([^A-Za-z]*)([A-Za-z][A-Za-z'\u2019-]*)?([^A-Za-z]*)$/

/**
 * 把单词切成带类别的拼读单元（结果缓存）。
 * @example segmentPhonics("father?") → [f/cons, a/vowel-single, th/digraph, er/vowel-team, "?"/other]
 */
export function segmentPhonics(word: string): PhonicChunk[] {
  if (!word) return []
  const hit = cache.get(word)
  if (hit) return hit
  const res = compute(word)
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(word, res)
  return res
}

/** 去掉着色标记、还原成纯文本（导出给测试与「复制/朗读」场景用） */
export function joinPhonics(chunks: PhonicChunk[]): string {
  return chunks.map((c) => c.text).join("")
}

const cache = new Map<string, PhonicChunk[]>()
const CACHE_MAX = 4000

function compute(word: string): PhonicChunk[] {
  const m = WORD_RE.exec(word)
  if (!m || !m[2]) return [{ text: word, type: "other" }]
  const [, lead, core, tail] = m
  // 例外词表优先：这是人工逐个校对的切分，比任何规则都准
  const fixed = POLYPHONE_EXCEPTIONS.get(core.toLowerCase())
  const out: PhonicChunk[] = []
  if (lead) out.push({ text: lead, type: "other" })
  if (fixed && fixed.reduce((a, c) => a + c.text.length, 0) === core.length) {
    // 例外表按小写存；按长度切片还原原词的大小写（Family → Family）
    let off = 0
    for (const c of fixed) {
      out.push({ text: core.slice(off, off + c.text.length), type: c.type })
      off += c.text.length
    }
  } else {
    out.push(...segmentCore(core))
  }
  if (tail) out.push({ text: tail, type: "other" })
  return mergeSame(out)
}

/** 相邻同类型合并（**只合并普通辅音与标点**）。
 *
 * ⚠️ 元音块、组合块、不发音块**绝不能合并**：`flower` 的 `ow` 与 `er` 都是
 * 「组合元音」，合并成 `ower` 会让孩子误以为它们是一个音块——而块边界正是本功能
 * 要教的东西。普通辅音合并只是因为它们本来就是背景色，合并后 DOM 更少。
 */
function mergeSame(chunks: PhonicChunk[]): PhonicChunk[] {
  const MERGEABLE: PhonicType[] = ["consonant", "other"]
  const out: PhonicChunk[] = []
  for (const c of chunks) {
    if (!c.text) continue
    const last = out[out.length - 1]
    if (last && last.type === c.type && MERGEABLE.includes(c.type)) last.text += c.text
    else out.push({ text: c.text, type: c.type })
  }
  return out
}

const isVowel = (c: string): boolean => VOWELS.includes(c)
const isLetter = (c: string): boolean => c >= "a" && c <= "z"

function segmentCore(core: string): PhonicChunk[] {
  const low = core.toLowerCase()
  const n = low.length
  const type: PhonicType[] = new Array(n).fill("consonant")
  const used: boolean[] = new Array(n).fill(false)
  /** 每个字符所属「块」的起始下标 —— 出块边界靠它，不能只看类型是否相同，
   *  否则 flower 的 ow / er（同属「组合元音」）会被并成一块。 */
  const owner: number[] = new Array(n).fill(0).map((_, k) => k)
  const mark = (from: number, len: number, t: PhonicType) => {
    for (let k = from; k < from + len; k++) {
      type[k] = t
      used[k] = true
      owner[k] = from
    }
  }

  // ── 0. 软音标记：-tion / -sion / -cial / -tial / -tious / -cious ──
  // ti / ci / si 在这几个后缀里读 /ʃ/（sion 读 /ʒ/），是「两个字母一个辅音」。
  // 不识别的话 nation 会被切成 n-a-t-i-o-n，多出两个假元音块（最高频的后缀之一）。
  for (let k = 1; k + 2 < n; k++) {
    const c = low[k - 1]
    if (c !== "t" && c !== "c" && c !== "s") continue
    if (low[k] !== "i") continue
    if (!SOFT_IO_RE.test(low.slice(k + 1))) continue
    mark(k - 1, 2, "digraph")
  }

  // ── 1. 词尾 e ──
  // 末尾可能是 s / d 这类轻后缀（homes / liked / wanted），先回退一格再判「词尾 e」，
  // 否则「[元音][辅音]e」这条最常见的 magic-e 规则会因后缀而失效。
  let end = n
  let lightSuffix = ""
  if (end > 3 && (low[end - 1] === "s" || low[end - 1] === "d")) {
    lightSuffix = low[end - 1]
    end--
  }

  /** magic-e 待定的长元音位置 —— **先不定色**，等组合匹配跑完再收尾。
   *  ⚠️ 曾经在这里直接定色并 `used=true`，结果 house 的 u、please 的 a、choose 的第二个 o
   *  被先占掉，后面的 ou / ea / oo 因「跨越已判定位」匹配失败 → 一个音被拆成两块（顺序 bug）。 */
  let magicE = -1
  /** [辅音]le 里那个成音节的 l（apple / table / purple） */
  let syllabicL = -1

  if (end >= 3 && low.slice(end - 3, end) === "dge") {
    // 词尾 -dge：三个字母一起读 /dʒ/（bridge / judge / edge / knowledge），
    // 整块标为辅音组合，e 不再单独成块。
    mark(end - 3, 3, "digraph")
  } else if (end >= 3 && low[end - 1] === "e") {
    const e = end - 1
    const p1 = low[end - 2] // 尾 e 前一个字母
    const p2 = low[end - 3] // 再前一个
    if (isInflectionE(low, end, lightSuffix)) {
      // -ed / -es 里那个自成音节的 e（wanted /ɪd/、addresses /ɪz/）——
      // 它是**真元音**，不能当哑 e，否则整类词都少一个音块。
      type[e] = "vowel-single"
      used[e] = true
    } else if (isLetter(p1) && isVowel(p2) && !isVowel(p1)) {
      // [元音][辅音]e → magic-e：尾 e 不发音，前面的元音读长音（具体定色推迟）
      type[end - 1] = "silent"
      used[end - 1] = true
      magicE = end - 3
    } else if (isLetter(p1) && !isVowel(p1) && isLetter(p2) && !isVowel(p2)) {
      if (p1 === "l") {
        // [辅音]le → 成音节的 l：le 读 /əl/（apple / table / purple / uncle）
        type[end - 1] = "silent"
        used[end - 1] = true
        syllabicL = end - 2
      } else {
        // [辅音][辅音]e → 纯哑 e 或软音标记（since / large / course / twelve / taste）
        type[end - 1] = "silent"
        used[end - 1] = true
      }
    }
  }

  // ── 1a. 词尾 -ying：y 是元音（trying / flying / carrying / applying）──
  // 光看「y 前后是否辅音」判不出来（后面跟的是元音 i），但这一族在常用词里很集中。
  if (n >= 5 && low.endsWith("ying") && !used[n - 4]) {
    type[n - 4] = "vowel-single"
    used[n - 4] = true
  }

  // ── 1b. 词尾 -que / -gue：u 与 e 都不发音（unique / tongue / league / rouge）──
  if (n >= 4 && !used[n - 1] && (low.endsWith("que") || low.endsWith("gue"))) {
    const u = n - 2
    if (low[u] === "u" && !used[u]) {
      type[u] = "silent"
      used[u] = true
      type[n - 1] = "silent"
      used[n - 1] = true
      if (magicE === u) magicE = -1
    }
  }

  // ── 1c. gu + 元音：u 不发音（guard / guess / guide / guitar / language）──
  // 与 qu 不同（qu 是 /kw/ 的辅音组合），gu 里的 u 纯粹是 g 的软化标记。
  for (let k = 1; k + 1 < n; k++) {
    if (used[k] || low[k] !== "u" || low[k - 1] !== "g") continue
    if (!isVowel(low[k + 1])) continue
    type[k] = "silent"
    used[k] = true
    if (magicE === k) magicE = -1
  }

  // ── 2. 从左到右贪婪匹配 ──
  let i = 0
  while (i < n) {
    if (used[i]) {
      i++
      continue
    }
    const rest = low.slice(i)

    // 2a. 不发音的首字母：knife / write
    if (i === 0 && (rest.startsWith("kn") || rest.startsWith("wr"))) {
      type[0] = "silent"
      type[1] = "consonant"
      used[0] = used[1] = true
      i += 2
      continue
    }
    // 2b. 不发音的尾字母 g：sign / design（仅整个 gn 收尾时才 silent，signal 不受影响）
    if (i + 2 === n && rest.startsWith("gn")) {
      type[i] = "silent"
      type[i + 1] = "consonant"
      used[i] = used[i + 1] = true
      i += 2
      continue
    }
    // 2c. 不发音的尾字母 b：lamb / thumb / climb
    if (i === n - 1 && low[i] === "b" && i >= 2 && low[i - 1] === "m") {
      type[i] = "silent"
      used[i] = true
      i++
      continue
    }
    // 2d. -alk 里不发音的 l：walk / talk
    if (low[i] === "l" && i >= 1 && low[i - 1] === "a" && low[i + 1] === "k") {
      type[i] = "silent"
      used[i] = true
      i++
      continue
    }

    // 2e. 多字母组合（长组合优先）
    const team = matchTeam(rest, i, n, used)
    if (team) {
      mark(i, team.length, TEAM_TYPE.get(team) ?? "digraph")
      i += team.length
      continue
    }

    // 2f. 单字母
    const ch = low[i]
    if (isVowel(ch)) type[i] = "vowel-single"
    else if (ch === "y" && i === n - 1 && n > 2) type[i] = "vowel-single" // happy / my / sky 的尾 y
    else if (ch === "y" && i > 0 && i < n - 1 && !isVowel(low[i - 1]) && !isVowel(low[i + 1]))
      type[i] = "vowel-single" // 词中 y 前后皆辅音时读元音：physical / system / myth
    else if (ch === "'" || ch === "\u2019" || ch === "-") type[i] = "other"
    else type[i] = "consonant"
    used[i] = true
    i++
  }

  // ── 3. magic-e 收尾 ──
  // 该位置若已被 ou / ea / oo 这类元音组合接管，就作废（house / please / choose）；
  // 否则它是单字母元音，升为长音（cake / name / use）。
  if (magicE >= 0 && type[magicE] === "vowel-single") type[magicE] = "vowel-long"

  // ── 4. 词尾长元音族（无 magic-e 结构也读长音）──
  const m = TAIL_LONG_RE.exec(low.slice(0, end))
  if (m) {
    const vi = end - m[1].length
    if (vi >= 0 && type[vi] === "vowel-single" && owner[vi] === vi) type[vi] = "vowel-long"
  }

  // ── 5. 成音节的 l：le 两字母合成一块（apple 的 le 读 /əl/）──
  // 不这么标的话，`-le` 结尾的词会永远少一个元音块（apple 只有 a 一块，真实有 /æ/ 和 /ə/ 两块）。
  if (syllabicL >= 0 && used[syllabicL + 1]) {
    type[syllabicL] = "vowel-team"
    type[syllabicL + 1] = "vowel-team"
    used[syllabicL] = true
    owner[syllabicL] = syllabicL
    owner[syllabicL + 1] = syllabicL
  }

  // ── 6. 按「块」输出（而非逐字符）：连续同 owner 的字符才是同一个拼读单元 ──
  const chunks: PhonicChunk[] = []
  let k = 0
  while (k < n) {
    let j = k
    while (j + 1 < n && owner[j + 1] === owner[k]) j++
    chunks.push({ text: core.slice(k, j + 1), type: type[k] })
    k = j + 1
  }
  return chunks
}

/** 屈折后缀里那个「自成音节」的 e —— 是**真元音**，不能当哑 e。
 *
 *  - `-ed`：只在 t / d 之后读 /ɪd/（want**ed** / need**ed** / start**ed**）；
 *    look**ed** / play**ed** 的 e 仍是哑的（/t/、/d/ 直接跟在辅音后）。
 *  - `-es`：只在咝音之后读 /ɪz/（address**es** / pag**es** / hous**es** / watch**es** /
 *    box**es**）——s z x、ch/sh、ge/ce 都属于咝音。
 *
 *  这一类（wanted、pages、services、changes…）在常用词里极其密集，
 *  不认的话每个词都少一个音块。
 */
function isInflectionE(low: string, end: number, lightSuffix: string): boolean {
  const e = end - 1
  if (lightSuffix === "d") return low[e - 1] === "t" || low[e - 1] === "d"
  if (lightSuffix === "s") {
    const a = low[e - 1]
    const b = low[e - 2]
    if (a === "s" || a === "z" || a === "x" || a === "g" || a === "c") return true
    return a === "h" && (b === "c" || b === "s")
  }
  return false
}

/** 取当前可用的最长组合；跨越已判定（magic-e / 哑 e / 软音标记）的位不算命中 */
function matchTeam(rest: string, i: number, n: number, used: boolean[]): string | null {
  for (const t of TEAM_LIST) {
    if (t.length > n - i) continue
    if (!rest.startsWith(t)) continue
    let ok = true
    for (let k = i; k < i + t.length; k++) {
      if (used[k]) {
        ok = false
        break
      }
    }
    if (ok) return t
  }
  return null
}
