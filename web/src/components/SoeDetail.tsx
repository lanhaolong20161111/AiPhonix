/** 评测明细组件 — 单词→音素得分；句子→每词得分（共用） */

import type { SoeResult } from "../lib/soeApi"
import { arpabetToIpa, pinyinPhoneToDisplay, type PronStyle } from "../lib/arpabet"

/** 按评测引擎选择音素显示：中文/拼音（16k_zh）→ 拼音部件；英文 → IPA */
function formatPhone(phone: string, engine: string, style: PronStyle): string {
  if (engine.includes("zh")) return pinyinPhoneToDisplay(phone)
  return arpabetToIpa(phone, style)
}

export function SoeDetail({ result, style = "uk", sentenceTitle = "单词得分" }: { result: SoeResult; style?: PronStyle; sentenceTitle?: string }) {
  const words = result.words ?? []
  if (words.length === 0) return null

  // 单词评测（words.length === 1）：展示每个音素得分
  if (words.length === 1) {
    const w = words[0]
    const phones = w.phone_infos ?? []
    if (phones.length === 0) return null
    const engine = result.engine ?? ""
    return (
      <div className="soe-detail">
        <div className="soe-detail-title">音素得分</div>
        <div className="soe-phone-row">
          {phones.map((p, i) => (
            <div key={i} className="soe-phone-item">
              <span className="soe-phone-sym">{formatPhone(p.phone, engine, style)}</span>
              <span className={`soe-phone-score${phoneScoreClass(p.accuracy)}`}>
                {Math.round(p.accuracy)}
              </span>
            </div>
          ))}
        </div>
        <div className="soe-word-note">
          词：{w.word} · 单词分 {Math.round(w.accuracy)}
        </div>
      </div>
    )
  }

  // 句子评测：每词得分
  return (
    <div className="soe-detail">
      <div className="soe-detail-title">{sentenceTitle}</div>
      <div className="soe-word-row">
        {words.map((w, i) => (
          <div key={i} className={`soe-word-item ${phoneScoreClass(w.accuracy)}`}>
            <span className="soe-word-text">{w.word}</span>
            <span className="soe-word-score">{Math.round(w.accuracy)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function phoneScoreClass(score: number): string {
  if (score >= 80) return "good"
  if (score >= 60) return "ok"
  return "bad"
}
