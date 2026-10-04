/** 文章练习：本地按句切分 + LLM 缩写合并
 *
 * 为什么本地切句：文章粘贴后要**立刻**开始逐句练习，不能干等 LLM。
 * 缩写（背诵框架）由 /llm/article-recite 后台生成，回来后再原地合并。
 */

/** 一行 = 一句原文 + 其极简背诵提示（≤12 字，空串=未生成） */
export interface ArticleLine {
  text: string
  short: string
}

/** 句末标点（中文全角 + 英文半角 + 省略号）
 *  取舍：单个「…」也当句末（中文里单个省略号基本是「话没说完」＝句末）；
 *  若出现在句子中间（如「我…不知道」）会被误切 —— 小学文章里极罕见，可接受。 */
const SENTENCE_END = /[。！？!?；;…]/
/** 句末标点后可吸收的收尾符号（右引号/右书名号/省略号），避免把」”切到下一句 */
const TRAILING = /[」』”’"'…]/

/**
 * 把一段文章文本切分成句子：
 * - 句末标点（。！？；!?;…）后断句，并吸收紧跟的收尾引号/省略号；
 * - 换行强制断句；
 * - 去首尾空白、丢弃空段。
 */
export function splitSentences(raw: string): string[] {
  const chars = [...(raw || "").replace(/\r/g, "")]
  const out: string[] = []
  let buf = ""
  const flush = () => {
    const t = buf.trim()
    if (t) out.push(t)
    buf = ""
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === "\n") {
      flush()
      continue
    }
    buf += ch
    if (!SENTENCE_END.test(ch)) continue
    // 吸收收尾符号（如 。」 ，……），最多 4 个，避免吞掉下一句首字
    let k = 0
    while (i + 1 < chars.length && k < 4 && TRAILING.test(chars[i + 1])) {
      buf += chars[i + 1]
      i++
      k++
    }
    flush()
  }
  flush()
  return out
}

/** 归一化：去标点/空白，用于按文本对齐 LLM 回显的句子 */
function norm(s: string): string {
  return (s || "").replace(/[^\u4e00-\u9fff0-9a-zA-Z]/g, "")
}

/**
 * 把后端返回的 { text, short } 合并到本地切句结果上。
 * 优先按归一化后的句子文本匹配（LLM 可能漏句/换序），命不中再按下标兜底。
 */
export function mergeShorts(
  sentences: string[],
  items: { text?: string; short?: string }[] | undefined,
): ArticleLine[] {
  const byText = new Map<string, string>()
  for (const it of items ?? []) {
    const k = norm(it?.text ?? "")
    const v = (it?.short ?? "").trim()
    if (k && v && !byText.has(k)) byText.set(k, v)
  }
  return sentences.map((s, i) => {
    const byIdx = (items?.[i]?.short ?? "").trim()
    return { text: s, short: byText.get(norm(s)) || byIdx }
  })
}
