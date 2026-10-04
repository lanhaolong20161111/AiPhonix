/** 拼音练习页 — 看拼音读，SOE 评测，总分≥70 过关 */

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { fetchPinyinLevel, pinyinAudioUrl, type PinyinWord, type PinyinPart } from "../../services/aichinese"
import { useSoeScore } from "../../hooks/useSoeScore"
import { audioManager } from "../../lib/audioManager"
import { useGlobalSpeaking } from "../../hooks/useTts"

const PASS_SCORE = 70

/**
 * 把扁平部件列表按音节分组（字与字之间）。
 * 分组规则：shengmu / zhengtiren 总是一个音节的第一个部件，遇到即开新组；
 * 其余部件（jiemu / yunmu）归入当前组。
 */
function groupPartsBySyllable(parts: PinyinPart[]): PinyinPart[][] {
  const groups: PinyinPart[][] = []
  for (const p of parts) {
    if (p.label === "shengmu" || p.label === "zhengtiren") {
      groups.push([p])
    } else {
      const cur = groups[groups.length - 1]
      if (cur) cur.push(p)
      else groups.push([p])
    }
  }
  return groups
}

export function PinyinPracticePage() {
  const navigate = useNavigate()
  const speaking = useGlobalSpeaking()
  const [levelIndex, setLevelIndex] = useState(1)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [passed, setPassed] = useState(false)
  const [recordingPinyin, setRecordingPinyin] = useState<string | null>(null)
  const [msg, setMsg] = useState("")

  // 页面卸载 / 路由切换 → 中断当前播放
  useEffect(() => () => audioManager.stop(), [])

  const levelQ = useQuery({
    queryKey: ["pinyin", "level", levelIndex],
    queryFn: () => fetchPinyinLevel("", 5),
  })

  const level = levelQ.data
  const words = level?.words ?? []
  const totalScore =
    scores && Object.keys(scores).length > 0
      ? Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length)
      : 0

  // 当前正在录音/评测的词（在 useSoeScore 前声明，供其回调使用）
  const recordingPinyinWord = words.find((w) => w.pinyin === recordingPinyin) ?? null

  const soe = useSoeScore(
    useCallback(
      () => ({
        refText: recordingPinyinWord?.hanzi ?? "",
        scene: "pinyin", // 拼音评测 → eval_mode=8（返回音素明细）
      }),
      [recordingPinyinWord],
    ),
  )

  const toggleRecord = async (word: PinyinWord) => {
    if (soe.state.recording) {
      // 停止 → 评分
      const score = await soe.stop()
      setRecordingPinyin(null)
      if (score !== null) {
        const newScores = { ...scores, [word.pinyin]: score }
        setScores(newScores)
        const vals = Object.values(newScores)
        const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        setMsg(`拼音 ${word.pinyin} 得分 ${score}`)
        if (avg >= PASS_SCORE && vals.length === words.length) {
          setPassed(true)
        }
      }
      return
    }
    if (recordingPinyin !== null || soe.state.evaluating) return
    setRecordingPinyin(word.pinyin)
    setMsg("")
    await soe.start()
  }

  const nextLevel = () => {
    setLevelIndex((i) => i + 1)
    setScores({})
    setPassed(false)
    setMsg("")
    setRecordingPinyin(null)
  }

  const retryLevel = () => {
    setScores({})
    setPassed(false)
    setMsg("")
    setRecordingPinyin(null)
  }

  if (levelQ.isLoading) {
    return (
      <div className="page center-page">
        <p className="empty">加载关卡…</p>
      </div>
    )
  }

  return (
    <div className="page pinyin-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <h1>🔤 拼音练习</h1>
        <span className="module-level">第 {levelIndex} 关</span>
      </header>
      <p className="module-hint">
        看着拼音读出来，读完后点 🎤 评测。总分 ≥70 才能进入下一关。
      </p>

      {words.length === 0 ? (
        <div className="card center-card">
          <p className="empty">本关没有可练的词，请重试</p>
          <button onClick={retryLevel}>重试</button>
        </div>
      ) : (
        <div className="pinyin-layout">
          {/* 词语列表 */}
          <div className="pinyin-words">
            {words.map((w) => {
              const s = scores[w.pinyin]
              const isRecording = recordingPinyin === w.pinyin
              return (
                <div
                  key={w.pinyin}
                  className={`pinyin-word-card${s !== undefined ? " scored" : ""}${isRecording ? " recording" : ""}`}
                >
                  <div className="pinyin-word-hanzi">{w.hanzi}</div>
                  <div className="pinyin-word-pinyin">
                    {w.pinyin
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean)
                      .map((syl, si) => (
                        <span key={si} className="pinyin-syllable">
                          {syl}
                        </span>
                      ))}
                  </div>
                  <div className="pinyin-word-parts">
                    {groupPartsBySyllable(w.parts).map((group, gi) => (
                      <span key={gi} className="part-group">
                        {group.map((p, i) => (
                          <span key={i} className="part-chip">
                            <span className="part-text">{p.text}</span>
                            <button
                              className="part-play"
                              disabled={speaking}
                              onClick={() => {
                                if (!speaking) audioManager.playUrl(pinyinAudioUrl(p.audio))
                              }}
                              title="听发音"
                            >
                              🔊
                            </button>
                          </span>
                        ))}
                      </span>
                    ))}
                  </div>
                  <button
                    className={`mic-btn${isRecording ? " recording" : ""}${soe.state.evaluating ? " disabled" : ""}`}
                    disabled={soe.state.evaluating || (recordingPinyin !== null && !isRecording)}
                    onClick={() => toggleRecord(w)}
                  >
                    {isRecording
                      ? "⏹ 停止并评分"
                      : soe.state.evaluating && recordingPinyin === w.pinyin
                        ? "评分中…"
                        : "🎤 评测"}
                  </button>
                  {s !== undefined && (
                    <span className={`pinyin-score${s >= PASS_SCORE ? " pass" : " fail"}`}>
                      {s} 分
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* 总分区 */}
          <div className="pinyin-total card">
            <div className={`pinyin-total-score${totalScore >= PASS_SCORE ? " pass" : ""}`}>
              {totalScore}
            </div>
            <p>本关总分（≥70 过关）</p>
            {soe.state.recording && <p className="rec-hint">🔴 正在录音，读完后点「停止并评分」</p>}
            {msg && <p className="msg">{msg}</p>}
            {soe.state.error && <p className="err">{soe.state.error}</p>}

            {passed ? (
              <div className="pass-panel">
                <p className="all-done">🎉 过关！得分 {totalScore}</p>
                <button onClick={nextLevel}>下一关 →</button>
              </div>
            ) : (
              <button onClick={retryLevel} disabled={Object.keys(scores).length === 0}>
                重测本关
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
