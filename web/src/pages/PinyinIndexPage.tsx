/** 拼音表索引页 — 声母/韵母/整体认读音节 按类别分组，点击进详情页；点符号直接发音 */

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { SHENGMU, YUNMU, ZHENGTI, PINYIN_CATEGORY_NAMES, type PinyinCategory, type PinyinItem } from "../data/pinyinTable"
import { SHENGMU_MNEMONIC, YUNMU_MNEMONIC, ZHENGTI_MNEMONIC } from "../data/pinyinMnemonic"
import { audioManager } from "../lib/audioManager"
import { pinyinAudioUrl } from "../services/aichinese"
import { useMnemonicVisible } from "../lib/mnemonicPref"
import { MnemonicToggle } from "../components/MnemonicToggle"

const MNEMONIC_MAP: Record<PinyinCategory, Record<string, string>> = {
  shengmu: SHENGMU_MNEMONIC,
  yunmu: YUNMU_MNEMONIC,
  zhengti: ZHENGTI_MNEMONIC,
}

const CATEGORY_ORDER: PinyinCategory[] = ["shengmu", "yunmu", "zhengti"]

const DATA: Record<PinyinCategory, PinyinItem[]> = {
  shengmu: SHENGMU,
  yunmu: YUNMU,
  zhengti: ZHENGTI,
}

export function PinyinIndexPage() {
  const navigate = useNavigate()
  const [playing, setPlaying] = useState<string | null>(null)
  const playingRef = useRef<string | null>(null)
  const [mnVisible, toggleMn] = useMnemonicVisible()

  useEffect(() => () => audioManager.stop(), [])

  const playPinyin = (item: PinyinItem) => {
    if (playingRef.current === item.id) {
      audioManager.stop()
      playingRef.current = null
      setPlaying(null)
      return
    }
    if (audioManager.playUrl(pinyinAudioUrl(item.audio))) {
      playingRef.current = item.id
      setPlaying(item.id)
    }
  }

  return (
    <div className="page pinyin-index-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>拼音表</h1>
        <MnemonicToggle visible={mnVisible} onToggle={toggleMn} />
      </header>
      <p className="module-hint">点拼音进详情，点符号直接听发音</p>

      {CATEGORY_ORDER.map((cat) => {
        const items = DATA[cat]
        return (
          <div key={cat} className="phoneme-group">
            <h2 className="section-title">{PINYIN_CATEGORY_NAMES[cat]}（{items.length}）</h2>
            <div className="phoneme-grid">
              {items.map((p) => {
                const isPlaying = playing === p.id
                const mnemonic = MNEMONIC_MAP[cat][p.id] || ""
                return (
                  <div
                    key={p.id}
                    className={`phoneme-cell${isPlaying ? " playing" : ""}`}
                    onClick={() => navigate(`/module/pinyin/${encodeURIComponent(p.id)}`)}
                  >
                    {mnVisible && mnemonic && <span className="phoneme-mnemonic">{mnemonic}</span>}
                    <span
                      className="phoneme-symbol"
                      onClick={(e) => {
                        e.stopPropagation()
                        playPinyin(p)
                      }}
                    >
                      {p.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
