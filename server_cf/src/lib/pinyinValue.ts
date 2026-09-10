/** 多音字注音值的合法性校验
 *
 * 背景（真实事故）：`CHINESE_POLYPHONES_PROMPT` 里写了「非多音字不要标」，但模型有时会给
 * **每个字**都标上，并把"这句不用标"写进**值**里，例如：
 *
 *   {"polyphones": {"样": "(非多音，跳过)"}}
 *
 * 旧的解析只校验 `key 长度 1 && value 非空`，于是 `(非多音，跳过)` 被当成拼音存进
 * `blocks[].polyphones`，结果页在「样」字上方的 ruby 拼音位渲染出这句话（蓝色+虚线下划线），
 * 看起来像正文里多了一行字。
 *
 * 这里要求值必须真的是**单个拼音音节**：纯字母（允许 ü/v）+ 可选声调数字 1~5，
 * 也接受带调号写法（zhòng / háng / lǜ…）。含汉字、括号、空格、标点、多音节一律判非法。
 */

/** 声调符号区间：Latin-1 Supplement + Latin Extended-A/B（à á ǎ ā è é ě ī í ǐ ò ó ǒ ū ú ǔ ǖ ǘ ǚ ǜ） */
const DIACRITICS = "\\u00c0-\\u01ff"
const PINYIN_SYL_RE = new RegExp(`^[a-züv${DIACRITICS}]+[1-5]?$`, "i")
/** 出现这些字符就绝不是拼音：汉字、空白、中英标点、括号、引号 */
const NON_PINYIN_RE = new RegExp("[\\u4e00-\\u9fff\\s，。、；：！？（）()：:；;!！?？'\"“”‘’]")

/**
 * 值是不是一个合法拼音音节。
 *
 * 合法：`zhòng` `háng` `zhuó` `lǜ` `de` `zhong4` `hang2` `n`
 * 非法：`(非多音，跳过)` `非多音` `跳过` `` `样` `yang4 样` `a1b2c3…`
 */
export function isPinyinValue(v: unknown): boolean {
  const s = String(v ?? "").trim()
  if (!s || s.length > 12) return false
  if (NON_PINYIN_RE.test(s)) return false
  if (!PINYIN_SYL_RE.test(s)) return false
  const tone = Number((s.match(/[1-5]$/) || [])[0] ?? 0)
  if (tone && (tone < 1 || tone > 5)) return false
  return true
}

/** 过滤一组 字→拼音 映射，只保留合法项 */
export function cleanPolyphones(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ks = String(k ?? "").trim()
    const vs = String(v ?? "").trim()
    if (ks.length === 1 && isPinyinValue(vs)) out[ks] = vs
  }
  return out
}

/** 清掉 blocks[].polyphones 里所有非法值（历史缓存里可能已落进说明文字，命中缓存也要过一遍）。
 *  净化后为空的块把 polyphones 置空对象，避免下游再判「有注音」。 */
export function sanitizeBlockPolyphones<T>(blocks: T): T {
  if (!Array.isArray(blocks)) return blocks
  return blocks.map((b: unknown) => {
    const src = b as { polyphones?: unknown } | null
    if (!src || typeof src !== "object" || !src.polyphones || typeof src.polyphones !== "object") {
      return b
    }
    return { ...(src as object), polyphones: cleanPolyphones(src.polyphones) }
  }) as unknown as T
}
