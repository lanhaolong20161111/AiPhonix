/** 字母详情页 — 横向滑动切换 26 个字母（scroll-snap 分页） */

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  getAllLetters, getWordsForLetter, getEnglishWordsForLetter, getAllPhonemes,
  type Letter, type Word, type EnglishWordEntry,
} from "../services/wordbankEnglish"
import { useTts } from "../hooks/useTts"
import { audioManager } from "../lib/audioManager"
import { API_BASE } from "../services/config"
import { scheduleSwipeSnap } from "../lib/swipeSnap"
import { PhonemeChips } from "../components/PhonemeChips"
import { useMnemonicVisible } from "../lib/mnemonicPref"
import { MnemonicToggle } from "../components/MnemonicToggle"

interface LetterData {
  letter: Letter
  words: Word[]
  englishWords: EnglishWordEntry[]
}

export function LetterDetailPage() {
  const { char } = useParams<{ char: string }>()
  const navigate = useNavigate()
  const { speaking } = useTts()
  const [all, setAll] = useState<LetterData[]>([])
  const [mnemonics, setMnemonics] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState(0)
  const [playingIpa, setPlayingIpa] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const targetIdxRef = useRef(0)
  const snapTimer = useRef<number | undefined>(undefined)
   const currentRef = useRef(0)
  const [mnVisible, toggleMn] = useMnemonicVisible()

  // 加载全部字母数据（一次拉齐，滑动跟手）
  useEffect(() => {
    void (async () => {
      const [letters, phonemes] = await Promise.all([getAllLetters(), getAllPhonemes()])
      const data: LetterData[] = await Promise.all(
        letters.map(async (l) => ({
          letter: l,
          words: await getWordsForLetter(l.char),
          englishWords: await getEnglishWordsForLetter(l.char),
        })),
      )
      setAll(data)
      setMnemonics(Object.fromEntries(phonemes.map((p) => [p.symbol, p.mnemonic]).filter(([, m]) => m)))
      // 定位到 URL 指定的字母
      const idx = data.findIndex((d) => d.letter.char === char)
      targetIdxRef.current = idx >= 0 ? idx : 0
      currentRef.current = targetIdxRef.current
      setCurrent(targetIdxRef.current)
      setLoading(false)
    })()
  }, [char])

  // 页面卸载 → 停音频
  useEffect(() => () => audioManager.stop(), [])
  useEffect(() => () => window.clearTimeout(snapTimer.current), [])

  // 加载完成后滚动容器就绪，滚动到目标字母所在屏
  useEffect(() => {
    if (loading || all.length === 0) return
    const el = scrollRef.current
    if (!el) return
    const target = targetIdxRef.current
    // 等待布局完成（clientWidth 就绪）再滚动
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        el.scrollTo({ left: target * el.clientWidth, behavior: "auto" })
      })
      return raf2
    })
    return () => cancelAnimationFrame(raf1)
  }, [loading, all.length])

  // 滑动 → 松手后最多翻相邻一页再更新
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    scheduleSwipeSnap(el, snapTimer, () => currentRef.current, (target) => {
      if (target === currentRef.current) return
      currentRef.current = target
      setCurrent(target)
      setPlayingIpa(null)
      audioManager.stop()
    })
  }, [])

  const scrollTo = (idx: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" })
  }

  const playIpa = (ipa: string) => {
    if (playingIpa === ipa) {
      audioManager.stop()
      setPlayingIpa(null)
      return
    }
    const sym = ipa.replace(/^\/|\/$/g, "")
    const url = `${API_BASE}/ipa-audio?file=${encodeURIComponent(sym + ".aac")}`
    if (audioManager.playUrl(url)) setPlayingIpa(ipa)
  }

  const playLetterAudio = (l: Letter) => {
    const file = `${l.uppercase}_${String(l.order).padStart(2, "0")}.mp3`
    audioManager.playUrl(`/web/alphabet_audio/${file}`)
  }

  if (loading) {
    return <div className="page center-page"><p className="empty">加载字母…</p></div>
  }
  if (all.length === 0) {
    return <div className="page center-card"><p className="empty">字母数据不存在</p><button className="btn-secondary" onClick={() => navigate(-1)}>返回</button></div>
  }

  const cur = all[current]
  const letter = cur.letter

  return (
    <div className="page letter-detail-page swipe-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>字母 {letter.uppercase}</h1>
        <span className="module-level">{current + 1}/{all.length}</span>
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
      <p className="swipe-hint">← 左右滑动切换字母 →</p>

      {/* 横向滑动容器（左右箭头覆盖在两侧） */}
      <div className="swipe-track-wrap">
        <button className="swipe-arrow overlay left" disabled={current === 0} onClick={() => scrollTo(current - 1)}>‹</button>
        <button className="swipe-arrow overlay right" disabled={current === all.length - 1} onClick={() => scrollTo(current + 1)}>›</button>
        <div className="swipe-track" ref={scrollRef} onScroll={onScroll}>
        {all.map((d, i) => (
          <section key={d.letter.char} className="swipe-item">
            <LetterPane
              data={d}
              mnemonics={mnemonics}
              mnVisible={mnVisible}
              speaking={speaking}
              onSpeak={() => playLetterAudio(d.letter)}
              onPlayIpa={playIpa}
              playingIpa={i === current ? playingIpa : null}
              onNavigate={navigate}
            />
          </section>
        ))}
        </div>
      </div>
    </div>
  )
}

function LetterPane({
  data, mnemonics, mnVisible, speaking, onSpeak, onPlayIpa, playingIpa, onNavigate,
}: {
  data: LetterData
  mnemonics: Record<string, string>
  mnVisible: boolean
  speaking: boolean
  onSpeak: () => void
  onPlayIpa: (ipa: string) => void
  playingIpa: string | null
  onNavigate: (path: string) => void
}) {
  const { letter, words, englishWords } = data
  const videoUrl = `/letter-clips/letter_${letter.char}.mp4`

  return (
    <div>
      {/* 字母名发音 */}
      <div className="letter-detail-head">
        <span className="letter-detail-big">{letter.uppercase}{letter.lowercase}</span>
        <button className="btn-secondary" disabled={speaking} onClick={onSpeak}>
          {speaking ? "🔊" : "🔈"} 字母名
        </button>
        <span className="letter-detail-ipa">{letter.ipaName}</span>
      </div>

      {/* 字母常见发音 */}
      {letter.pronunciations.length > 0 && (
        <div className="letter-pronunciations">
          <span className="section-label">字母发音</span>
          <div className="ipa-chips">
            {letter.pronunciations.map((ipa) => (
              <button
                key={ipa}
                className={`ipa-chip${playingIpa === ipa ? " playing" : ""}`}
                disabled={speaking}
                onClick={() => onPlayIpa(ipa)}
              >
                <span>{playingIpa === ipa ? "🔊" : "🔈"}</span>
                <span className="ipa-sym">{ipa}</span>
                {mnVisible && mnemonics[ipa] && <span className="ipa-mnemonic">{mnemonics[ipa]}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 发音视频 */}
      <div className="letter-video-wrap">
        <video className="letter-video" src={videoUrl} controls playsInline preload="none" />
        <p className="video-hint">▶ 观看字母发音视频</p>
      </div>

      {/* 练习单词 */}
      <h2 className="section-title">练习单词</h2>
      {words.slice(0, 3).map((w) => (
        <button key={w.text} className="letter-word-row" onClick={() => onNavigate(`/module/pronounce/${w.text}`)}>
          <span className="letter-word-emoji">{w.emoji || "📝"}</span>
          <span className="letter-word-body">
            <b>{w.text}</b>
            <PhonemeChips phonemes={w.phonemes || w.phonemes_uk} />
          </span>
          <span className="letter-word-mic">🎤</span>
        </button>
      ))}

      {/* 三年级上词汇 */}
      {englishWords.length > 0 && (
        <div className="english-words-section">
          <h2 className="section-title" style={{ color: "#2563eb" }}>三年级上词汇</h2>
          <div className="english-words-chips">
            {englishWords.slice(0, 12).map((w) => (
              <button
                key={w.word}
                className="english-word-chip"
                onClick={() => onNavigate(`/module/pronounce/${w.word}`)}
              >
                <span>{w.emoji || "🔤"}</span>
                <b>{w.word}</b>
                <PhonemeChips phonemes={w.phonemes_uk || w.phonemes} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
