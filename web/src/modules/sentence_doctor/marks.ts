/** 一处病灶在原句里的「坐标」—— 把 SpotMark 翻译成字符区间，供两个地方用：
 *
 *   ① 页面渲染：在原句上框出病灶、牵出引线（见 index.tsx 的 <MarkedSentence />）；
 *   ② 自检脚本：把每一处 mark 依次作用到 text 上，必须**逐字等于** fixed
 *      （marks.test.ts）。内容写错一个字，那条测试立刻红 —— 这是本文件存在的意义。
 *
 * 为什么不在运行时跑 diff 自动算位置，见 data.ts 里 SpotMark 的注释。
 */

import type { FixSpot, SpotMark } from "./data"

/** 病灶在原句里的三处坐标（都是「原句」坐标，不是订正后的） */
export interface MarkSpan {
  /** cut 的区间 [start, end)；没有 cut 时 null */
  cut: [number, number] | null
  /** with 的区间；没有 with 时 null */
  with: [number, number] | null
  /** put 要补在哪个字符之前；null = 按 cut 原位（无 cut 则句末） */
  at: number | null
}

/** 找唯一一次出现；找不到或出现多次都返回 -1（页面据此降级：宁可不画，不画错） */
export function findOnce(text: string, piece: string): number {
  if (!piece) return -1
  const i = text.indexOf(piece)
  if (i < 0) return -1
  return text.indexOf(piece, i + 1) < 0 ? i : -1
}

/** SpotMark → 原句上的字符区间 */
export function locateMark(text: string, m: SpotMark): MarkSpan {
  const ci = m.cut ? findOnce(text, m.cut) : -1
  const wi = m.with ? findOnce(text, m.with) : -1
  const ai = m.at ? findOnce(text, m.at) : -1
  return {
    cut: ci < 0 || !m.cut ? null : [ci, ci + m.cut.length],
    with: wi < 0 || !m.with ? null : [wi, wi + m.with.length],
    at: ai < 0 ? (m.cut ? ci : null) : ai,
  }
}

/**
 * 把一句话的所有病灶按顺序「治」一遍 —— 页面不用它，测试用。
 *
 * 四种工具的动作各不相同，所以这里必须跟着 tool 走（光看 mark 分不出对调和移动：
 * 两者的数据形状一样，只是「隔开一段」与「紧挨着」的区别）。
 */
export function applyMarks(item: { text: string; spots: { tool: string; mark: SpotMark }[] }): string {
  let out = item.text
  for (const spot of item.spots) {
    const m = spot.mark
    if (m.cut && m.with) {
      const a = out.indexOf(m.cut)
      const b = out.indexOf(m.with)
      if (a < 0 || b < 0) throw new Error(`定位失败：cut=${m.cut} with=${m.with}`)
      if (spot.tool === "对调") {
        // 紧挨着的两处互换
        if (a < b) out = out.slice(0, a) + m.with + m.cut + out.slice(b + m.with.length)
        else out = out.slice(0, b) + m.cut + m.with + out.slice(a + m.cut.length)
      } else {
        // 移动：先把 cut 取下来，再整个插到 with 前面
        const rest = out.slice(0, a) + out.slice(a + m.cut.length)
        const t = rest.indexOf(m.with)
        if (t < 0) throw new Error(`移动失败：with=${m.with}`)
        out = rest.slice(0, t) + m.cut + rest.slice(t)
      }
      continue
    }
    let hole: number | null = null
    if (m.cut) {
      const a = out.indexOf(m.cut)
      if (a < 0) throw new Error(`定位失败：cut=${m.cut}`)
      if (out.indexOf(m.cut, a + 1) >= 0) throw new Error(`cut 不唯一：${m.cut}`)
      out = out.slice(0, a) + out.slice(a + m.cut.length)
      hole = a
    }
    if (m.put) {
      const p = m.at ? out.indexOf(m.at) : hole !== null ? hole : out.length
      const at = p < 0 ? out.length : p
      out = out.slice(0, at) + m.put + out.slice(at)
    }
  }
  return out
}

/** 病灶在原句里占用的字符区间（可能有两处：cut 与 with）—— 用来判「两个病灶是不是打架了」 */
export function occupiedRanges(text: string, spots: FixSpot[]): [number, number][][] {
  return spots.map((s) => {
    const g = locateMark(text, s.mark)
    return [g.cut, g.with].filter((x): x is [number, number] => !!x)
  })
}

/**
 * 一句话说清「这一处该怎么下笔」—— 显示在理由框里。
 *
 * 和页面上的红笔标记是同一件事的两种说法：**先写下来，再看画出来的**。
 * 只写不画，孩子不知道符号落在哪几个字上；只画不写，家长看不懂这笔画的是什么。
 */
export function describeMark(spot: { tool: string; mark: SpotMark }): string {
  const { tool, mark: m } = spot
  switch (tool) {
    case "改正":
      return `框住「${m.cut}」，在订正栏写上「${m.put}」`
    case "删除":
      return `框住「${m.cut}」划掉`
    case "增补":
      return m.cut ? `框住「${m.cut}」，补上「${m.put}」` : `把「${m.put}」补在「${m.at}」前面`
    case "对调":
      return `「${m.cut}」和「${m.with}」紧挨着，互换位置`
    case "移动":
      return `把「${m.cut}」整个挪到「${m.with}」前面`
    default:
      return ""
  }
}
