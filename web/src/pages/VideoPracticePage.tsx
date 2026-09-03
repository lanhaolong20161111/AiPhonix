/** 视频跟读页 — Big Muzzy 选集播放 + 实时字幕高亮 + 当前句跟读评分 */

import { useCallback, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { parseSrt, findCurrentSubtitle, type SubtitleEntry } from "../lib/srtParser"
import { useSoeScore } from "../hooks/useSoeScore"
import { SoeDetail } from "../components/SoeDetail"

interface VideoItem {
  name: string
  title: string
  videoUrl: string
  srtUrl: string
}

// 服务端 videos 目录（前 3 集已校对字幕）
const VIDEOS: VideoItem[] = [1, 2, 3].map((n) => ({
  name: `Ep${String(n).padStart(2, "0")}`,
  title: `Big Muzzy 第 ${n} 集`,
  videoUrl: `/videos/Big_Muzzy_Ep${String(n).padStart(2, "0")}.mp4`,
  srtUrl: `/videos/Big_Muzzy_Ep${String(n).padStart(2, "0")}.en.srt`,
}))

export function VideoPracticePage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<VideoItem | null>(null)
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([])
  const [currentSub, setCurrentSub] = useState<SubtitleEntry | null>(null)
  const [practiceText, setPracticeText] = useState("")
  const videoRef = useRef<HTMLVideoElement>(null)

  const soe = useSoeScore(
    useCallback(() => ({ refText: practiceText, engine: "16k_en", scene: "sentence" }), [practiceText]),
  )

  // 选集：加载字幕
  const selectVideo = async (v: VideoItem) => {
    setSelected(v)
    setPracticeText("")
    setCurrentSub(null)
    try {
      const resp = await fetch(v.srtUrl)
      const srt = await resp.text()
      setSubtitles(parseSrt(srt))
    } catch {
      setSubtitles([])
    }
  }

  // 视频时间同步字幕
  const onTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return
    const sub = findCurrentSubtitle(subtitles, video.currentTime * 1000)
    setCurrentSub(sub)
    if (sub && sub.text !== practiceText) {
      setPracticeText(sub.text)
    }
  }

  const toggleRecord = async () => {
    if (soe.state.recording) {
      await soe.stop()
    } else {
      await soe.start()
    }
  }

  if (!selected) {
    return (
      <div className="page video-practice-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>视频跟读</h1>
        </header>
        <p className="module-hint">选择一集，看视频跟读练发音</p>
        <div className="import-list">
          {VIDEOS.map((v) => (
            <button key={v.name} className="article-row" onClick={() => selectVideo(v)}>
              <div className="import-body">
                <div className="import-text">{v.title}</div>
                <div className="import-meaning">Big Muzzy 英语启蒙 · 跟读练发音</div>
              </div>
              <span className="essay-arrow">›</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="page video-practice-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => setSelected(null)}>←</button>
        <h1>{selected.title}</h1>
      </header>

      <div className="video-player-wrap card">
        <video
          ref={videoRef}
          className="video-player"
          src={selected.videoUrl}
          controls
          playsInline
          onTimeUpdate={onTimeUpdate}
        />
      </div>

      {/* 当前字幕 */}
      <div className="video-subtitle card">
        {currentSub ? (
          <>
            <div className="video-subtitle-text">{currentSub.text}</div>
            <div className="essay-actions" style={{ justifyContent: "center" }}>
              <button
                className={soe.state.recording ? "btn-danger" : "btn-primary"}
                disabled={soe.state.evaluating || !practiceText}
                onClick={toggleRecord}
              >
                {soe.state.recording ? "⏹ 停止并评分" : soe.state.evaluating ? "评分中…" : "🎤 跟读这句"}
              </button>
            </div>
            {soe.state.recording && (
              <div className="level-bar" style={{ marginTop: 10 }}>
                <div className="level-fill" style={{ width: `${Math.max(4, Math.min(100, soe.state.level * 100))}%` }} />
              </div>
            )}
            {soe.state.error && <p className="err">{soe.state.error}</p>}
            {soe.state.score !== null && (
              <>
                <div className={`pron-score${soe.state.score >= 80 ? " good" : soe.state.score >= 60 ? " ok" : " bad"}`}>
                  {soe.state.score} 分
                </div>
                {soe.state.result && <SoeDetail result={soe.state.result} />}
              </>
            )}
          </>
        ) : (
          <p className="empty">▶ 播放视频，当前句会自动显示，可跟读评分</p>
        )}
      </div>
    </div>
  )
}
