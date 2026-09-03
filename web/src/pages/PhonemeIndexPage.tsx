/** 音素索引页 — 48 个国际音标按类别分组，点击进详情页；点击音标符号直接播放发音 */

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getAllPhonemes, PHONEME_CATEGORY_NAMES, type Phoneme, type PhonemeCategory } from "../services/wordbankEnglish"
import { audioManager } from "../lib/audioManager"
import { useGlobalSpeaking } from "../hooks/useTts"
import { API_BASE } from "../services/config"
import { useMnemonicVisible } from "../lib/mnemonicPref"
import { MnemonicToggle } from "../components/MnemonicToggle"

const CATEGORY_ORDER: PhonemeCategory[] = [
  "LONG_VOWEL", "SHORT_VOWEL", "DIPHTHONG", "CONSONANT", "FRICATIVE", "NASAL", "PLOSIVE",
]

export function PhonemeIndexPage() {
  const navigate = useNavigate()
  const speaking = useGlobalSpeaking()
  const [mnVisible, toggleMn] = useMnemonicVisible()
  const [phonemes, setPhonemes] = useState<Phoneme[]>([])
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    void getAllPhonemes().then((p) => {
      setPhonemes(p)
      setLoading(false)
    })
  }, [])

  // 播放结束 → 复位高亮
  useEffect(() => {
    if (!speaking) setPlaying(null)
  }, [speaking])

  const playIpa = (ipa: string) => {
    const sym = ipa.replace(/^\/|\/$/g, "")
    if (playing === sym && speaking) {
      audioManager.stop()
      setPlaying(null)
      return
    }
    const url = `${API_BASE}/ipa-audio?file=${encodeURIComponent(sym + ".aac")}`
    if (audioManager.playUrl(url)) setPlaying(sym)
  }

  if (loading) {
    return <div className="page center-page"><p className="empty">加载音素…</p></div>
  }

  const grouped = new Map<PhonemeCategory, Phoneme[]>()
  for (const cat of CATEGORY_ORDER) {
    const items = phonemes.filter((p) => p.category === cat)
    if (items.length > 0) grouped.set(cat, items)
  }

  return (
    <div className="page phoneme-index-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>自然拼读 / 音素</h1>
        <MnemonicToggle visible={mnVisible} onToggle={toggleMn} />
      </header>
      <p className="module-hint">点音标进详情，点符号直接听发音</p>

      {[...grouped.entries()].map(([cat, items]) => (
        <div key={cat} className="phoneme-group">
          <h2 className="section-title">{PHONEME_CATEGORY_NAMES[cat]}（{items.length}）</h2>
          <div className="phoneme-grid">
            {items.map((p) => {
              const sym = p.symbol.replace(/^\/|\/$/g, "")
              const isPlaying = playing === sym && speaking
              return (
                <div
                  key={p.symbol}
                  className={`phoneme-cell${isPlaying ? " playing" : ""}`}
                  onClick={() => navigate(`/module/phoneme/${encodeURIComponent(p.symbol)}`)}
                >
                  <span
                    className="phoneme-symbol"
                    onClick={(e) => {
                      e.stopPropagation()
                      playIpa(p.symbol)
                    }}
                  >
                    {p.symbol}
                  </span>
                  <span className="phoneme-desc">{mnVisible ? (p.mnemonic || p.category) : p.category}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
