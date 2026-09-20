/** 评测明细组件 — 单词→音素得分；句子→每词得分（可选点词展开音素）
 *
 * `expandable` 默认 false ⇒ 行为与旧版逐字一致（句子只列词分，DOM 不变），
 * 只有显式开启的页面才会把词渲染成可点按钮、展开该词的音素明细。
 */

import { useState } from "react"
import type { SoeResult, SoeWord } from "../lib/soeApi"
import { arpabetToIpa, pinyinPhoneToDisplay, type PronStyle } from "../lib/arpabet"
import { formatSoeScore, soeScoreClass } from "../lib/soeDisplay"

/** 按评测引擎选择音素显示：中文/拼音（16k_zh）→ 拼音部件；英文 → IPA */
function formatPhone(phone: string, engine: string, style: PronStyle): string {
  if (engine.includes("zh")) return pinyinPhoneToDisplay(phone)
  return arpabetToIpa(phone, style)
}

/** 音素小胶囊列表（单词分支与句子分支展开时共用） */
function PhoneChips({ phones, engine, style }: { phones: SoeWord["phone_infos"]; engine: string; style: PronStyle }) {
  return (
    <div className="soe-phone-row">
      {phones.map((p, i) => {
        const cls = soeScoreClass(p.accuracy, p.match_tag)
        const miss = cls === "miss"
        return (
          <div key={i} className={`soe-phone-item${miss ? " miss" : ""}`}>
            <span className={`soe-phone-sym${miss ? " miss" : ""}`}>{formatPhone(p.phone, engine, style)}</span>
            <span className={`soe-phone-score ${cls}`}>{formatSoeScore(p.accuracy, p.match_tag)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function SoeDetail({
  result,
  style = "uk",
  sentenceTitle = "单词得分",
  expandable = false,
}: {
  result: SoeResult
  style?: PronStyle
  sentenceTitle?: string
  /** 句子模式下是否允许点击单词展开其音素明细（默认关闭，保持旧行为） */
  expandable?: boolean
}) {
  // Hook 必须在任何提前 return 之前调用
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const words = result.words ?? []
  if (words.length === 0) return null
  const engine = result.engine ?? ""

  // ── 单词评测（words.length === 1）：展示每个音素得分 ──
  if (words.length === 1) {
    const w = words[0]
    const phones = w.phone_infos ?? []
    const notDetected = formatSoeScore(w.accuracy, w.match_tag) === "未读"
    if (phones.length === 0) {
      // 引擎本来就给不出音素明细时维持旧行为（不渲染）；只有确实漏读才提示用户重读
      if (!notDetected) return null
      return (
        <div className="soe-detail">
          <div className="soe-detail-title">音素得分</div>
          <div className="soe-detail-empty">未检测到发音，请靠近麦克风再读一次</div>
        </div>
      )
    }
    return (
      <div className="soe-detail">
        <div className="soe-detail-title">音素得分</div>
        <PhoneChips phones={phones} engine={engine} style={style} />
        <div className="soe-word-note">
          词：{w.word} · 单词分 {formatSoeScore(w.accuracy, w.match_tag)}
        </div>
      </div>
    )
  }

  // ── 句子评测：每词得分（可选点词展开音素） ──
  return (
    <div className="soe-detail">
      <div className="soe-detail-title">
        {sentenceTitle}
        {expandable && <span className="soe-detail-hint">点单词看音素</span>}
      </div>
      <div className="soe-word-row">
        {words.map((w, i) => {
          const cls = soeScoreClass(w.accuracy, w.match_tag)
          const phones = w.phone_infos ?? []
          const inner = (
            <>
              <span className="soe-word-text">{w.word}</span>
              <span className="soe-word-score">{formatSoeScore(w.accuracy, w.match_tag)}</span>
            </>
          )

          // 未开启展开：保持与旧版**逐字一致**的 DOM（不给 .soe-word-row 引入包裹层），
          // 其余 7 个调用页因此零回归风险。
          if (!expandable) {
            return (
              <div key={i} className={`soe-word-item ${cls}`}>
                {inner}
              </div>
            )
          }

          const canOpen = phones.length > 0
          const open = openIdx === i
          return (
            <div key={i} className="soe-word-cell">
              {canOpen ? (
                <button
                  type="button"
                  className={`soe-word-item openable ${cls}${open ? " open" : ""}`}
                  onClick={() => setOpenIdx(open ? null : i)}
                  aria-expanded={open}
                  title={`查看 ${w.word} 的音素`}
                >
                  {inner}
                </button>
              ) : (
                <div className={`soe-word-item ${cls}`}>{inner}</div>
              )}
              {open && (
                <div className="soe-word-phones">
                  <PhoneChips phones={phones} engine={engine} style={style} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
