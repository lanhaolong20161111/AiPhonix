/** 评测明细组件 — 单词→音素得分；句子→每词得分（可选点词展开音素）
 *
 * `expandable` 默认 false ⇒ 行为与旧版逐字一致（句子只列词分，DOM 不变），
 * 只有显式开启的页面才会把词渲染成可点按钮、展开该词的音素明细。
 *
 * `tips` 默认 false ⇒ 低分音素旁边加一句「怎么改」的发音要领。
 * 本地表（lib/phonicsTips.ts）立刻出文案，LLM 补充到了再替换（见 hooks/usePhoneTips）。
 */

import { useMemo, useState } from "react"
import type { SoeResult, SoeWord } from "../lib/soeApi"
import { arpabetToIpa, pinyinPhoneToDisplay, type PronStyle } from "../lib/arpabet"
import { formatSoeScore, soeScoreClass } from "../lib/soeDisplay"
import { phoneTip } from "../lib/phonicsTips"
import { usePhoneTips, type TipOverride } from "../hooks/usePhoneTips"

/** 按评测引擎选择音素显示：中文/拼音（16k_zh）→ 拼音部件；英文 → IPA */
function formatPhone(phone: string, engine: string, style: PronStyle): string {
  if (engine.includes("zh")) return pinyinPhoneToDisplay(phone)
  return arpabetToIpa(phone, style)
}

/** 低分音素的要领文案：优先用 LLM 补充，回退本地表；都没有则 null（不渲染） */
function tipText(phone: string, engine: string, overrides?: Map<string, TipOverride>): string | null {
  if (engine.includes("zh")) return null // 中文拼音不走英文口型要领表
  return overrides?.get(phone)?.tip ?? phoneTip(phone)?.tip ?? null
}

/** 音素小胶囊列表（单词分支与句子分支展开时共用） */
function PhoneChips({
  phones,
  engine,
  style,
  showTips = false,
  overrides,
}: {
  phones: SoeWord["phone_infos"]
  engine: string
  style: PronStyle
  showTips?: boolean
  overrides?: Map<string, TipOverride>
}) {
  // 只在**得分低但读到了**的音素上给技巧：
  // - miss（漏读 -1/2）：问题是「没读出来」，要领帮不上，改用提示重读（见单词分支）
  // - good/ok：读对了，不需要干扰
  const needy = showTips ? phones.filter((p) => soeScoreClass(p.accuracy, p.match_tag) === "bad") : []
  const tipFor = new Map<string, string>()
  if (showTips) {
    for (const p of needy) {
      const t = tipText(p.phone, engine, overrides)
      if (t) tipFor.set(p.phone, t)
    }
  }

  return (
    <>
      <div className="soe-phone-row">
        {phones.map((p, i) => {
          const cls = soeScoreClass(p.accuracy, p.match_tag)
          const miss = cls === "miss"
          const tip = tipFor.get(p.phone)
          return (
            <div key={i} className={`soe-phone-item${miss ? " miss" : ""}${tip ? " needy" : ""}`}>
              <span className={`soe-phone-sym${miss ? " miss" : ""}`}>{formatPhone(p.phone, engine, style)}</span>
              <span className={`soe-phone-score ${cls}`}>{formatSoeScore(p.accuracy, p.match_tag)}</span>
            </div>
          )
        })}
      </div>
      {tipFor.size > 0 && (
        <ul className="soe-tip-list">
          {phones.map((p, i) => {
            const tip = tipFor.get(p.phone)
            if (!tip) return null
            return (
              <li key={i} className="soe-tip">
                <span className="soe-tip-sym">{formatPhone(p.phone, engine, style)}</span>
                <span className="soe-tip-text">{tip}</span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function SoeDetail({
  result,
  style = "uk",
  sentenceTitle = "单词得分",
  expandable = false,
  /** 低分音素旁给发音要领（默认关闭，保持其余调用页 DOM 不变） */
  tips = false,
  /** 要领针对的「参考文本」（用于让 LLM 结合具体词给提示）；缺省用被测词本身 */
  tipRefText,
}: {
  result: SoeResult
  style?: PronStyle
  sentenceTitle?: string
  /** 句子模式下是否允许点击单词展开其音素明细（默认关闭，保持旧行为） */
  expandable?: boolean
  /** 是否给低分音素加发音要领（默认关闭） */
  tips?: boolean
  /** 要领对应的参考文本（LLM 补充用） */
  tipRefText?: string
}) {
  // Hook 必须在任何提前 return 之前调用
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const words = result.words ?? []
  const engine = result.engine ?? ""

  // 收集需要 LLM 补充的「词 + 低分音素」，一次性请求。
  // ⚠️ 这个 useMemo 必须在提前 return 之前（Hook 顺序稳定）。
  // 展开的单词优先；没有任何展开时用单词评测的唯一那个词。
  const requests = useMemo(() => {
    if (!tips || engine.includes("zh")) return []
    const out: Array<{ word: string; phone: string; score: number }> = []
    const push = (word: string, infos: SoeWord["phone_infos"]) => {
      for (const p of infos ?? []) {
        if (soeScoreClass(p.accuracy, p.match_tag) !== "bad") continue
        out.push({ word, phone: p.phone, score: p.accuracy })
      }
    }
    if (words.length === 1) push(tipRefText ?? words[0].word, words[0].phone_infos)
    else if (openIdx != null && words[openIdx]) {
      const w = words[openIdx]
      push(w.word, w.phone_infos)
    }
    return out
  }, [tips, engine, words, openIdx, tipRefText])

  const overrides = usePhoneTips(requests)

  if (words.length === 0) return null

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
    const allMiss = phones.every((p) => soeScoreClass(p.accuracy, p.match_tag) === "miss")
    return (
      <div className="soe-detail">
        <div className="soe-detail-title">音素得分</div>
        <PhoneChips phones={phones} engine={engine} style={style} showTips={tips} overrides={overrides} />
        <div className="soe-word-note">
          词：{w.word} · 单词分 {formatSoeScore(w.accuracy, w.match_tag)}
        </div>
        {tips && allMiss && (
          <div className="soe-detail-hint">没听到发音，靠近麦克风再读一次试试</div>
        )}
      </div>
    )
  }

  // ── 句子评测：每词得分（可选点词展开音素） ──
  return (
    <div className="soe-detail">
      <div className="soe-detail-title">
        {sentenceTitle}
        {expandable && <span className="soe-detail-hint">点单词看音素{tips ? "和发音技巧" : ""}</span>}
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
                  <PhoneChips
                    phones={phones}
                    engine={engine}
                    style={style}
                    showTips={tips}
                    overrides={overrides}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
