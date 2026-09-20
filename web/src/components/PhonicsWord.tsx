/** 英文单词拼读着色 — 把一个词按发音规律切成色块（见 lib/phonics）。
 *
 * 各页面接入方式：把原本「逐字符渲染」的地方换成本组件，并通过 `wrapChar` 注入
 * 自己那套字符包装（点读 span / 高亮 span），这样**点读、断行禁则、朗读高亮全都保持原样**，
 * 只有颜色是新增的。
 *
 * ⚠️ 色块用 `display:inline`（App.css 的 `.ph`）：`inline-block` 会破坏中文行首禁则，
 * 在混排文本里把标点甩到行首——这条是本项目踩过的老坑，别改成 inline-block。
 */

import { useMemo, type ReactNode } from "react"
import { phonicClass, segmentPhonics } from "../lib/phonics"
import { usePhonicsColor } from "../lib/phonicsPref"
interface PhonicsWordProps {
  /** 单个英文词（可带前后标点、撇号、连字符） */
  word: string
  /** 逐字符包装器——各页面注入自己的点读/高亮结构；返回节点由调用方自行带 key */
  wrapChar?: (ch: string, index: number) => ReactNode
  /** 显式开关；不传则跟随全局偏好（lib/phonicsPref） */
  enabled?: boolean
  /** 着色容器的 className（不传则不加外层，仅输出色块） */
  className?: string
}

export function PhonicsWord({ word, wrapChar, enabled, className }: PhonicsWordProps) {
  const [prefOn] = usePhonicsColor()
  const on = enabled ?? prefOn
  const chunks = useMemo(() => (on ? segmentPhonics(word) : null), [word, on])

  if (!chunks) {
    return (
      <>
        {[...word].map((ch, i) => (wrapChar ? wrapChar(ch, i) : ch))}
      </>
    )
  }

  const inner = (
    <>
      {chunks.map((c, ci) => (
        <span key={ci} className={`ph ${phonicClass(c.type)}`}>
          {[...c.text].map((ch, i) => (wrapChar ? wrapChar(ch, i) : ch))}
        </span>
      ))}
    </>
  )

  return className ? <span className={className}>{inner}</span> : inner
}

/** 整句 / 整段英文的逐词着色（只上色，不挂点读）。
 *  需要点读的场合请用 EnglishWordTap（它内部已经接了 PhonicsWord）。 */
export function PhonicsText({ text }: { text: string }) {
  const segs = useMemo(() => text.match(/\s+|\S+/g) ?? [], [text])
  return (
    <>
      {segs.map((s, i) =>
        /^\s+$/.test(s) ? <span key={i}>{s}</span> : <PhonicsWord key={i} word={s} />,
      )}
    </>
  )
}

/** 拼读着色开关 — 放在英文相关页面的 header 右侧（与 MnemonicToggle 同款外观）。
 *  状态与首页设置面板里的开关是同一份偏好，任一处切换全站联动。 */
export function PhonicsToggle() {
  const [on, toggle] = usePhonicsColor()
  return (
    <button
      className={`phonics-toggle${on ? "" : " off"}`}
      onClick={toggle}
      aria-pressed={on}
      title="按发音规律给英文单词着色（也可以到首页「⚙️ 设置」里切换）"
    >
      {on ? "🎨 彩色拼读" : "🎨 黑白显示"}
    </button>
  )
}
