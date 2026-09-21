/** 音素 → 中文「发音要领」提示表 —— 给评测低分的音素配一句可照着做的小技巧。
 *
 * 场景：「每日英语」里孩子读完一句，某个音素只有 49 分。光给分数他不知道怎么改，
 * 这里把「舌尖轻贴上齿背，送气不发音」这种**可执行的动作**塞到低分音素旁边。
 *
 * ## 为什么不塞进 `PHONE_TO_IPA`
 *
 * `arpabet.ts` 只管「音素码 → IPA 符号」这一件事，是**纯符号映射**、被拼读着色/音素详情
 * 等多个页面共用；本表是**教学文案**，而且带分类（口型/气流/长短）。混在一起会让
 * `arpabet.ts` 变成杂物间，也会让 7 个只想要符号的调用点被迫打包这堆中文。
 *
 * ## 键的写法
 *
 * 键用**大写的智聆音素码**（与 `PHONE_TO_IPA` 一致），查询时统一 `toUpperCase()` 并去掉
 * 尾随重音数字（`ah0`/`th1` → `AH`/`TH`）。中文拼音音素（`o1` / `ui1` …）不在本表范围，
 * 查不到就返回 null（中文评测不走这个提示）。
 *
 * ## 内容原则
 *
 * 1. **一句话说清一个动作**。小学生看不懂「齿龈」「不送气塞音」这类术语，
 *    写成「舌尖顶住上牙床，突然放开」。
 * 2. **优先讲最常见的错法**。`/θ/` 十有八九被读成 /s/，`/v/` 被读成 /w/，
 *    `/r/` 被读成汉语拼音的 r（卷舌）。提示直接对着这个错法说。
 * 3. **不评价、不打分**。只讲怎么做，不说「你读错了」。
 */

import type { PronStyle } from "./arpabet"

export type TipCategory = "consonant" | "vowel" | "diphthong" | "r-control" | "other"

export interface PhoneTip {
  /** 中文要领，一句话，可直接照着做 */
  tip: string
  /** 分类，用于 UI 上配图标/配色（可选展示） */
  cat: TipCategory
}

/** 音素码（大写，无重音数字）→ 要领 */
const TIPS: Record<string, PhoneTip> = {
  // ══════════ 辅音：中文里没有的 / 易混的，先讲 ══════════
  TH: { cat: "consonant", tip: "舌尖轻轻伸到上下牙齿中间，送气，别读成 s 或 z" },
  DH: { cat: "consonant", tip: "舌尖轻轻伸到上下牙齿中间，声带要振动（像「这」的开头）" },
  R: { cat: "consonant", tip: "舌尖卷起但不碰上颚，嘴唇稍微收圆，别读成汉语的 r" },
  L: { cat: "consonant", tip: "舌尖顶住上牙床，让气从舌头两边出来" },
  V: { cat: "consonant", tip: "上牙轻咬下唇，声带振动（别读成 w）" },
  F: { cat: "consonant", tip: "上牙轻咬下唇，只送气不发声" },
  W: { cat: "consonant", tip: "嘴唇收圆向前突出，像吹气一样滑过去" },
  SH: { cat: "consonant", tip: "舌尖抬向上颚但不碰上，气从缝里擦出来，像「嘘」" },
  ZH: { cat: "consonant", tip: "像 sh 的口型，但要出声振动（像「日」的开头）" },
  CH: { cat: "consonant", tip: "像「吃」的开头，先堵住再送气冲开" },
  JH: { cat: "consonant", tip: "像「知」的开头，先堵住再摩擦出声" },
  NG: { cat: "consonant", tip: "舌根抬起抵住软腭，气从鼻子出来（像「嗯」的尾音）" },
  N: { cat: "consonant", tip: "舌尖顶住上牙床，气从鼻子出来" },
  M: { cat: "consonant", tip: "双唇闭合，气从鼻子出来" },
  HH: { cat: "consonant", tip: "像轻轻哈气，只出气、不发声" },
  Y: { cat: "consonant", tip: "像「耶」的开头，舌面抬向硬腭快速滑开" },
  K: { cat: "consonant", tip: "舌根抵住软腭，突然放开，送一口大气" },
  G: { cat: "consonant", tip: "舌根抵住软腭，突然放开，声带要振动" },
  T: { cat: "consonant", tip: "舌尖顶住上牙床，突然放开，送一口大气" },
  D: { cat: "consonant", tip: "舌尖顶住上牙床，突然放开，声带要振动" },
  P: { cat: "consonant", tip: "双唇闭合，突然放开，送一口大气" },
  B: { cat: "consonant", tip: "双唇闭合，突然放开，声带要振动" },
  S: { cat: "consonant", tip: "舌尖靠近上牙床留条缝，像蛇叫「嘶」，不振动声带" },
  Z: { cat: "consonant", tip: "像 s 的口型，但声带要振动（像蜜蜂嗡嗡）" },

  // ══════════ 元音 ══════════
  IY: { cat: "vowel", tip: "嘴角向两边拉开像微笑，声音拉长一点" },
  IH: { cat: "vowel", tip: "比 iː 松一些、短一些，别把嘴角拉太开" },
  EH: { cat: "vowel", tip: "嘴张开约一个指头宽，舌前部抬起来" },
  AE: { cat: "vowel", tip: "下巴放低、嘴张大，像要咬一口苹果" },
  AH: { cat: "vowel", tip: "嘴自然放松微微张开，短促有力" },
  AA: { cat: "vowel", tip: "嘴张大，像看医生发「啊」，声音拉长" },
  AO: { cat: "vowel", tip: "嘴唇收圆向前突出，像「哦」但更长" },
  UH: { cat: "vowel", tip: "嘴微微收圆，短促、放松" },
  UW: { cat: "vowel", tip: "嘴唇收成小圆向前突出，像吹口哨，声音拉长" },

  // ══════════ 双元音：要「滑」过去 ══════════
  AY: { cat: "diphthong", tip: "从「啊」滑向「衣」，前长后短，是一个音不是两个" },
  EY: { cat: "diphthong", tip: "从「诶」滑向「衣」，中间不要断开" },
  OW: { cat: "diphthong", tip: "从「哦」滑向「乌」，嘴唇由圆变拢" },
  OY: { cat: "diphthong", tip: "从「哦」滑向「衣」，一口气连着滑" },
  AW: { cat: "diphthong", tip: "从「啊」滑向「乌」，像被踩了一脚「哎哟」" },

  // ══════════ r 控制元音 / 卷舌 ══════════
  ER: { cat: "r-control", tip: "舌身中部抬起、舌尖轻卷，不碰到任何地方" },
  ER0: { cat: "r-control", tip: "轻轻卷舌，声音很弱很短（多出现在词尾）" },
  IHR: { cat: "r-control", tip: "从 ɪ 滑向卷舌，一口气连着" },
  EHR: { cat: "r-control", tip: "从 e 滑向卷舌，像「哎」加卷舌" },
  UHR: { cat: "r-control", tip: "从 ʊ 滑向卷舌，嘴唇别太圆" },

  // ══════════ 弱读 / 特殊 ══════════
  AH0: { cat: "other", tip: "非重读音节的「ə」，嘴巴放松、轻轻带过就好" },
}

/** 查询用的键归一化：大写 + 去掉尾随重音数字（ah0 → AH） */
function normKey(phone: string): string {
  return phone.trim().toUpperCase().replace(/[012]$/, "")
}

/**
 * 查某个音素的发音要领。查不到返回 `null`（调用方据此不渲染提示）。
 *
 * @param phone 智聆音素码（`th` / `ih` / `ah0` / `ih,r`… 大小写不敏感）
 */
export function phoneTip(phone: string): PhoneTip | null {
  const key = normKey(phone)
  if (!key) return null
  // 带 r 双元音的逗号写法（ih,r）→ IHR
  const merged = key.replace(/,R$/, "R")
  return TIPS[merged] ?? TIPS[key] ?? null
}

/** 该音素是否有本地要领（UI 用来决定要不要占位等 LLM） */
export function hasLocalTip(phone: string): boolean {
  return phoneTip(phone) !== null
}

/**
 * 生成本地版提示文本（含 IPA 符号前缀由调用方拼装，这里只给要领）。
 * `style` 目前不影响文案（口型描述对英美通用），保留参数是为了将来分化时不用改签名。
 */
export function localTipText(phone: string, _style?: PronStyle): string | null {
  return phoneTip(phone)?.tip ?? null
}

/** 本地表覆盖的音素个数（单测/自检用） */
export const LOCAL_TIP_COUNT = Object.keys(TIPS).length

// ══════════════════════════════════════════════════════════════════
// 朗读文本（TTS）
// ══════════════════════════════════════════════════════════════════

/** 全部 Arpabet 音素码（大写）。用于识别提示文案里「孤立的音素符号」。 */
const PHONE_CODES = new Set([
  "AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW",
  "B","CH","D","DH","F","G","HH","JH","K","L","M","N","NG","P","R","S","SH",
  "T","TH","V","W","Y","Z","ZH",
])

/** 音素符号在文案里的替换词。孩子听「这个音」比听字母名有效。 */
const PHONE_SPOKEN = "这个音"

/**
 * 把提示文案处理成**适合朗读**的文本。
 *
 * ## 为什么必须处理（实测，2026-09-21）
 *
 * 百度 TTS 遇到**孤立的字母**会读**字母名**，不是读音素：
 * - `"f"` → 读成「艾弗」(ef)  ← ASR 回灌验证：`"f"` → `F。`
 * - `"r"` → 读成「阿尔」
 *
 * 而 LLM 生成的文案长这样：`读friend的f时，上牙轻轻咬下嘴唇再送气哦`。
 * 直接读会让孩子听到「读 friend 的 艾弗 时…」——**把他往错误的方向带**。
 *
 * ## 处理规则（★ 刻意保守，只改「确定是音素符号指代」的位置）
 *
 * **只替换「的 + 音素符号」这个 LLM 固定句式里的符号**，形状是
 * `的 f 时` / `的 r 时` / `的 th 时` → `的这个音时`。
 *
 * ⚠️ **不能盲目替换所有音素码**——本地表里有 `送气，别读成 s 或 z` 这种句子，
 * 那里的 `s`/`z` 是**要避免的错误读法**，替换成「这个音」会把句子改坏（踩过）。
 * 所以只在「的」后面跟音素码、且后面紧跟中文时才动手，其余一律原样保留。
 *
 * 另外带定界符的 `/f/`、`[th]` 是明确的音素符号，一并替换。
 *
 * ## 幂等性
 *
 * 本地表 44 条全是纯中文（如「上牙轻咬下唇，只送气不发声」），跑一遍结果不变，
 * 所以调用方不必分支处理。
 *
 * @param tip 提示文案（本地表或 LLM）
 * @param phones 本次涉及的音素码，用于判定哪个片段是音素符号（可选；缺省用内置音素码表）
 */
export function tipSpeechText(tip: string, phones: string[] = []): string {
  if (!tip) return ""
  const known = new Set(phones.map((p) => p.trim().toUpperCase().replace(/[012]$/, "")))
  const isPhoneLike = (s: string) => {
    const up = s.toUpperCase()
    return known.has(up) || PHONE_CODES.has(up)
  }

  let out = tip

  // ① 带定界符的：/f/ 、[th] 、（f） → 这个音。定界符本身已表明这是音素符号，最安全。
  out = out.replace(/[/[（(]\s*([A-Za-z]{1,3})\s*[/\]）)]/g, (m, g) => (isPhoneLike(g) ? PHONE_SPOKEN : m))

  // ② LLM 固定句式：`的f时` / `的 r 时` / `的th要` → `的这个音时`。
  //    只在「的」后紧跟音素码、且音素码后紧跟中文汉字时才替换。
  out = out.replace(/的\s*([A-Za-z]{1,3})\s*(?=[\u4e00-\u9fff])/g, (m, g) => (isPhoneLike(g) ? `的${PHONE_SPOKEN}` : m))

  return out
}

/** 该文案处理后是否与原样不同（单测/调试用） */
export function tipNeedsSpeechFix(tip: string, phones: string[] = []): boolean {
  return tipSpeechText(tip, phones) !== tip
}
