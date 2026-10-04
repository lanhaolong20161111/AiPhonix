/** 视频跟读页 — Big Muzzy 选集播放 + 逐句跟读评测（手动模式）
 *
 * 流程：选集 → 加载字幕 → 用户播放视频 → 当前字幕实时显示
 *   → 点「🎤 跟读这句」开始录音 → 再点「⏹ 停止并评分」评分
 *   → 评分存入 sentenceScores + 本地续练进度
 *   → 视频播完后显示本集总结
 *   → 重听原音 / A/B 对比 / 跳句 / 续练 / 重练错句全部保留
 *
 * 历史备注：旧版有自动跟读（靠 SRT 时间戳自动暂停 + VAD 静音检测），
 * 因 SRT 时间戳对不齐配音节奏、用户体验差，2026-09 整体移除。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { parseSrt, toSentences, findCurrentSubtitle, isPauseAligned, type SubtitleEntry } from "../../lib/srtParser"
import { useSoeScore } from "../../hooks/useSoeScore"
import { SoeDetail } from "../../components/SoeDetail"
import { PhonicsText } from "../../components/PhonicsWord"
import { pcmToWavBlob } from "../../lib/pcmToWav"
import { api } from "../../services/api"

interface VideoItem {
  name: string
  title: string
  videoUrl: string
  srtUrl: string
}

/** SRT 内容版本号：更新 R2 上的 SRT 后 +1，请求带 ?v= 绕开浏览器 24h 缓存 */
const SRT_CACHE_VER = "6"

// 服务端 videos 目录（Ep01-03 手工校对，Ep04-12 豆包 SeedASR AUC 生成）
const VIDEOS: VideoItem[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({
  name: `Ep${String(n).padStart(2, "0")}`,
  title: `Big Muzzy 第 ${n} 集`,
  videoUrl: `/videos/Big_Muzzy_Ep${String(n).padStart(2, "0")}.mp4`,
  srtUrl: `/videos/Big_Muzzy_Ep${String(n).padStart(2, "0")}.en.srt`,
}))

/** 通过线：总分超过此值视为达标（用于总结通过率/错句判断；不再触发自动播放） */
const PASS_SCORE = 70

type VideoIssueType = "audio_pause" | "subtitle_timing" | "subtitle_text" | "other"

const VIDEO_ISSUE_TYPES: Array<{ value: VideoIssueType; label: string }> = [
  { value: "audio_pause", label: "声音停顿不准" },
  { value: "subtitle_timing", label: "字幕时间不准" },
  { value: "subtitle_text", label: "字幕内容不准" },
  { value: "other", label: "其他问题" },
]

/** 续练进度 localStorage key：值 = { name: "Ep04", index: 7 }（练到第 7 句） */
const PROGRESS_KEY = "videoPractice.progress"

export interface ProgressData {
  name: string
  /** 上次练到的句子（SRT 块号） */
  index: number
}

/** 读取续练进度；无 / 数据损坏 → null */
function loadProgress(): ProgressData | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    if (
      v && typeof v === "object" &&
      typeof (v as ProgressData).name === "string" &&
      typeof (v as ProgressData).index === "number"
    ) {
      return v as ProgressData
    }
    return null
  } catch {
    return null // localStorage 不可用 / JSON 损坏：不阻断主流程
  }
}

/** 写入续练进度；传 null 表示清除（本集练完） */
function saveProgress(data: ProgressData | null): void {
  try {
    if (data) localStorage.setItem(PROGRESS_KEY, JSON.stringify(data))
    else localStorage.removeItem(PROGRESS_KEY)
  } catch {
    /* 隐私模式/配额满：进度记忆是增强功能，失败不影响跟读 */
  }
}

export function VideoPracticePage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<VideoItem | null>(null)
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([])
  const [currentSub, setCurrentSub] = useState<SubtitleEntry | null>(null)
  const [practiceText, setPracticeText] = useState("")
  const [lastScore, setLastScore] = useState<number | null>(null)
  /** 视频是否已播完（自然结束或用户拖到末尾） */
  const [videoEnded, setVideoEnded] = useState(false)
  /** 语速档位（0.75/1/1.25） */
  const [rate, setRate] = useState(1)
  /** 逐句得分：字幕 index -> 总分（用于进度列表 + 成绩总结） */
  const [sentenceScores, setSentenceScores] = useState<Record<number, number>>({})
  /** 逐句列表展开开关 */
  const [showList, setShowList] = useState(false)
  /** 当前展开的问题反馈句子；反馈表单在句子列表内展开 */
  const [reportingIndex, setReportingIndex] = useState<number | null>(null)
  const [reportIssueType, setReportIssueType] = useState<VideoIssueType>("audio_pause")
  const [reportDescription, setReportDescription] = useState("")
  const [reportStatus, setReportStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [reportMessage, setReportMessage] = useState("")
  const [reportedIndices, setReportedIndices] = useState<Set<number>>(() => new Set())
  /** 最近一次录音的 WAV 播放地址（A/B 对比回放）；null=本集还没成功录音 */
  const [lastRecUrl, setLastRecUrl] = useState<string | null>(null)
  /** 续练提示：{name, index} = 上次练到的集与句子；null=无 */
  const [resumeHint, setResumeHint] = useState<{ name: string; index: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  /** 当前语速（ref 同步，避免闭包过期） */
  const rateRef = useRef(1)
  /** 正在「重听原音」：播放到 endMs 自动暂停（null=未在重听） */
  const replayUntilRef = useRef<number | null>(null)
  /** 程序内 seek 抑制标志：重听/跳句时设置，onSeeked 里据此跳过重置逻辑 */
  const suppressSeekRef = useRef(false)
  /** A/B 对比：重听原音结束后是否自动播自己的录音 */
  const pendingCompareRef = useRef(false)
  /** 录音 URL 的持有引用（卸载时 revoke，避免 Blob 泄漏） */
  const lastRecUrlRef = useRef<string | null>(null)
  /** 最近一次录音对应的字幕 index */
  const lastRecEntryRef = useRef<number | null>(null)
  const compareAudioRef = useRef<HTMLAudioElement | null>(null)
  /** 视频加载失败标志（onError 触发，显示重试按钮） */
  const [videoErr, setVideoErr] = useState(false)
  /** 视频加载长时间无进展（10s 仍无数据 → 提示大文件缓冲慢） */
  const [videoSlow, setVideoSlow] = useState(false)
  /** 视频缓存击穿参数：重试时换 URL 绕过浏览器里可能缓存的坏响应（视频响应 max-age=86400） */
  const [videoBust, setVideoBust] = useState(0)
  /** 加载慢检测定时器 */
  const slowTimerRef = useRef<number | null>(null)

  const soe = useSoeScore(
    useCallback(() => ({ refText: practiceText, engine: "16k_en", scene: "sentence" }), [practiceText]),
  )
  // soe.stop 的引用会随 practiceText 变化，异步回调里一律经 ref 取最新，避免闭包过期
  const soeRef = useRef(soe)
  soeRef.current = soe

  // ── §2.3 本集成绩总结（数据源同 §2.2 的 sentenceScores） ──
  const summary = useMemo(() => {
    const scored = Object.values(sentenceScores)
    const passed = scored.filter((s) => s > PASS_SCORE).length
    const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0
    // 「未达标」= 已评分但没过线；跳过/未做的不算错句
    const wrong = subtitles.filter((s) => {
      const sc = sentenceScores[s.index]
      return sc != null && sc <= PASS_SCORE
    })
    return {
      scored: scored.length,
      total: subtitles.length,
      passed,
      avg,
      wrong,
      passRate: subtitles.length ? Math.round((passed / subtitles.length) * 100) : 0,
    }
  }, [sentenceScores, subtitles])

  // 卸载时释放最近一次录音的 Blob URL + 清加载慢定时器（避免泄漏）
  useEffect(() => {
    return () => {
      if (lastRecUrlRef.current) {
        URL.revokeObjectURL(lastRecUrlRef.current)
        lastRecUrlRef.current = null
      }
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current)
        slowTimerRef.current = null
      }
    }
  }, [])

  // 选集：加载字幕 + 重置跟读状态 + 读取该集续练进度
  const selectVideo = async (v: VideoItem) => {
    setSelected(v)
    setPracticeText("")
    setCurrentSub(null)
    setLastScore(null)
    setVideoEnded(false)
    setSentenceScores({})
    setShowList(false)
    setReportingIndex(null)
    setReportDescription("")
    setReportStatus("idle")
    setReportMessage("")
    setReportedIndices(new Set())
    // 换集：释放上一集的录音 Blob URL，避免累积泄漏
    if (lastRecUrlRef.current) {
      URL.revokeObjectURL(lastRecUrlRef.current)
      lastRecUrlRef.current = null
    }
    setLastRecUrl(null)
    replayUntilRef.current = null
    suppressSeekRef.current = false
    pendingCompareRef.current = false
    lastRecEntryRef.current = null
    setVideoErr(false)
    setVideoSlow(false)
    soe.reset()
    // 续练：上次练到同一集 → 记住句子序号，渲染时给出「继续上次」入口
    const saved = loadProgress()
    setResumeHint(saved && saved.name === v.name ? saved : null)
    try {
      // SRT 内容更新时靠 bump 此版本号绕开浏览器 24h 缓存（R2 响应 max-age=86400）
      const resp = await fetch(`${v.srtUrl}?v=${SRT_CACHE_VER}`)
      const srt = await resp.text()
      // PAUSE-ALIGNED SRT（离线按声学停顿重切）已是测评对象粒度，直接信任块边界；
      // 普通 SRT 仍按标点合并成完整句子粒度，避免在半句话处出现字幕闪烁
      const parsed = parseSrt(srt)
      setSubtitles(isPauseAligned(srt) ? parsed : toSentences(parsed))
    } catch {
      setSubtitles([])
    }
  }

  // 视频时间同步字幕 + 重听原音到点暂停
  const onTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return

    // 重听原音（replaySentence）：只放这句，到 endMs 自动暂停；A/B 对比时接播自己的录音
    if (replayUntilRef.current !== null) {
      if (video.currentTime * 1000 >= replayUntilRef.current) {
        video.pause()
        replayUntilRef.current = null
        if (pendingCompareRef.current) {
          pendingCompareRef.current = false
          compareAudioRef.current?.play().catch(() => {})
        }
      }
      return // 重听期间不更新当前字幕
    }

    const sub = findCurrentSubtitle(subtitles, video.currentTime * 1000)
    // 有新字幕才更新显示；句间间隙（sub=null）保留上一句字幕直到下一句出现，避免字幕闪烁消失
    if (sub && sub.index !== currentSub?.index) {
      setCurrentSub(sub)
      setPracticeText(sub.text)
      setLastScore(null) // 切到新句子时清掉上一次得分（避免误以为刚评的是这句）
    }
  }

  // 视频自然结束：标记 done，但不自动暂停/不强迫录音
  const onEnded = () => {
    setVideoEnded(true)
  }

  /** 用户拖动进度条/跳转后清除「重听原音」状态；
   * 程序内 seek（重听原音/跳句）会先置 suppressSeekRef，这里跳过重置避免打断重听 */
  const onSeeked = () => {
    if (suppressSeekRef.current) {
      suppressSeekRef.current = false
      return
    }
    replayUntilRef.current = null // 用户拖动中断重听原音
    pendingCompareRef.current = false
  }

  /** 手动评分完成回调：写入 sentenceScores + 续练进度 + 取最近一次录音 PCM 做 A/B 回放 */
  const handleManualScore = (score: number | null) => {
    if (score === null || !currentSub) return
    setLastScore(score)
    setSentenceScores((prev) => ({ ...prev, [currentSub.index]: score }))
    if (selected) saveProgress({ name: selected.name, index: currentSub.index })
    // §2.5 A/B 回放：取本次录音原始 PCM → 拼 WAV 头 → Blob URL（先 revoke 上一个，防 Blob 泄漏）
    const pcm = soeRef.current.lastPcmRef.current
    if (pcm) {
      if (lastRecUrlRef.current) URL.revokeObjectURL(lastRecUrlRef.current)
      const url = URL.createObjectURL(pcmToWavBlob(pcm))
      lastRecUrlRef.current = url
      lastRecEntryRef.current = currentSub.index
      setLastRecUrl(url)
    }
  }

  const toggleRecord = async () => {
    if (soe.state.recording) {
      // stop() 直接返回最新 score（不是 soe.state.score：setState 异步，立即读会拿到旧值）
      const score = await soe.stop()
      handleManualScore(score)
    } else {
      // 录音前先暂停视频：① 防止视频声音混进麦克风污染评测；② 视频暂停后
      // onTimeUpdate 停止触发 → 字幕/practiceText 不会在录音中切句，保证参考文本正确
      videoRef.current?.pause()
      await soe.start()
    }
  }

  // ── §2.4 语速调节 ──
  /** 切换语速：同步 state + ref，并立即作用到 video 元素（换集/重加载时由 onLoadedMetadata 重新套用） */
  const changeRate = (r: number) => {
    setRate(r)
    rateRef.current = r
    if (videoRef.current) videoRef.current.playbackRate = r
  }

  // ── §2.1 重听原音 ──
  /**
   * 只播放这一句（startMs → endMs），到点由 onTimeUpdate 自动暂停。
   * @param thenCompare true = 放完原音接播学生自己的录音（A/B 对比，§2.5）
   */
  const replaySentence = (entry: SubtitleEntry, thenCompare = false) => {
    const video = videoRef.current
    if (!video) return
    suppressSeekRef.current = true // onSeeked 里跳过重置，避免把这次程序内 seek 当成用户拖动
    replayUntilRef.current = entry.endMs
    pendingCompareRef.current = thenCompare
    setCurrentSub(entry)
    setPracticeText(entry.text)
    setLastScore(null)
    setResumeHint(null)
    video.playbackRate = rateRef.current
    video.currentTime = entry.startMs / 1000
    video.play().catch(() => {
      /* 自动播放被浏览器拦截：用户可手动点播放，不影响其它逻辑 */
    })
  }

  // ── §2.2 跳句 ──
  /** 跳到指定句开头播放（逐句列表 / 续练 / 错句重练共用） */
  const jumpToSentence = (entry: SubtitleEntry) => {
    const video = videoRef.current
    if (!video) return
    // 录音中先终止，避免把这段录音算到别的句子上
    if (soeRef.current.state.recording) void soeRef.current.stop()
    suppressSeekRef.current = true
    replayUntilRef.current = null
    pendingCompareRef.current = false
    setCurrentSub(entry)
    setPracticeText(entry.text)
    setLastScore(null)
    setResumeHint(null)
    setVideoEnded(false)
    video.playbackRate = rateRef.current
    video.currentTime = entry.startMs / 1000
    video.play().catch(() => {
      /* 自动播放被浏览器拦截：用户可手动点播放 */
    })
    if (selected) saveProgress({ name: selected.name, index: entry.index })
  }

  // ── 问题反馈 ──
  const openIssueReport = (entry: SubtitleEntry) => {
    setReportingIndex((current) => (current === entry.index ? null : entry.index))
    setReportIssueType("audio_pause")
    setReportDescription("")
    setReportStatus("idle")
    setReportMessage("")
  }

  const submitIssueReport = async (entry: SubtitleEntry) => {
    const description = reportDescription.trim()
    if (!selected || !description || reportStatus === "submitting") return
    setReportStatus("submitting")
    setReportMessage("")
    try {
      const result = await api<{ status: string; message?: string }>("/video-issues", {
        method: "POST",
        body: {
          videoName: selected.name,
          subtitleIndex: entry.index,
          sentenceText: entry.text,
          issueType: reportIssueType,
          description,
        },
        timeoutMs: 10000,
      })
      setReportedIndices((previous) => {
        const next = new Set(previous)
        next.add(entry.index)
        return next
      })
      setReportStatus("success")
      setReportMessage(result.message ?? "问题已提交，感谢反馈")
    } catch (error) {
      setReportStatus("error")
      setReportMessage(error instanceof Error ? error.message : "提交失败，请稍后重试")
    }
  }

  // ── §2.3 重练错句 ──
  /** 把未达标的句子状态清回「未做」，并跳到第一句错句重新进入循环 */
  const retryWrong = () => {
    if (summary.wrong.length === 0) return
    setSentenceScores((prev) => {
      const next = { ...prev }
      for (const s of summary.wrong) delete next[s.index]
      return next
    })
    setVideoEnded(false)
    jumpToSentence(summary.wrong[0])
  }

  if (!selected) {
    return (
      <div className="page video-practice-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>视频跟读</h1>
        </header>
        <p className="module-hint">选择一集，看视频跟读练发音 · 播放视频，点「跟读这句」录音评分，超过 70 分视为达标</p>
        <div className="import-list">
          {VIDEOS.map((v) => (
            <button key={v.name} className="article-row" onClick={() => selectVideo(v)}>
              <div className="import-body">
                <div className="import-text">{v.title}</div>
                <div className="import-meaning">Big Muzzy 英语启蒙 · 逐句跟读评测</div>
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
          src={`${selected.videoUrl}?v=${videoBust}`}
          controls={!soe.state.recording}
          playsInline
          onTimeUpdate={onTimeUpdate}
          onSeeked={onSeeked}
          onEnded={onEnded}
          onError={() => {
            setVideoErr(true)
            if (slowTimerRef.current) {
              clearTimeout(slowTimerRef.current)
              slowTimerRef.current = null
            }
          }}
          // 拿到可播数据（首帧就绪）→ 清掉「加载慢」提示与定时器
          onCanPlay={() => {
            setVideoSlow(false)
            if (slowTimerRef.current) {
              clearTimeout(slowTimerRef.current)
              slowTimerRef.current = null
            }
          }}
          // 开始加载新视频：起一个 10s 定时器，超时还没到可播状态就提示大文件缓冲慢
          onWaiting={() => {
            const v = videoRef.current
            if (v && v.readyState < 3) {
              setVideoSlow(true)
              if (slowTimerRef.current) clearTimeout(slowTimerRef.current)
              slowTimerRef.current = window.setTimeout(() => {
                const el = videoRef.current
                if (el && el.readyState < 3) setVideoSlow(true)
              }, 10000)
            }
          }}
          // 换集会重置 playbackRate：重新套用用户选择的语速
          onLoadedMetadata={() => {
            if (videoRef.current) videoRef.current.playbackRate = rateRef.current
          }}
        />
        {/* 视频加载失败：显示重试（换 cache-bust 参数强制重新请求，绕开浏览器坏缓存） */}
        {videoErr && (
          <div className="video-suggest" style={{ marginTop: 8 }}>
            ⚠️ 视频加载失败
            <button
              className="btn-primary"
              style={{ width: "auto", marginLeft: 8, padding: "4px 14px" }}
              onClick={() => {
                setVideoErr(false)
                setVideoBust(Date.now())
              }}
            >
              🔄 重试加载
            </button>
          </div>
        )}
        {/* 加载慢（非失败）：提示文件较大，请耐心等待 */}
        {videoSlow && !videoErr && (
          <div className="video-suggest" style={{ marginTop: 8 }}>
            ⏳ 视频较大（约 170MB/集），首次加载可能较慢，请耐心等待或检查网络
          </div>
        )}
        {/* A/B 对比回放：播放学生自己的录音（src 由 lastRecUrl 驱动） */}
        <audio ref={compareAudioRef} src={lastRecUrl ?? undefined} hidden />
      </div>

      {/* 当前字幕：方案 B 半自动高亮（active 类：未录音时高亮，引导学生现在跟读） */}
      <div className={`video-subtitle card${currentSub && !soe.state.recording && !soe.state.evaluating ? " active" : ""}`}>
        {currentSub ? (
          <>
            <div className="video-subtitle-text"><PhonicsText text={currentSub.text} /></div>
            {/* 方案 B：当前句未录音时显示提示，告知学生「听完一句就点跟读」 */}
            {!soe.state.recording && !soe.state.evaluating && (
              <div className="video-suggest">💡 点「跟读这句」会暂停视频开始录音，读完点「停止并评分」</div>
            )}
            <div className="essay-actions" style={{ justifyContent: "center", gap: 8 }}>
              <button
                className={soe.state.recording ? "btn-danger" : "btn-primary"}
                style={{ width: "auto", minWidth: 160 }}
                disabled={soe.state.evaluating || !practiceText}
                onClick={toggleRecord}
              >
                {soe.state.recording ? "⏹ 停止并评分" : soe.state.evaluating ? "评分中…" : "🎯 跟读这句"}
              </button>
            </div>
            {/* §2.1 重听原音 / §2.5 A/B 对比：先播原音，再播自己的录音 */}
            <div className="video-sub-actions">
              <button
                className="video-mini-btn"
                onClick={() => replaySentence(currentSub)}
                disabled={soe.state.recording}
                title="只播放这一句，听完再模仿"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5Z" fill="currentColor" stroke="none" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
                听原音
              </button>
              {lastRecUrl && lastRecEntryRef.current === currentSub.index && (
                <button
                  className="video-mini-btn alt"
                  onClick={() =>
                    replaySentence(
                      subtitles.find((s) => s.index === lastRecEntryRef.current) ?? currentSub,
                      true,
                    )
                  }
                  disabled={soe.state.recording}
                  title="先播原音，再播你刚才的录音，对比找差距"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 3h5v5" />
                    <path d="M4 20 21 3" />
                    <path d="M21 16v5h-5" />
                    <path d="m15 15 6 6" />
                    <path d="M4 4l5 5" />
                  </svg>
                  对比听
                </button>
              )}
            </div>
            {soe.state.recording && (
              <div className="level-bar" style={{ marginTop: 10 }}>
                <div className="level-fill" style={{ width: `${Math.max(4, Math.min(100, soe.state.level * 100))}%` }} />
              </div>
            )}
            {soe.state.error && <p className="err">{soe.state.error}</p>}
            {lastScore !== null && (
              <div className={`pron-score${lastScore >= 80 ? " good" : lastScore >= 60 ? " ok" : " bad"}`}>
                {lastScore} 分 {lastScore > PASS_SCORE ? "✅ 达标" : "❌ 未达标"}
              </div>
            )}
            {soe.state.score !== null && soe.state.score === lastScore && soe.state.result && (
              <SoeDetail result={soe.state.result} />
            )}
          </>
        ) : (
          <p className="empty">
            ▶ 播放视频，当前句会自动显示，可点「跟读这句」录音评分
          </p>
        )}
      </div>

      {/* 语速调节（§2.4） + 逐句列表开关（§2.2） + 续练入口（§2.6） */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="video-rate-row">
          <span className="video-rate-label">语速</span>
          {[0.75, 1, 1.25].map((r) => (
            <button
              key={r}
              className={`video-rate-btn${rate === r ? " active" : ""}`}
              aria-pressed={rate === r}
              onClick={() => changeRate(r)}
            >
              {r}×
            </button>
          ))}
          <button className="video-list-toggle" onClick={() => setShowList((v) => !v)}>
            {showList ? "📋 收起列表" : "📋 句子列表"}
          </button>
        </div>
        {resumeHint && (
          <div className="video-resume">
            <span className="video-resume-text">上次练到「{resumeHint.name}」第 {subtitles.findIndex((s) => s.index === resumeHint.index) + 1} 句</span>
            <button
              className="btn-primary"
              style={{ width: "auto" }}
              onClick={() => {
                const entry = subtitles.find((s) => s.index === resumeHint.index) ?? subtitles[0]
                if (entry) jumpToSentence(entry)
              }}
            >
              ▶ 继续上次
            </button>
          </div>
        )}
      </div>

      {/* 本集成绩总结（§2.3）：视频播完且至少评过一次展示 */}
      {videoEnded && summary.scored > 0 && (
        <div className="card video-summary">
          <div className="video-summary-title">🎉 本集跟读完成</div>
          <div className="video-summary-grid">
            <div className="video-summary-item">
              <span className="video-summary-num">{summary.scored}/{summary.total}</span>
              <span className="video-summary-label">已练句数</span>
            </div>
            <div className="video-summary-item">
              <span className="video-summary-num">{summary.avg}</span>
              <span className="video-summary-label">平均分</span>
            </div>
            <div className="video-summary-item">
              <span className="video-summary-num">{summary.passRate}%</span>
              <span className="video-summary-label">通过率</span>
            </div>
          </div>
          {summary.wrong.length > 0 ? (
            <>
              <div className="video-summary-wrong">未达标 {summary.wrong.length} 句（点单句可回练）：</div>
              <div className="video-summary-wrong-list">
                {summary.wrong.slice(0, 8).map((s) => (
                  <button
                    key={s.index}
                    className="video-summary-wrong-item"
                    onClick={() => jumpToSentence(s)}
                  >
                    <b>{sentenceScores[s.index]}分</b> {s.text}
                  </button>
                ))}
                {summary.wrong.length > 8 && (
                  <div className="video-summary-more">…还有 {summary.wrong.length - 8} 句</div>
                )}
              </div>
              <button className="btn-primary" onClick={retryWrong}>
                🔁 重练这 {summary.wrong.length} 句
              </button>
            </>
          ) : (
            <div className="video-summary-wrong">全部达标，太棒了！</div>
          )}
        </div>
      )}

      {/* 逐句进度列表（§2.2） */}
      {showList && (
        <div className="card video-sentence-list">
          {subtitles.length === 0 ? (
            <p className="empty">字幕尚未加载</p>
          ) : (
            subtitles.map((s, i) => {
              const sc = sentenceScores[s.index]
              const st = sc == null ? "todo" : sc > PASS_SCORE ? "pass" : "fail"
              const isCurrent = currentSub?.index === s.index
              const isReporting = reportingIndex === s.index
              const isReported = reportedIndices.has(s.index)
              return (
                <div
                  key={s.index}
                  className={`video-sentence-row state-${st}${isCurrent ? " current" : ""}`}
                >
                  <button
                    type="button"
                    className="video-sentence-main"
                    onClick={() => jumpToSentence(s)}
                    title={st === "pass" ? "已达标，点击回练" : st === "fail" ? "未达标，点击回练" : "未练习，点击开始"}
                  >
                    <span className="video-sentence-mark">
                      {st === "pass" ? "✅" : st === "fail" ? "❌" : "⬜"}
                    </span>
                    <span className="video-sentence-text">{i + 1}. <PhonicsText text={s.text} /></span>
                    {sc != null && <span className="video-sentence-score">{sc}分</span>}
                  </button>
                  <button
                    type="button"
                    className={`video-issue-btn${isReported ? " submitted" : ""}`}
                    onClick={() => openIssueReport(s)}
                    aria-expanded={isReporting}
                    title="反馈这句的声音停顿或字幕问题"
                  >
                    {isReported ? "已反馈" : "问题反馈"}
                  </button>
                  {isReporting && (
                    <form
                      className="video-issue-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void submitIssueReport(s)
                      }}
                    >
                      <div className="video-issue-title">反馈第 {i + 1} 句的问题</div>
                      <div className="video-issue-sentence">“{s.text}”</div>
                      <label className="video-issue-label">
                        问题类型
                        <select
                          value={reportIssueType}
                          onChange={(event) => setReportIssueType(event.target.value as VideoIssueType)}
                          disabled={reportStatus === "submitting"}
                        >
                          {VIDEO_ISSUE_TYPES.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="video-issue-label">
                        问题描述
                        <textarea
                          value={reportDescription}
                          onChange={(event) => setReportDescription(event.target.value)}
                          placeholder="请写明具体哪里不准，例如：第 3 秒应停顿，但现在连读了。"
                          maxLength={2000}
                          rows={3}
                          disabled={reportStatus === "submitting"}
                          required
                        />
                      </label>
                      <div className="video-issue-actions">
                        <button
                          type="submit"
                          className="btn-primary"
                          disabled={reportStatus === "submitting" || !reportDescription.trim()}
                        >
                          {reportStatus === "submitting" ? "提交中…" : "提交问题"}
                        </button>
                        <button
                          type="button"
                          className="video-mini-btn"
                          onClick={() => setReportingIndex(null)}
                          disabled={reportStatus === "submitting"}
                        >
                          取消
                        </button>
                      </div>
                      {reportMessage && (
                        <div className={`video-issue-message ${reportStatus === "error" ? "error" : "success"}`}>
                          {reportMessage}
                        </div>
                      )}
                    </form>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

    </div>
  )
}