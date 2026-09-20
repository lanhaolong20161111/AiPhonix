/** 拼读色卡图例 — 说明六种颜色分别代表什么（设置页展示）。
 *
 * 示例词用 PhonicsWord 强制着色（enabled），即使全局开关关掉了也照样显示颜色，
 * 否则图例会变成一排没有颜色的"说明"。
 *
 * 末尾的说明很要紧：这套颜色是**拼写规律**推出来的，不是查词典得来的。
 * 英语例外密度高（read / wind 同形异音、have / love 的 magic-e 例外），
 * 与其让孩子把颜色当成"绝对正确"，不如直说它是"规律提示"。
 */

import { PHONIC_LABELS, type PhonicType } from "../lib/phonics"
import { PhonicsWord } from "./PhonicsWord"

/** 每类颜色的示范词（选最典型的；组合元音给两个，成音节也是常见的一类） */
const SWATCH: Record<PhonicType, string> = {
  "vowel-single": "cat",
  "vowel-long": "cake",
  "vowel-team": "book",
  digraph: "ship",
  silent: "knife",
  consonant: "sun",
  other: "",
}

export function PhonicsLegend() {
  return (
    <div className="phonics-legend">
      {PHONIC_LABELS.map(({ type, name, hint }) => (
        <div className="phonics-legend-row" key={type}>
          <span className="phonics-legend-swatch">
            <PhonicsWord word={SWATCH[type]} enabled />
          </span>
          <span className="phonics-legend-text">
            <b>{name}</b> — {hint}
          </span>
        </div>
      ))}
      <p className="phonics-legend-note">
        颜色是按<b>拼写规律</b>推出来的，帮你看清一个词由哪几个音块拼成。
        英语里有些词拼法一样、读法不同（比如 <PhonicsWord word="read" enabled /> 可以是「读」也可以是「读过」），
        颜色只按最常见的一种标；拿不准时，以老师或词典的读音为准。
      </p>
    </div>
  )
}
