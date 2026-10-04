/** 音素详情页 — 横向滑动切换 48 个音素（scroll-snap 分页） */

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  getAllPhonemes, getWordsForPhoneme, getEnglishWordsForPhoneme,
  PHONEME_CATEGORY_NAMES, type Phoneme,
} from "../../services/wordbankEnglish"
import { audioManager } from "../../lib/audioManager"
import { API_BASE } from "../../services/config"
import { scheduleSwipeSnap } from "../../lib/swipeSnap"
import { PhonemeChips } from "../../components/PhonemeChips"
import { PhonicsToggle, PhonicsWord } from "../../components/PhonicsWord"
import { useMnemonicVisible } from "../../lib/mnemonicPref"
import { MnemonicToggle } from "../../components/MnemonicToggle"

interface PhonemeData {
  phoneme: Phoneme
  exampleWords: { text: string; phonemes: string[] }[]
  englishWords: { word: string; phonetic: string; ipa_uk: string; emoji: string; phonemes: string[]; phonemes_uk: string[] }[]
}

export function PhonemeDetailPage() {
  const { symbol } = useParams<{ symbol: string }>()
  const navigate = useNavigate()
  const [all, setAll] = useState<PhonemeData[]>([])
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const targetIdxRef = useRef(0)
  const snapTimer = useRef<number | undefined>(undefined)
  const currentRef = useRef(0)
  const [mnVisible, toggleMn] = useMnemonicVisible()

  useEffect(() => {
    void (async () => {
      const phonemes = await getAllPhonemes()
      const data: PhonemeData[] = await Promise.all(
        phonemes.map(async (p) => {
      const [ws, ews] = await Promise.all([getWordsForPhoneme(p.symbol), getEnglishWordsForPhoneme(p.symbol)])
      const ex =
        ws.length > 0
          ? ws.slice(0, 5).map((w) => ({ text: w.text, phonemes: w.phonemes || [] }))
          : p.exampleWords.map((t) => ({ text: t, phonemes: [] }))
      return {
        phoneme: p,
        exampleWords: ex,
        englishWords: ews.map((w) => ({
          word: w.word,
          phonetic: w.phonetic,
          ipa_uk: w.ipa_uk,
          emoji: w.emoji,
          phonemes: w.phonemes || [],
          phonemes_uk: w.phonemes_uk || [],
        })),
      }
        }),
      )
      setAll(data)
      const idx = data.findIndex((d) => d.phoneme.symbol === decodeURIComponent(symbol ?? ""))
      targetIdxRef.current = idx >= 0 ? idx : 0
      currentRef.current = targetIdxRef.current
      setCurrent(targetIdxRef.current)
      setLoading(false)
    })()
  }, [symbol])

  useEffect(() => () => audioManager.stop(), [])
  useEffect(() => () => window.clearTimeout(snapTimer.current), [])

  // 加载完成后滚动容器就绪，滚动到目标音素所在屏
  useEffect(() => {
    if (loading || all.length === 0) return
    const el = scrollRef.current
    if (!el) return
    const target = targetIdxRef.current
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        el.scrollTo({ left: target * el.clientWidth, behavior: "auto" })
      })
      return raf2
    })
    return () => cancelAnimationFrame(raf1)
  }, [loading, all.length])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    scheduleSwipeSnap(el, snapTimer, () => currentRef.current, (target) => {
      if (target === currentRef.current) return
      currentRef.current = target
      setCurrent(target)
      audioManager.stop()
    })
  }, [])

  const scrollTo = (idx: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" })
  }

  if (loading) {
    return <div className="page center-page"><p className="empty">加载音素…</p></div>
  }
  if (all.length === 0) {
    return <div className="page center-card"><p className="empty">音素不存在</p><button className="btn-secondary" onClick={() => navigate(-1)}>返回</button></div>
  }

  const cur = all[current]
  const phoneme = cur.phoneme

  return (
    <div className="page phoneme-detail-page swipe-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>{PHONEME_CATEGORY_NAMES[phoneme.category]}</h1>
        <span className="module-level">{current + 1}/{all.length}</span>
        <PhonicsToggle />
        <MnemonicToggle visible={mnVisible} onToggle={toggleMn} />
      </header>

      {/* 滑动指示（翻页箭头已移入卡片两侧） */}
      <div className="swipe-nav">
        <div className="swipe-dots">
          {all.map((_, i) => (
            <span key={i} className={`swipe-dot${i === current ? " active" : ""}`} onClick={() => scrollTo(i)} />
          ))}
        </div>
      </div>
      <p className="swipe-hint">← 左右滑动切换音标 →</p>

      {/* 横向滑动容器（左右箭头覆盖在两侧） */}
      <div className="swipe-track-wrap">
        <button className="swipe-arrow overlay left" disabled={current === 0} onClick={() => scrollTo(current - 1)}>‹</button>
        <button className="swipe-arrow overlay right" disabled={current === all.length - 1} onClick={() => scrollTo(current + 1)}>›</button>
        <div className="swipe-track" ref={scrollRef} onScroll={onScroll}>
        {all.map((d) => (
          <section key={d.phoneme.symbol} className="swipe-item">
            <PhonemePane
              data={d}
              mnVisible={mnVisible}
              onNavigate={navigate}
              playSound={() => {
                const sym = d.phoneme.symbol.replace(/^\/|\/$/g, "")
                const url = `${API_BASE}/ipa-audio?file=${encodeURIComponent(sym + ".aac")}`
                audioManager.playUrl(url)
              }}
            />
          </section>
        ))}
        </div>
      </div>
    </div>
  )
}

function PhonemePane({
  data, mnVisible, onNavigate, playSound,
}: {
  data: PhonemeData
  mnVisible: boolean
  onNavigate: (path: string) => void
  playSound: () => void
}) {
  const { phoneme, exampleWords, englishWords } = data

  return (
    <div>
      <div className="phoneme-detail-head">
        <span className="phoneme-big">{phoneme.symbol}</span>
        <button className="btn-primary" onClick={playSound}>▶ 听发音</button>
      </div>
      {mnVisible && phoneme.mnemonic && <p className="phoneme-mnemonic">口诀：{phoneme.mnemonic}</p>}

      <div className="card phoneme-points">
        <p><b>发音要领：</b>{phoneme.description}</p>
        <p><b>舌位：</b>{phoneme.tonguePosition}</p>
        <p><b>唇形：</b>{phoneme.lipShape}</p>
        {phoneme.commonMistakes.length > 0 && (
          <p><b>常见错误：</b>{phoneme.commonMistakes.join("；")}</p>
        )}
      </div>

      {exampleWords.length > 0 && (
        <div className="phoneme-words">
          <h2 className="section-title">练习单词</h2>
          <div className="phoneme-word-grid">
            {exampleWords.map((w) => (
              <button key={w.text} className="phoneme-word-btn" onClick={() => onNavigate(`/module/pronounce/${w.text}`)}>
                <span className="pw-word"><PhonicsWord word={w.text} /></span>
                <PhonemeChips phonemes={w.phonemes} />
              </button>
            ))}
          </div>
        </div>
      )}

      {englishWords.length > 0 && (
        <div className="phoneme-english">
          <h2 className="section-title" style={{ color: "#2563eb" }}>三年级上词汇</h2>
          <div className="english-words-chips">
            {englishWords.map((w) => (
              <button key={w.word} className="english-word-chip" onClick={() => onNavigate(`/module/pronounce/${w.word}`)}>
                <span>{w.emoji || "🔤"}</span>
                <b><PhonicsWord word={w.word} /></b>
                <PhonemeChips phonemes={w.phonemes_uk || w.phonemes} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
