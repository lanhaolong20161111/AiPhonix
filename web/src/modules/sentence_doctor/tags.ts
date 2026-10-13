/** 「提示语在句子的哪儿」—— 从标点数据里反推出来的一个派生量。
 *
 * ── 为什么不直接在 parts 里标出来 ────────────────────────────────
 * 19 句的 parts 已经是「按空位切开」的碎片，提示语恰好总是**完整的一段**
 * （「老屋说」「蜗牛难过地带着哭腔说」都是整段），所以不用另加数据：
 * 哪一段是提示语，可以从**紧跟在它后面的那个空位的角色**看出来 ——
 *   · tag  提示语在前   → 提示语 = 它前一段
 *   · mid  提示语在中   → 提示语 = 它前一段
 *   · narr 提示语后面还有叙述（提示语在后）→ 提示语 = 它前一段
 *   · 都不出现时（提示语在最后、后面直接收尾）→ 提示语 = 倒数第二段
 * 四种情况合起来覆盖了全部 19 句，`marks.test.ts` 里逐句钉死了 19 个期望值。
 *
 * ⚠️ 这个函数只用于**点亮**（孩子主动点「提示语在哪儿」时才高亮），
 *    不许拿它去判对错 —— 「找出提示语」本来就是要练的那件事。
 */

import type { PunctItem } from "./data"

/** 提示语相对「话」的位置 */
export type TagPos = "front" | "mid" | "back"

/** 提示语的段下标（parts 的索引）；推不出来时 -1 */
export function tagPartIndexOf(item: PunctItem): number {
  for (let si = 0; si < item.slots.length; si++) {
    const s = item.slots[si]
    if (s && (s.kind === "tag" || s.kind === "mid" || s.kind === "narr")) return si - 1
  }
  const last = item.slots.length - 1
  if (last > 0 && item.slots[last]?.kind === "end") return last - 1
  return -1
}

/**
 * 提示语在「话」的前面 / 中间 / 后面。
 *
 * 判据是**跟引号的关系**，不是它落在句子的第几段：第二关第一句
 * 「“非常感谢你给我指路。”说完，陶陶慢慢掉头往回走。」里，提示语「说完」
 * 虽然在句子中间，但对「话」来说它在**后面** —— 这一关练的就是这件事。
 */
export function tagPositionOf(item: PunctItem): TagPos | null {
  const ti = tagPartIndexOf(item)
  if (ti < 0) return null
  // 只看第 ti 段之前的空位（含紧贴它的第 ti 个）里有没有「合上引号」
  const closedBefore = item.slots.slice(0, ti + 1).some((s) => s?.kind === "close")
  if (!closedBefore) return "front"
  const moreAfter = item.slots.slice(ti + 1).some((s) => s?.kind === "close" || s?.kind === "mid")
  return moreAfter ? "mid" : "back"
}

export const TAG_POS_LABEL: Record<TagPos, string> = {
  front: "提示语在前",
  mid: "提示语在中",
  back: "提示语在后",
}
