/** 拼音部件 — 声母/韵母可单独点击发音（看图识字用） */

import { memo, useMemo } from "react"
import { pinyinChips } from "../lib/pinyin"
import { API_BASE } from "../services/config"
import { audioManager } from "../lib/audioManager"
import { useGlobalSpeaking } from "../hooks/useTts"
import { useMnemonicVisible } from "../lib/mnemonicPref"

/** memo：父页高频重渲染（录音电平等）时 pinyin 不变的卡跳过拼音重拆分 */
export const PinyinChips = memo(function PinyinChips({ pinyin }: { pinyin: string }) {
  const speaking = useGlobalSpeaking()
  const [mnVisible] = useMnemonicVisible()
  const rows = useMemo(() => pinyinChips(pinyin, API_BASE), [pinyin])

  if (!rows.length) return null

  const play = (url: string) => {
    if (speaking) return
    audioManager.playUrl(url)
  }

  return (
    <div className="pinyin-chips">
      {rows.map((row, i) => (
        <div key={i} className="pinyin-chips-row">
          {row.map((c) => (
            <button key={c.label + c.audioUrl} className="pinyin-chip" onClick={() => play(c.audioUrl)}>
              {mnVisible && c.mnemonic && <span className="pinyin-chip-mn">{c.mnemonic}</span>}
              <span className="pinyin-chip-label">{c.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
})
