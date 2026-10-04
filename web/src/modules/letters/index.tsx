/** 26 个英文字母索引页 — 点击字母进详情页；点击音标名直接播放发音 */

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getAllLetters, type Letter } from "../../services/wordbankEnglish"
import { audioManager } from "../../lib/audioManager"
import { useGlobalSpeaking } from "../../hooks/useTts"

/** 字母名读音分组：i 长音 /i:/ → 蓝、e → 绿、ei → 橙（帮孩子区分易混字母名发音） */
function letterNameGroup(ipa: string): "i" | "e" | "ei" | null {
  if (ipa.includes("ei") || ipa.includes("eɪ")) return "ei"
  if (ipa.includes("i:") || ipa.includes("iː")) return "i"
  if (ipa.startsWith("/e")) return "e"
  return null
}

export function LetterIndexPage() {
  const navigate = useNavigate()
  const speaking = useGlobalSpeaking()
  const [letters, setLetters] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    void getAllLetters().then((l) => {
      setLetters(l)
      setLoading(false)
    })
  }, [])

  // 播放结束 → 复位高亮
  useEffect(() => {
    if (!speaking) setPlaying(null)
  }, [speaking])

  const playLetter = (l: Letter) => {
    const sym = l.uppercase
    if (playing === sym && speaking) {
      audioManager.stop()
      setPlaying(null)
      return
    }
    const file = `${sym}_${String(l.order).padStart(2, "0")}.mp3`
    const url = `/web/alphabet_audio/${file}`
    if (audioManager.playUrl(url)) setPlaying(sym)
  }

  if (loading) {
    return <div className="page center-page"><p className="empty">加载字母…</p></div>
  }

  return (
    <div className="page letter-index-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>26 个英文字母</h1>
      </header>
      <p className="module-hint">点字母进详情，点下面的音标直接听发音</p>

      <div className="letter-grid">
        {letters.map((l) => {
          const isPlaying = playing === l.uppercase && speaking
          const grp = letterNameGroup(l.ipaName)
          const imgName = `${l.uppercase}${l.lowercase}.png`
          return (
            <div
              key={l.char}
              className={`letter-cell${isPlaying ? " playing" : ""}${grp ? ` grp-${grp}` : ""}`}
              onClick={() => navigate(`/module/letter/${l.char}`)}
            >
              <div className="letter-writing-box">
                <img
                  className="letter-writing-img"
                  src={`/web/letters_writing/${imgName}`}
                  alt={`${l.uppercase}${l.lowercase}`}
                  loading="lazy"
                />
              </div>
              <span
                className="letter-ipa"
                onClick={(e) => {
                  e.stopPropagation()
                  playLetter(l)
                }}
              >
                {l.ipaName}
              </span>
            </div>
          )
        })}
      </div>
      <p className="module-hint letter-legend">
        <span className="legend-dot dot-i">i:</span> 长音 i ·
        <span className="legend-dot dot-e">e</span> 短音 e ·
        <span className="legend-dot dot-ei">ei</span> 双元音 ei
      </p>
    </div>
  )
}
