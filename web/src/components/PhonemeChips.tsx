/** 音素部件 — 单词音标的每个音素可单独点击发音（看图识字英词/英句用） */

import { memo, useEffect, useState } from "react"
import { API_BASE } from "../services/config"
import { audioManager } from "../lib/audioManager"
import { useGlobalSpeaking } from "../hooks/useTts"

/** memo：父页高频重渲染时 phonemes 不变的卡跳过重渲染 */
export const PhonemeChips = memo(function PhonemeChips({ phonemes }: { phonemes?: string[] | null }) {
  const speaking = useGlobalSpeaking()
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    if (!speaking) setPlaying(null)
  }, [speaking])

  if (!phonemes?.length) return null

  const play = (ph: string) => {
    const sym = ph.replace(/^\/|\/$/g, "")
    if (playing === sym && speaking) {
      audioManager.stop()
      setPlaying(null)
      return
    }
    const url = `${API_BASE}/ipa-audio?file=${encodeURIComponent(sym + ".aac")}`
    if (audioManager.playUrl(url)) setPlaying(sym)
  }

  return (
    <div className="phoneme-chips">
      {phonemes.map((ph) => {
        const sym = ph.replace(/^\/|\/$/g, "")
        const isPlaying = playing === sym && speaking
        return (
          <span
            key={ph}
            role="button"
            className={`phoneme-chip${isPlaying ? " playing" : ""}`}
            onClick={(e) => {
              e.stopPropagation()
              play(ph)
            }}
          >
            {sym}
          </span>
        )
      })}
    </div>
  )
})
