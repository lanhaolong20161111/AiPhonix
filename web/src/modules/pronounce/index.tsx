/** 发音评分页 — 单词朗读，SOE 评分 + 音素热图 */

import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { getAllWords, getAllEnglishWords, type Word, type EnglishWordEntry } from "../../services/wordbankEnglish"
import { useSoeScore } from "../../hooks/useSoeScore"
import { useTts } from "../../hooks/useTts"
import { usePronStyle } from "./usePronStyle"
import { SoeDetail } from "../../components/SoeDetail"
import { PhonicsWord } from "../../components/PhonicsWord"
import { audioManager } from "../../lib/audioManager"
import { API_BASE } from "../../services/config"
import type { PronStyle } from "../../lib/arpabet"

interface DisplayWord {
  text: string
  ipa: string
  phonemes: string[]
  emoji: string
  letter: string
}

export function PronunciationPage() {
  const { wordId } = useParams<{ wordId: string }>()
  const navigate = useNavigate()
  const [word, setWord] = useState<DisplayWord | null>(null)
  const [loading, setLoading] = useState(true)
  const [recSeconds, setRecSeconds] = useState(0)
  const [playingPh, setPlayingPh] = useState<string | null>(null)
  const { style, setStyle } = usePronStyle()

  const { speaking, speak } = useTts()

  // 播放结束 → 复位音素高亮
  useEffect(() => {
    if (!speaking) setPlayingPh(null)
  }, [speaking])

  const playPhoneme = (ph: string) => {
    const sym = ph.replace(/^\/|\/$/g, "")
    if (playingPh === ph && speaking) {
      audioManager.stop()
      setPlayingPh(null)
      return
    }
    const url = `${API_BASE}/ipa-audio?file=${encodeURIComponent(sym + ".aac")}`
    if (audioManager.playUrl(url)) setPlayingPh(ph)
  }

  const soe = useSoeScore(
    // 单英文单词 → word 模式（eval_mode=0，返回音素明细）
    useCallback(() => ({ refText: word?.text ?? "", engine: "16k_en", scene: "word" }), [word]),
  )

  useEffect(() => {
    void (async () => {
      if (!wordId) return
      const [allWords, englishWords] = await Promise.all([
        getAllWords(), getAllEnglishWords(),
      ])
      let w: Word | undefined = allWords.find((x) => x.text === wordId)
      let d: DisplayWord | null = null
      if (w) {
        // 按英/美风格选 ipa 和 phonemes
        d = style === "uk"
          ? { text: w.text, ipa: w.ipa_uk || w.ipa, phonemes: w.phonemes_uk?.length ? w.phonemes_uk : w.phonemes, emoji: w.emoji, letter: w.letter }
          : { text: w.text, ipa: w.ipa, phonemes: w.phonemes, emoji: w.emoji, letter: w.letter }
      } else {
        const ew: EnglishWordEntry | undefined = englishWords.find((x) => x.word === wordId)
        if (ew) {
          d = {
            text: ew.word,
            ipa: style === "uk" ? (ew.ipa_uk || ew.phonetic) : ew.phonetic,
            phonemes: style === "uk" && ew.phonemes_uk?.length ? ew.phonemes_uk : ew.phonemes,
            emoji: ew.emoji,
            letter: ew.word[0]?.toLowerCase() ?? "",
          }
        }
      }
      setWord(d)
      setLoading(false)
    })()
  }, [wordId, style])

  const toggleRecord = async () => {
    if (soe.state.recording) {
      await soe.stop()
      setRecSeconds(0)
    } else {
      setRecSeconds(0)
      await soe.start()
    }
  }

  // 录音期间计时
  useEffect(() => {
    if (!soe.state.recording) return
    setRecSeconds(0)
    const t = setInterval(() => setRecSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [soe.state.recording])

  if (loading) {
    return <div className="page center-page"><p className="empty">加载…</p></div>
  }
  if (!word) {
    return <div className="page center-card"><p className="empty">单词不存在</p><button className="btn-secondary" onClick={() => navigate(-1)}>返回</button></div>
  }

  return (
    <div className="page pronunciation-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>发音练习</h1>
        <PronStyleToggle style={style} setStyle={setStyle} />
      </header>

      <div className="pron-word-card card">
        <div className="pron-word-emoji">{word.emoji || "🔤"}</div>
        <div className="pron-word-text"><PhonicsWord word={word.text} /></div>
        <div className="pron-word-ipa">{word.ipa}</div>

        <div className="pron-phonemes">
          {word.phonemes.map((ph, i) => {
            const key = ph
            const isPlaying = playingPh === ph && speaking
            return (
              <button
                key={`${key}-${i}`}
                className={`pron-phoneme${isPlaying ? " playing" : ""}`}
                onClick={() => playPhoneme(ph)}
                title="点击听音素发音"
              >
                /{ph}/
              </button>
            )
          })}
        </div>

        <div className="pron-actions">
          <button className="btn-secondary" disabled={speaking} onClick={() => speak(word.text)}>
            🔊 参考发音
          </button>
          <button
            className={soe.state.recording ? "btn-danger" : "btn-primary"}
            disabled={soe.state.evaluating}
            onClick={toggleRecord}
          >
            {soe.state.recording ? "⏹ 停止并评分" : soe.state.evaluating ? "评分中…" : "🎤 读一读"}
          </button>
        </div>

        {soe.state.recording && (
          <>
            <div className="level-bar" style={{ marginTop: 14 }}>
              <div
                className="level-fill"
                style={{ width: `${Math.max(4, Math.min(100, soe.state.level * 100))}%` }}
              />
            </div>
            <p className="level-text">
              ⏱ {recSeconds}s ·{" "}
              {soe.state.level < 0.02
                ? "⚠ 没检测到声音，请靠近麦克风并大声读"
                : soe.state.level < 0.1
                  ? "声音较小，请大声一点"
                  : "✓ 检测到声音，请清楚完整地读出单词"}
            </p>
          </>
        )}

        {soe.state.error && <p className="err">{soe.state.error}</p>}

        {soe.state.score !== null && (
          <>
            <div className={`pron-score${soe.state.score >= 80 ? " good" : soe.state.score >= 60 ? " ok" : " bad"}`}>
              {soe.state.score} 分
              {soe.state.score < 60 && (
                <div className="pron-score-tip">可能没录到声音，或读的内容与单词不符。先听「参考发音」再读。</div>
              )}
            </div>
            {soe.state.result && <SoeDetail result={soe.state.result} style={style} />}
          </>
        )}
      </div>
    </div>
  )
}

/** 英式/美式音标记法切换 */
function PronStyleToggle({ style, setStyle }: { style: PronStyle; setStyle: (s: PronStyle) => void }) {
  return (
    <div className="pron-style-toggle">
      <button
        className={`pron-style-btn${style === "uk" ? " active" : ""}`}
        onClick={() => setStyle("uk")}
      >
        英式
      </button>
      <button
        className={`pron-style-btn${style === "us" ? " active" : ""}`}
        onClick={() => setStyle("us")}
      >
        美式
      </button>
    </div>
  )
}
