/** 视频跟读页 — Big Muzzy 选集播放 + 字幕自动暂停跟读评测
 *
 * 自动跟读模式（默认）：视频正常播放 → 读完一句话（字幕结束/换句停顿）自动暂停
 * → 自动开始录音评测这句话 → 总分 > 70 自动继续播放，如此循环直到视频结束。
 * 手动模式：保留原来的「跟读这句 / 停止并评分」按钮。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { parseSrt, toSentences, findCurrentSubtitle, type SubtitleEntry } from "../lib/srtParser"
import { useSoeScore } from "../hooks/useSoeScore"
import { SoeDetail } from "../components/SoeDetail"
import { pcmToWavBlob } from "../lib/pcmToWav"

interface VideoItem {
  name: string
  title: string
  videoUrl: string
  srtUrl: string
}

// 服务端 videos 目录（Ep01-03 手工校对，Ep04-12 豆包 SeedASR AUC 生成）
const VIDEOS: VideoItem[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({
  name: `Ep${String(n).padStart(2, "0")}`,
  title: `Big Muzzy 第 ${n} 集`,
  videoUrl: `/videos/Big_Muzzy_Ep${String(n).padStart(2, "0")}.mp4`,
  srtUrl: `/videos/Big_Muzzy_Ep${String(n).padStart(2, "0")}.en.srt`,
}))

/** 自动续播的达标总分（需求：超过 70 分自动继续播放） */
const AUTO_PASS_SCORE = 70
/** 自动停止录音的时长范围：句子时长 + 1.5s 缓冲，夹在 3s~8s */
const REC_MIN_MS = 3000
const REC_MAX_MS = 8000

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

/** 语音结束检测（VAD）：绝对静音阈值、相对峰值阈值、持续静音判定时长、最长等待时长（超时回退） */
const SILENCE_RMS = 0.03 // 绝对地板：RMS 低于此值必为静音
const SILENCE_PEAK_RATIO = 0.35 // 自适应：低于本句语音峰值 35% 视为静音（背景音乐下也能触发）
const SILENCE_PEAK_MIN = 0.06 // 峰值低于此值不启用相对判定（避免纯环境噪声误判）
const SILENCE_HOLD_MS = 180
const SILENCE_WAIT_MS = 1500

/** 已接入 Web Audio 图的媒体元素（createMediaElementSource 对同一元素只能调用一次） */
const wiredMedia = new WeakSet<HTMLMediaElement>()

/** 全局共享 Web Audio 图（AudioContext 单例：跨 StrictMode 重挂载/选集复用，避免反复 close 后再建导致接线失效） */
let sharedCtx: AudioContext | null = null
let sharedAnalyser: AnalyserNode | null = null
let sharedData: Uint8Array<ArrayBuffer> | null = null

type AutoStatus = "idle" | "playing" | "waiting" | "recording" | "paused" | "done"

export function VideoPracticePage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<VideoItem | null>(null)
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([])
  const [currentSub, setCurrentSub] = useState<SubtitleEntry | null>(null)
  const [practiceText, setPracticeText] = useState("")
  const [autoMode, setAutoMode] = useState(true)
  const [autoStatus, setAutoStatus] = useState<AutoStatus>("idle")
  const [needRetry, setNeedRetry] = useState(false)
  const [lastScore, setLastScore] = useState<number | null>(null)
  /** 语速档位（0.75/1/1.25） */
  const [rate, setRate] = useState(1)
  /** 逐句得分：字幕 index -> 总分（用于进度列表 + 成绩总结） */
  const [sentenceScores, setSentenceScores] = useState<Record<number, number>>({})
  /** 逐句列表展开开关 */
  const [showList, setShowList] = useState(false)
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

  const soe = useSoeScore(
    useCallback(() => ({ refText: practiceText, engine: "16k_en", scene: "sentence" }), [practiceText]),
  )
  // soe.stop 的引用会随 practiceText 变化，异步回调里一律经 ref 取最新，避免闭包过期
  const soeRef = useRef(soe)
  soeRef.current = soe

  // ── §2.3 本集成绩总结（数据源同 §2.2 的 sentenceScores） ──
  const summary = useMemo(() => {
    const scored = Object.values(sentenceScores)
    const passed = scored.filter((s) => s > AUTO_PASS_SCORE).length
    const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0
    // 「未达标」= 已评分但没过线；跳过/未做的不算错句
    const wrong = subtitles.filter((s) => {
      const sc = sentenceScores[s.index]
      return sc != null && sc <= AUTO_PASS_SCORE
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

  /** 上一个停留的字幕（用于检测「这句话读完了」的换句/停顿） */
  const prevEntryRef = useRef<SubtitleEntry | null>(null)
  /** 已过关/已跳过的字幕（按 SRT 块号去重，防重复触发） */
  const completedRef = useRef<Set<number>>(new Set())
  /** 正在录音评测中（防并发触发） */
  const busyRef = useRef(false)
  /** 自动停止录音的定时器 */
  const autoStopTimerRef = useRef<number | null>(null)
  /** 当前正在评测/待重试的字幕 */
  const captureRef = useRef<{ entry: SubtitleEntry; isLast: boolean } | null>(null)

  /** 静音检测 rAF 句柄 */
  const silenceRafRef = useRef<number | null>(null)
  /** 正在等待「语音结束」（换句已发生、尚未测到静音） */
  const waitingRef = useRef(false)

  // 卸载时清掉自动停止定时器 + 静音检测循环 + A/B 回放的 Blob URL
  // 注意：AudioContext 用模块级单例（sharedCtx），此处不 close，避免 StrictMode 双挂载后接线失效
  useEffect(() => {
    return () => {
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current)
        autoStopTimerRef.current = null
      }
      cancelSilenceWait()
      if (lastRecUrlRef.current) {
        URL.revokeObjectURL(lastRecUrlRef.current)
        lastRecUrlRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 建立 Web Audio 图：把 <video> 音频接到 AnalyserNode 读实时音量；失败返回 false（回退时间戳逻辑） */
  const ensureAudioGraph = (): boolean => {
    const video = videoRef.current
    if (!video) return false
    try {
      if (!sharedCtx) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return false
        sharedCtx = new Ctx()
      }
      // 每个 <video> 元素只能 createMediaElementSource 一次；切换选集重建元素时也要接线
      if (!wiredMedia.has(video)) {
        const ctx = sharedCtx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        const src = ctx.createMediaElementSource(video)
        src.connect(analyser)
        analyser.connect(ctx.destination) // 必须接回 destination，否则视频无声
        sharedAnalyser = analyser
        sharedData = new Uint8Array(analyser.fftSize)
        wiredMedia.add(video)
      }
      return true
    } catch {
      return false
    }
  }

  /** 读当前视频音量 RMS（0=静音, 1=满幅）；音频图未运行返回 1，避免误判静音 */
  const currentRms = (): number => {
    if (!sharedAnalyser || !sharedData || sharedCtx?.state !== "running") return 1
    sharedAnalyser.getByteTimeDomainData(sharedData)
    let sum = 0
    for (let i = 0; i < sharedData.length; i++) {
      const v = (sharedData[i] - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / sharedData.length)
  }

  /** 取消静音检测循环 */
  const cancelSilenceWait = () => {
    if (silenceRafRef.current !== null) {
      cancelAnimationFrame(silenceRafRef.current)
      silenceRafRef.current = null
    }
    waitingRef.current = false
  }

  /**
   * 换句后不立即暂停，而是等「视频声音真正静下来」再暂停录音（VAD 对齐语音结束）。
   * 兜底：SILENCE_WAIT_MS 内没测到静音 → 直接按时间戳暂停（旧行为）。
   */
  const armSilenceWait = (entry: SubtitleEntry, isLast: boolean) => {
    cancelSilenceWait()
    waitingRef.current = true
    const start = performance.now()
    let silenceSince = 0
    let peak = 0 // 本句语音峰值（带缓慢衰减，自适应背景音乐音量）
    const tick = () => {
      if (!waitingRef.current || busyRef.current) return
      const rms = currentRms()
      const now = performance.now()
      peak = Math.max(rms, peak * 0.995)
      // 静音判定：绝对地板，或（语音明显回落时）跌到峰值 35% 以下
      const isSilent = rms < SILENCE_RMS || (peak > SILENCE_PEAK_MIN && rms < peak * SILENCE_PEAK_RATIO)
      if (isSilent) {
        if (silenceSince === 0) silenceSince = now
        if (now - silenceSince >= SILENCE_HOLD_MS) {
          cancelSilenceWait()
          void captureSentence(entry, isLast)
          return
        }
      } else {
        silenceSince = 0
      }
      if (now - start >= SILENCE_WAIT_MS) {
        cancelSilenceWait()
        void captureSentence(entry, isLast)
        return
      }
      silenceRafRef.current = requestAnimationFrame(tick)
    }
    silenceRafRef.current = requestAnimationFrame(tick)
  }

  // 选集：加载字幕 + 重置自动跟读状态 + 读取该集续练进度
  const selectVideo = async (v: VideoItem) => {
    setSelected(v)
    setPracticeText("")
    setCurrentSub(null)
    setAutoStatus("idle")
    setNeedRetry(false)
    setLastScore(null)
    setSentenceScores({})
    setShowList(false)
    // 换集：释放上一集的录音 Blob URL，避免累积泄漏
    if (lastRecUrlRef.current) {
      URL.revokeObjectURL(lastRecUrlRef.current)
      lastRecUrlRef.current = null
    }
    setLastRecUrl(null)
    prevEntryRef.current = null
    completedRef.current = new Set()
    busyRef.current = false
    captureRef.current = null
    replayUntilRef.current = null
    suppressSeekRef.current = false
    pendingCompareRef.current = false
    lastRecEntryRef.current = null
    cancelSilenceWait()
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
    soe.reset()
    // 续练：上次练到同一集 → 记住句子序号，渲染时给出「继续上次」入口
    const saved = loadProgress()
    setResumeHint(saved && saved.name === v.name ? saved : null)
    try {
      const resp = await fetch(v.srtUrl)
      const srt = await resp.text()
      // 合并成完整句子粒度，避免在半句话处误暂停录音
      setSubtitles(toSentences(parseSrt(srt)))
    } catch {
      setSubtitles([])
    }
  }

  // 视频时间同步字幕 + 自动跟读触发点
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
      return // 重听期间不触发任何跟读/换句逻辑
    }

    const sub = findCurrentSubtitle(subtitles, video.currentTime * 1000)

    // 正在等「语音结束」：冻结显示在当前评测句，不跟进下一句字幕
    if (waitingRef.current) return

    if (autoMode && !busyRef.current) {
      const prev = prevEntryRef.current
      // 从上一句切走（进入下一句或句间停顿）→ 上一句刚读完，先等语音真正结束再暂停评测
      if (prev && sub !== prev && !completedRef.current.has(prev.index)) {
        const isLast = prev.index === subtitles[subtitles.length - 1].index
        prevEntryRef.current = sub
        setCurrentSub(prev) // 换句间隙：继续显示刚读完的这句
        setPracticeText(prev.text)
        setAutoStatus("waiting")
        armSilenceWait(prev, isLast)
        return
      }
    }
    // 有新字幕才更新显示；句间间隙（sub=null）保留上一句字幕直到下一句出现，避免字幕闪烁消失
    if (sub) {
      setCurrentSub(sub)
      if (sub.text !== practiceText) setPracticeText(sub.text)
    }
    prevEntryRef.current = sub
  }

  const onEnded = () => {
    if (!autoMode) return
    if (subtitles.length === 0) return
    // 视频已结束，无需再等静音
    cancelSilenceWait()
    // 最后一句话可能已由换句触发进入评测，交给 finishCapture 收尾
    if (busyRef.current) return
    const last = subtitles[subtitles.length - 1]
    if (last && !completedRef.current.has(last.index)) {
      // 最后一句话随视频结束一起读完 → 也评测一遍
      void captureSentence(last, true)
    } else {
      setAutoStatus("done")
      setNeedRetry(false)
      saveProgress(null) // 视频播完 → 清掉续练进度
    }
  }

  /** 用户拖动进度条/跳转后重置「上一句」引用，避免把跳过的句子误当作刚读完的句子；
   *  程序内 seek（重听原音/跳句）会先置 suppressSeekRef，这里跳过重置避免打断重听 */
  const onSeeked = () => {
    if (suppressSeekRef.current) {
      suppressSeekRef.current = false
      return
    }
    replayUntilRef.current = null // 用户拖动中断重听原音
    pendingCompareRef.current = false
    prevEntryRef.current = null
    cancelSilenceWait()
  }

  /** 自动跟读一句话：暂停视频 → 开始录音 → 定时自动停止 → 评分 */
  const captureSentence = async (entry: SubtitleEntry, isLast: boolean) => {
    if (busyRef.current) return
    cancelSilenceWait()
    replayUntilRef.current = null // 重听原音中的话，录音前终止
    pendingCompareRef.current = false
    busyRef.current = true
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
    const video = videoRef.current
    if (video && !video.paused) video.pause()
    setCurrentSub(entry)
    setPracticeText(entry.text)
    setAutoStatus("recording")
    setNeedRetry(false)
    setLastScore(null)
    captureRef.current = { entry, isLast }

    const ok = await soeRef.current.start()
    if (!ok) {
      busyRef.current = false
      setAutoStatus("paused")
      setNeedRetry(true)
      return
    }
    const recMs = Math.min(REC_MAX_MS, Math.max(REC_MIN_MS, entry.endMs - entry.startMs + 1500))
    autoStopTimerRef.current = window.setTimeout(() => {
      void soeRef.current.stop().then(finishCapture)
    }, recMs)
  }

  /** 评分完成：>70 自动续播，否则停在当前句等重读/跳过 */
  const finishCapture = (score: number | null) => {
    busyRef.current = false
    autoStopTimerRef.current = null
    const cap = captureRef.current
    const video = videoRef.current

    // §2.5 A/B 回放：取本次录音原始 PCM → 拼 WAV 头 → Blob URL（先 revoke 上一个，防 Blob 泄漏）
    const pcm = soeRef.current.lastPcmRef.current
    if (pcm && cap) {
      if (lastRecUrlRef.current) URL.revokeObjectURL(lastRecUrlRef.current)
      const url = URL.createObjectURL(pcmToWavBlob(pcm))
      lastRecUrlRef.current = url
      lastRecEntryRef.current = cap.entry.index
      setLastRecUrl(url)
    }

    if (score === null) {
      setAutoStatus("paused")
      setNeedRetry(true)
      return
    }
    setLastScore(score)
    if (cap) {
      // §2.2 记录逐句得分（进度列表 + 成绩总结共用）
      setSentenceScores((prev) => ({ ...prev, [cap.entry.index]: score }))
      // §2.6 记住本集练到这一句（每句评分后写一次，不做逐帧写）
      if (selected) saveProgress({ name: selected.name, index: cap.entry.index })
    }
    if (score > AUTO_PASS_SCORE) {
      if (cap) completedRef.current.add(cap.entry.index)
      if ((cap?.isLast && video?.ended) || video?.ended) {
        setAutoStatus("done")
        setNeedRetry(false)
        saveProgress(null) // 整集练完 → 清掉续练进度
      } else {
        setAutoStatus("playing")
        setNeedRetry(false)
        video?.play().catch(() => {
          // 自动播放被浏览器拦截（缺少手势链）→ 提示用户点播放
          setAutoStatus("paused")
        })
      }
    } else {
      setAutoStatus("paused")
      setNeedRetry(true)
    }
  }

  /** 重读当前句（未过关） */
  const retryCurrent = () => {
    const cap = captureRef.current
    if (cap && !busyRef.current) {
      void captureSentence(cap.entry, cap.isLast)
    }
  }

  /** 跳过当前句继续播放 */
  const skipCurrent = () => {
    const cap = captureRef.current
    if (cap) completedRef.current.add(cap.entry.index)
    setNeedRetry(false)
    const video = videoRef.current
    if (video?.ended) {
      // 最后一句话已随视频结束：跳过即视为完成，不重启整个视频
      setAutoStatus("done")
      saveProgress(null)
    } else {
      setAutoStatus("playing")
      video?.play().catch(() => setAutoStatus("paused"))
    }
  }

  /** 播放视频；若已播完则视为重新开始，清空已完成集合让自动跟读重新循环 */
  const playVideo = () => {
    const video = videoRef.current
    if (!video) return
    if (video.ended || video.currentTime >= video.duration) {
      completedRef.current = new Set()
      prevEntryRef.current = null
      setLastScore(null)
    }
    video.play().catch(() => setAutoStatus("paused"))
  }

  /** 开始自动跟读（用户手势内申请一次麦克风权限 + 建立音频图，避免后续自动触发被浏览器拒绝） */
  const startAuto = async () => {
    // 先同步建图/恢复 AudioContext（须在 await 前的用户手势内，否则 VAD 读不到音量退化为延时回退）
    ensureAudioGraph()
    if (sharedCtx?.state === "suspended") {
      sharedCtx.resume().catch(() => {})
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      // 权限被拒：后续 captureSentence 的 start 也会失败并提示，这里不打断播放
    }
    setAutoStatus("playing")
    setNeedRetry(false)
    playVideo()
  }

  const toggleRecord = async () => {
    if (soe.state.recording) {
      await soe.stop()
    } else {
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
    // 关键：先取消 VAD 等待，否则重听期间的静音会被误判成「读完了」而触发录音
    cancelSilenceWait()
    suppressSeekRef.current = true // onSeeked 里跳过重置，避免把这次程序内 seek 当成用户拖动
    replayUntilRef.current = entry.endMs
    pendingCompareRef.current = thenCompare
    setCurrentSub(entry)
    setPracticeText(entry.text)
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
    cancelSilenceWait()
    // 录音中先终止，避免把这段录音算到别的句子上
    if (soeRef.current.state.recording) void soeRef.current.stop()
    busyRef.current = false
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
    suppressSeekRef.current = true
    replayUntilRef.current = null
    pendingCompareRef.current = false
    prevEntryRef.current = null // 不清空会把跳过的句子误当作「刚读完」
    captureRef.current = {
      entry,
      isLast: entry.index === subtitles[subtitles.length - 1]?.index,
    }
    setCurrentSub(entry)
    setPracticeText(entry.text)
    setLastScore(null)
    setNeedRetry(false)
    setResumeHint(null)
    video.playbackRate = rateRef.current
    video.currentTime = entry.startMs / 1000
    setAutoStatus("playing")
    video.play().catch(() => setAutoStatus("paused"))
    if (selected) saveProgress({ name: selected.name, index: entry.index })
  }

  // ── §2.3 重练错句 ──
  /** 把未达标的句子状态清回「未做」，并跳到第一句错句重新进入循环 */
  const retryWrong = () => {
    if (summary.wrong.length === 0) return
    for (const s of summary.wrong) completedRef.current.delete(s.index)
    setSentenceScores((prev) => {
      const next = { ...prev }
      for (const s of summary.wrong) delete next[s.index]
      return next
    })
    setAutoStatus("playing")
    jumpToSentence(summary.wrong[0])
  }

  const statusText = () => {
    if (soe.state.evaluating) return "⏳ 评分中…"
    if (soe.state.recording) return "🎤 正在录音，请跟读这句话…"
    if (autoMode) {
      if (autoStatus === "playing") return "▶ 播放中… 读完一句会自动暂停评测"
      if (autoStatus === "waiting") return "👂 已读完这句，正在等语音真正结束…"
      if (autoStatus === "idle") return "▶ 点击「开始跟读」，视频读完一句会自动暂停录音评测"
      if (autoStatus === "done") return "🎉 本集跟读完成！"
      if (autoStatus === "paused") {
        return needRetry
          ? lastScore !== null
            ? `❌ ${lastScore} 分未达标（需 > ${AUTO_PASS_SCORE} 分），重读或跳过`
            : "⚠️ 录音无效，请重读或跳过"
          : "⏸ 已暂停（自动播放被拦截，请点视频播放）"
      }
    }
    // 手动模式：视频不自动暂停，状态相对简单
    if (!soe.state.recording && !soe.state.evaluating) {
      return "✋ 手动模式：视频不会自动暂停，自行点「跟读这句」录音"
    }
    return "✋ 手动模式"
  }

  // 状态条配色级别（绿=播放/完成，蓝=录音中，黄=评分/待操作，红=未达标/无效）
  const statusLevel = (): "ok" | "rec" | "wait" | "bad" => {
    if (soe.state.evaluating) return "wait"
    if (soe.state.recording) return "rec"
    if (autoMode) {
      if (autoStatus === "playing" || autoStatus === "done") return "ok"
      if (autoStatus === "idle" || autoStatus === "waiting") return "wait"
      if (autoStatus === "paused") return needRetry ? "bad" : "wait"
    }
    return "wait"
  }

  if (!selected) {
    return (
      <div className="page video-practice-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>视频跟读</h1>
        </header>
        <p className="module-hint">选择一集，看视频跟读练发音 · 读完一句自动暂停评测，超过 70 分自动继续</p>
        <div className="import-list">
          {VIDEOS.map((v) => (
            <button key={v.name} className="article-row" onClick={() => selectVideo(v)}>
              <div className="import-body">
                <div className="import-text">{v.title}</div>
                <div className="import-meaning">Big Muzzy 英语启蒙 · 自动跟读评测</div>
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
          controls={!soe.state.recording}
          playsInline
          onTimeUpdate={onTimeUpdate}
          onSeeked={onSeeked}
          onEnded={onEnded}
          // 换集会重置 playbackRate：重新套用用户选择的语速
          onLoadedMetadata={() => {
            if (videoRef.current) videoRef.current.playbackRate = rateRef.current
          }}
        />
        {/* A/B 对比回放：播放学生自己的录音（src 由 lastRecUrl 驱动） */}
        <audio ref={compareAudioRef} src={lastRecUrl ?? undefined} hidden />
      </div>

      {/* 模式切换 + 自动跟读控制 */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="video-mode-title">
          当前模式：<b>{autoMode ? "自动跟读" : "手动跟读"}</b>
        </div>
        <div className="essay-actions" style={{ justifyContent: "center", gap: 8 }}>
          <button
            className={autoMode ? "btn-primary" : "btn-mode-off"}
            style={{ width: "auto", flex: 1 }}
            aria-pressed={autoMode}
            onClick={() => setAutoMode(true)}
          >
            自动跟读
          </button>
          <button
            className={!autoMode ? "btn-primary" : "btn-mode-off"}
            style={{ width: "auto", flex: 1 }}
            aria-pressed={!autoMode}
            onClick={() => {
              setAutoMode(false)
              setNeedRetry(false)
              setLastScore(null)
            }}
          >
            手动跟读
          </button>
        </div>
        <div className={`video-status-pill level-${statusLevel()}`}>{statusText()}</div>
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

      {/* 本集成绩总结（§2.3）：done 状态展示 */}
      {autoStatus === "done" && (
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
                    onClick={() => {
                      setAutoStatus("playing")
                      jumpToSentence(s)
                    }}
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
              const st = sc == null ? "todo" : sc > AUTO_PASS_SCORE ? "pass" : "fail"
              const isCurrent = currentSub?.index === s.index
              return (
                <button
                  key={s.index}
                  className={`video-sentence-row state-${st}${isCurrent ? " current" : ""}`}
                  onClick={() => jumpToSentence(s)}
                  title={st === "pass" ? "已过关，点击回练" : st === "fail" ? "未达标，点击回练" : "未练习，点击开始"}
                >
                  <span className="video-sentence-mark">
                    {st === "pass" ? "✅" : st === "fail" ? "❌" : "⬜"}
                  </span>
                  <span className="video-sentence-text">{i + 1}. {s.text}</span>
                  {sc != null && <span className="video-sentence-score">{sc}分</span>}
                </button>
              )
            })
          )}
        </div>
      )}

      {/* 当前字幕 */}
      <div className="video-subtitle card">
        {currentSub ? (
          <>
            <div className="video-subtitle-text">{currentSub.text}</div>
            <div className="essay-actions" style={{ justifyContent: "center", gap: 8 }}>
              {autoMode ? (
                autoStatus === "idle" ? (
                  <button className="btn-primary" style={{ width: "auto", minWidth: 160 }} onClick={startAuto}>
                    ▶ 开始跟读
                  </button>
                ) : autoStatus === "waiting" ? (
                  <div className="video-status-pill level-wait" style={{ marginTop: 0 }}>
                    👂 等待语音结束，即将自动暂停录音…
                  </div>
                ) : needRetry ? (
                  <>
                    <button
                      className="btn-primary"
                      style={{ width: "auto", flex: 1 }}
                      disabled={busyRef.current || soe.state.evaluating}
                      onClick={retryCurrent}
                    >
                      🔄 重读这句
                    </button>
                    <button
                      className=""
                      style={{ width: "auto", flex: 1 }}
                      disabled={busyRef.current || soe.state.evaluating}
                      onClick={skipCurrent}
                    >
                      ⏭ 跳过继续
                    </button>
                  </>
                ) : (
                  <button
                    className={soe.state.recording ? "btn-danger" : ""}
                    style={{ width: "auto", minWidth: 160 }}
                    disabled={soe.state.evaluating || soe.state.recording}
                    onClick={playVideo}
                  >
                    {soe.state.recording ? "🔴 录音中…" : soe.state.evaluating ? "评分中…" : "⏯ 继续播放"}
                  </button>
                )
              ) : (
                <button
                  className={soe.state.recording ? "btn-danger" : "btn-primary"}
                  style={{ width: "auto", minWidth: 160 }}
                  disabled={soe.state.evaluating || !practiceText}
                  onClick={toggleRecord}
                >
                  {soe.state.recording ? "⏹ 停止并评分" : soe.state.evaluating ? "评分中…" : "🎤 跟读这句"}
                </button>
              )}
            </div>
            {/* §2.1 重听原音 / §2.5 A/B 对比：先播原音，再播自己的录音 */}
            <div className="video-sub-actions">
              <button
                className="video-mini-btn"
                onClick={() => replaySentence(currentSub)}
                disabled={soe.state.recording}
                title="只播放这一句，听完再模仿"
              >
                🔊 听原音
              </button>
              {lastRecUrl && lastRecEntryRef.current === currentSub.index && (
                <button
                  className="video-mini-btn"
                  onClick={() =>
                    replaySentence(
                      subtitles.find((s) => s.index === lastRecEntryRef.current) ?? currentSub,
                      true,
                    )
                  }
                  disabled={soe.state.recording}
                  title="先播原音，再播你刚才的录音，对比找差距"
                >
                  🔀 对比听
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
                {lastScore} 分 {lastScore > AUTO_PASS_SCORE ? "✅ 继续播放" : "❌ 未达标"}
              </div>
            )}
            {soe.state.score !== null && soe.state.score === lastScore && soe.state.result && (
              <SoeDetail result={soe.state.result} />
            )}
          </>
        ) : (
          <p className="empty">
            {autoMode ? "▶ 点「开始跟读」，读完一句自动暂停评测，超过 70 分自动继续" : "▶ 播放视频，当前句会自动显示，可跟读评分"}
          </p>
        )}
      </div>
    </div>
  )
}
