/** 拼音详情页 — 横向滑动切换 声母/韵母/整体认读音节，每个音素配例字可发音 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { getAllPinyinItems, PINYIN_CATEGORY_NAMES, type PinyinItem, type PinyinCategory } from "../../data/pinyinTable"
import { audioManager } from "../../lib/audioManager"
import { pinyinAudioUrl } from "../../services/aichinese"
import { useTts } from "../../hooks/useTts"
import { scheduleSwipeSnap } from "../../lib/swipeSnap"
import { useMnemonicVisible } from "../../lib/mnemonicPref"
import { MnemonicToggle } from "../../components/MnemonicToggle"

interface PinyinData {
  category: PinyinCategory
  item: PinyinItem
}

export function PinyinDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [all, setAll] = useState<PinyinData[]>([])
  const [current, setCurrent] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const targetIdxRef = useRef(0)
  const snapTimer = useRef<number | undefined>(undefined)
  const currentRef = useRef(0)
  const playingRef = useRef<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const { speak } = useTts()
  const [mnVisible, toggleMn] = useMnemonicVisible()

  useEffect(() => {
    const data = getAllPinyinItems()
    setAll(data)
    const idx = data.findIndex((d) => d.item.id === decodeURIComponent(id ?? ""))
    targetIdxRef.current = idx >= 0 ? idx : 0
    currentRef.current = targetIdxRef.current
    setCurrent(targetIdxRef.current)
  }, [id])

  useEffect(() => () => audioManager.stop(), [])
  useEffect(() => () => window.clearTimeout(snapTimer.current), [])

  // 加载完成后滚动到目标音素所在屏
  useEffect(() => {
    if (all.length === 0) return
    const el = scrollRef.current
    if (!el) return
    const target = targetIdxRef.current
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({ left: target * el.clientWidth, behavior: "auto" })
      })
    })
  }, [all.length])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    scheduleSwipeSnap(el, snapTimer, () => currentRef.current, (target) => {
      if (target === currentRef.current) return
      currentRef.current = target
      setCurrent(target)
      audioManager.stop()
      setPlaying(null)
    })
  }, [])

  const scrollTo = (idx: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" })
  }

  const playAudio = (key: string, file: string) => {
    if (playingRef.current === key) {
      audioManager.stop()
      playingRef.current = null
      setPlaying(null)
      return
    }
    if (audioManager.playUrl(pinyinAudioUrl(file))) {
      playingRef.current = key
      setPlaying(key)
    }
  }

  if (all.length === 0) {
    return <div className="page center-page"><p className="empty">加载拼音…</p></div>
  }

  const cur = all[current]

  return (
    <div className="page pinyin-detail-page swipe-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>{PINYIN_CATEGORY_NAMES[cur.category]}</h1>
        <span className="module-level">{current + 1}/{all.length}</span>
        <MnemonicToggle visible={mnVisible} onToggle={toggleMn} />
      </header>

      <div className="swipe-nav">
        <div className="swipe-dots">
          {all.map((_, i) => (
            <span key={i} className={`swipe-dot${i === current ? " active" : ""}`} onClick={() => scrollTo(i)} />
          ))}
        </div>
      </div>
      <p className="swipe-hint">← 左右滑动切换 →</p>

      <div className="swipe-track-wrap">
        <button className="swipe-arrow overlay left" disabled={current === 0} onClick={() => scrollTo(current - 1)}>‹</button>
        <button className="swipe-arrow overlay right" disabled={current === all.length - 1} onClick={() => scrollTo(current + 1)}>›</button>
        <div className="swipe-track" ref={scrollRef} onScroll={onScroll}>
        {all.map((d) => (
          <section key={d.item.id} className="swipe-item">
            <div>
              <div className="phoneme-detail-head">
                <span className="phoneme-big">{d.item.label}</span>
                <button className="btn-primary" onClick={() => playAudio(d.item.id, d.item.audio)}>
                  {playing === d.item.id ? "⏹" : "▶"} 听发音
                </button>
              </div>
              {mnVisible && d.item.tip && <p className="phoneme-mnemonic">提示：{d.item.tip}</p>}

              <div className="card phoneme-points">
                <h2 className="section-title">例字</h2>
                <div className="pinyin-word-grid">
                  {d.item.examples.map((ex) => {
                    const key = `${d.item.id}-${ex.char}`
                    const isPl = playing === key
                    return (
                      <button
                        key={key}
                        className={`pinyin-word-btn${isPl ? " playing" : ""}`}
                        onClick={() => {
                          if (playing === key) {
                            audioManager.stop()
                            playingRef.current = null
                            setPlaying(null)
                            return
                          }
                          playingRef.current = key
                          setPlaying(key)
                          void speak(ex.char).finally(() => {
                            playingRef.current = null
                            setPlaying(null)
                          })
                        }}
                      >
                        <span className="pw-word">{ex.char}</span>
                        <span className="pw-pinyin">{ex.pinyin}</span>
                        <span className="pw-sound">{isPl ? "⏹" : "🔊"}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        ))}
        </div>
      </div>
    </div>
  )
}
