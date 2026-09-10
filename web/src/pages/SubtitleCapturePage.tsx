/** 字幕截图采集页
 * 1) 打开本地影片文件播放（原生 <video>）
 * 2) 播放/暂停控制
 * 3) 在画面上拖拽出一个框（可移动 + 8 个方向手柄调整大小），框定字幕区域
 * 4) 点「截屏」把当前帧的框内区域裁剪下来，连同元信息（序号、精确时间戳、影片名等）
 *    POST 到后端 /api/v1/subtitle-capture/capture，存到 data/subtitle_captures/
 * 后续可在「采集列表」里逐张送 /api/v1/ai-chinese/parse-image 做豆包字幕识别。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSoeScore } from "../hooks/useSoeScore"
import type { SoeWord } from "../lib/soeApi"
import { api } from "../services/api"



type Rect = { x: number; y: number; w: number; h: number }

// 按影片名记忆画框区域（像素 + 当时 wrap 尺寸，恢复时按比例缩放以适配不同分辨率）
const RECT_KEY = "subtitle_capture_rects"
function loadRectMap(): Record<string, { x: number; y: number; w: number; h: number; wrapW: number; wrapH: number }> {
  try {
    return JSON.parse(localStorage.getItem(RECT_KEY) || "{}")
  } catch {
    return {}
  }
}
function saveRectForMovie(name: string, r: Rect, wrapW: number, wrapH: number) {
  if (!name || !wrapW || !wrapH) return
  const map = loadRectMap()
  map[name] = { x: r.x, y: r.y, w: r.w, h: r.h, wrapW, wrapH }
  try {
    localStorage.setItem(RECT_KEY, JSON.stringify(map))
  } catch {
    /* 忽略存储配额错误 */
  }
}
function restoreRectForMovie(name: string, wrapW: number, wrapH: number): Rect | null {
  const m = loadRectMap()
  const r = m[name]
  if (!r || !r.wrapW || !r.wrapH || !wrapW || !wrapH) return null
  const sx = wrapW / r.wrapW
  const sy = wrapH / r.wrapH
  return {
    x: Math.round(r.x * sx),
    y: Math.round(r.y * sy),
    w: Math.round(r.w * sx),
    h: Math.round(r.h * sy),
  }
}
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move"

// 自动加载最近一次打开的影片：文件二进制存 IndexedDB，元数据/进度存 localStorage
const IDB_NAME = "aiphonix_media"
const IDB_STORE = "files"
const LAST_MOVIE_KEY = "last_movie_meta" // { movieName, lastTime(ms) }

interface LastMovieMeta {
  movieName: string
  lastTime: number
}

function idbPutLastMovie(file: File, meta: LastMovieMeta) {
  try {
    localStorage.setItem(LAST_MOVIE_KEY, JSON.stringify(meta))
  } catch {
    /* ignore */
  }
  const req = indexedDB.open(IDB_NAME, 1)
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
  }
  req.onsuccess = () => {
    const tx = req.result.transaction(IDB_STORE, "readwrite")
    tx.objectStore(IDB_STORE).put({ file, ...meta }, "lastMovie")
    tx.oncomplete = () => req.result.close()
    tx.onerror = () => req.result.close()
  }
  req.onerror = () => {
    /* ignore */
  }
}

function idbGetLastMovie(): Promise<{ file: File; meta: LastMovieMeta } | null> {
  return new Promise((resolve) => {
    let meta: LastMovieMeta | null = null
    try {
      meta = JSON.parse(localStorage.getItem(LAST_MOVIE_KEY) || "null")
    } catch {
      meta = null
    }
    if (!meta) {
      resolve(null)
      return
    }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, "readonly")
      const get = tx.objectStore(IDB_STORE).get("lastMovie")
      get.onsuccess = () => {
        const rec = get.result as { file: File } | undefined
        resolve(rec && rec.file ? { file: rec.file, meta } : null)
      }
      get.onerror = () => resolve(null)
      tx.oncomplete = () => req.result.close()
    }
    req.onerror = () => resolve(null)
  })
}

function saveLastTime(movieName: string, tMs: number) {
  try {
    const cur = JSON.parse(localStorage.getItem(LAST_MOVIE_KEY) || "null") as LastMovieMeta | null
    localStorage.setItem(LAST_MOVIE_KEY, JSON.stringify({ movieName: cur?.movieName || movieName, lastTime: tMs }))
  } catch {
    /* ignore */
  }
}

interface CaptureItem {
  seq: number
  file_name: string
  movie_name: string
  timestamp_ms: number
  timestamp_text: string
  video_width: number
  video_height: number
  crop: Rect
  crop_width: number
  crop_height: number
  note: string
  url: string
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mil = Math.floor(ms % 1000)
  const p = (n: number, l = 2) => String(n).padStart(l, "0")
  return `${p(h)}:${p(m)}:${p(s)}.${p(mil, 3)}`
}

interface EvalCardProps {
  r: any
  onTts: (text: string) => void
  onReEvaluate: (seq: number) => void
}

// 单条字幕测评卡片
function EvalCard({ r, onTts, onReEvaluate }: EvalCardProps) {
  return (
    <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, background: "#0b1220" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          #{r.seq} · {r.timestamp_text} · {r.movie_name}
          {r.cached && <span style={{ color: "#f59e0b", marginLeft: 6 }}>（已缓存）</span>}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => onReEvaluate(r.seq)} style={{ fontSize: 11, padding: "2px 8px" }}>🔄 重新测评</button>
          {r.url && (
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: "#38bdf8" }}
            >
              查看截图
            </a>
          )}
        </div>
      </div>

      {/* 原文 */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: 13, color: "#fff" }}>📝 字幕原文</b>
          <button onClick={() => onTts(r.subtitle_text)} style={{ width: 26, height: 26, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "1px solid #475569", background: "#1e293b", cursor: "pointer", fontSize: 13 }}>🔊</button>
        </div>
        <div style={{ fontSize: 15, color: "#f1f5f9", fontWeight: 500, marginTop: 2 }}>{r.subtitle_text || "（未识别到文字）"}</div>
      </div>

      {/* 翻译 */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: 13, color: "#fff" }}>🌐 翻译</b>
          <button onClick={() => onTts(r.translation)} style={{ width: 26, height: 26, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "1px solid #475569", background: "#1e293b", cursor: "pointer", fontSize: 13 }}>🔊</button>
        </div>
        <div style={{ fontSize: 15, color: "#e0f2fe", fontWeight: 500, marginTop: 2 }}>{r.translation || "—"}</div>
      </div>

      {/* 语法纠错 */}
      {r.grammar_corrections?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 13, color: "#fff" }}>✅ 语法/表达纠错</b>
          {r.grammar_corrections.map((g: any, gi: number) => (
            <div key={gi} style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
              <span style={{ color: "#f87171", textDecoration: "line-through" }}>{g.original}</span>
              <span style={{ color: "#4ade80", margin: "0 6px" }}>→ {g.corrected}</span>
              <span style={{ color: "#94a3b8", fontSize: 12 }}>（{g.reason}）</span>
            </div>
          ))}
        </div>
      )}

      {/* 讲解 */}
      {r.explanation && (
        <div style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 13, color: "#fff" }}>💡 讲解</b>
          <div style={{ fontSize: 14, color: "#f1f5f9", fontWeight: 500, marginTop: 2 }}>{r.explanation}</div>
        </div>
      )}

      {/* SOE 跟读评分（记录在本条标记/评测元信息里） */}
      {r.soe && (
        <div style={{ marginTop: 10, borderTop: "1px dashed #334155", paddingTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <b style={{ fontSize: 13, color: "#fff" }}>🎙 跟读得分</b>
            <span style={{
              fontSize: 16, fontWeight: 700, color: r.soe.score >= 80 ? "#4ade80" : r.soe.score >= 60 ? "#fbbf24" : "#f87171",
              padding: "2px 6px", borderRadius: 4,
              background: `${r.soe.score >= 80 ? "rgba(74,222,128,.15)" : r.soe.score >= 60 ? "rgba(251,191,36,.15)" : "rgba(248,113,113,.15)"}`,
            }}>{r.soe.score}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {r.soe.words.map((w: SoeWord, wi: number) => (
              <span key={wi} title={`${w.word} · 准确度 ${w.accuracy}`}
                style={{
                  fontSize: 13, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                  color: w.accuracy >= 80 ? "#4ade80" : w.accuracy >= 60 ? "#fbbf24" : "#f87171",
                  background: `${w.accuracy >= 80 ? "rgba(74,222,128,.12)" : w.accuracy >= 60 ? "rgba(251,191,36,.12)" : "rgba(248,113,113,.12)"}`,
                }}>
                {w.word}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function SubtitleCapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const evalSectionRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pendingTimeRef = useRef<number>(0) // 自动恢复时待定位的播放时间(ms)

  const [videoUrl, setVideoUrl] = useState<string>("")
  const [movieName, setMovieName] = useState("")
  const [playing, setPlaying] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)

  // 影片来源：本地文件 / 云端直链 URL / B站预览（iframe，不能采集）
  const [source, setSource] = useState<"none" | "local" | "url" | "bili">("none")
  const [biliUrl, setBiliUrl] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [biliKeyword, setBiliKeyword] = useState("")
  const [biliResults, setBiliResults] = useState<{ bvid: string; title: string; author: string; duration: string }[]>([])
  const [biliSearching, setBiliSearching] = useState(false)
  const [biliSearchMsg, setBiliSearchMsg] = useState("")
  // 只有 本地/云端直链 可以画框截图采集；B站预览不可采集
  const canCapture = source === "local" || source === "url"

  const [videoW, setVideoW] = useState(0)
  const [videoH, setVideoH] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // 画框（相对视频显示区域的像素坐标）
  const [rect, setRect] = useState<Rect | null>(null)
  const [editing, setEditing] = useState(false) // 拖动截屏区域模式开关
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; startRect: Rect } | null>(null)

  const [note] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [list, setList] = useState<CaptureItem[]>([])
  // 采集列表删除模式：delMode=true 时点卡片选择，再点删除按钮批量删除
  const [delMode, setDelMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // 自动测评相关
  const [lang] = useState<"en" | "zh">("en")
  const [evaluating, setEvaluating] = useState(false)
  const [evalResults, setEvalResults] = useState<any[]>([])
  const latestEval = evalResults[evalResults.length - 1]
  // SOE 待评测文本：优先使用当前激活标记的字幕，fallback 到最近识别结果
  const soeRefTextActiveRef = useRef<string>("")
  // 下面 activeMark 声明后会同步更新此 ref
  const globalSoe = useSoeScore(useCallback(() => ({
    refText: soeRefTextActiveRef.current || latestEval?.subtitle_text || "",
    engine: "",
    scene: "sentence",
  }), [latestEval?.subtitle_text]))
  const soe = globalSoe.state

  // 书签：每次测评成功的时间戳（按影片名分组，持久化到 localStorage）
  const [marks, setMarks] = useState<Record<string, { ts: number; ts_text: string; subtitle: string; translation: string; seq: number; soe?: { score: number; words: SoeWord[] } }[]>>({})
  const [autoReview, setAutoReview] = useState(false) // 播到标记自动暂停+朗读
  const lastMarkHit = useRef<number>(-1) // 防止同一 mark 重复触发
  const autoPausing = useRef(false) // 标记本次暂停是自动触发，避免重复测评

  // 读取持久化书签
  useEffect(() => {
    try {
      const raw = localStorage.getItem("subtitle_capture_marks")
      if (raw) setMarks(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])

  // 持久化书签（按影片名）
  const saveMark = useCallback(
    (m: { ts: number; ts_text: string; subtitle: string; translation: string; seq: number }) => {
      if (!movieName) return
      setMarks((prev) => {
        const arr = prev[movieName] ? prev[movieName].filter((x) => Math.abs(x.ts - m.ts) > 300) : []
        const next = { ...prev, [movieName]: [...arr, m].sort((a, b) => a.ts - b.ts) }
        try {
          localStorage.setItem("subtitle_capture_marks", JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    [movieName]
  )

  const movieMarks = marks[movieName] ?? []

  // 测评区可见内容：按当前视频时间戳/书签关联显示
  // 1) 有书签：仅当播放头命中某书签（±800ms）才显示该点测评，其余缓存全隐藏
  // 2) 无书签：显示"暂停自动识别"实时最新一条（live），不显示历史缓存
  const curMs = Math.round(currentTime * 1000)
  const activeMark = useMemo(
    () => movieMarks.find((m) => Math.abs(m.ts - curMs) <= 800) ?? null,
    [movieMarks, curMs]
  )
  // 同步 SOE refText 到当前激活标记的字幕
  soeRefTextActiveRef.current = activeMark?.subtitle || ""

  // SOE 单词得分浮窗（播放器下方一行，2.5s 自动消失）+ 写入标记数据
  const [soeWordPopup, setSoeWordPopup] = useState<{ words: SoeWord[]; score: number; error?: string } | null>(null)
  const soePopupTimer = useRef<number | null>(null)
  const prevEvaluating = useRef(false)
  useEffect(() => {
    // 检测 evaluating: true -> false 的跳变（一次评测完成）
    const finished = prevEvaluating.current && !soe.evaluating
    prevEvaluating.current = soe.evaluating
    if (!finished) return
    const res = soe.result
    setSoeWordPopup({ words: res?.words ?? [], score: soe.score ?? 0, error: soe.error || undefined })
    if (soePopupTimer.current) window.clearTimeout(soePopupTimer.current)
    soePopupTimer.current = window.setTimeout(() => setSoeWordPopup(null), 2500)
    if (movieName && soe.score != null && res?.words?.length) {
      setMarks((prev) => {
        const arr = prev[movieName] ?? []
        const target = (activeMark && arr.find((m) => m.ts === activeMark.ts)) || arr[arr.length - 1]
        if (!target) return prev
        const next = {
          ...prev,
          [movieName]: arr.map((m) =>
            m.ts === target.ts ? { ...m, soe: { score: soe.score as number, words: res.words } } : m
          ),
        }
        try {
          localStorage.setItem("subtitle_capture_marks", JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      })
    }
  }, [soe.evaluating, soe.result, soe.error, soe.score, movieName, activeMark])

  useEffect(() => () => { if (soePopupTimer.current) window.clearTimeout(soePopupTimer.current) }, [])

  const visibleEvals = useMemo(() => {
    if (movieMarks.length > 0) {
      if (!activeMark) return []
      const full = evalResults.find((e) => e.seq === activeMark.seq)
      return [
        {
          ...(full ?? {
            seq: activeMark.seq,
            timestamp_text: activeMark.ts_text,
            movie_name: movieName,
            url: "",
            subtitle_text: activeMark.subtitle,
            translation: activeMark.translation,
            grammar_corrections: [],
            explanation: "",
            fromMark: true,
          }),
          soe: activeMark.soe,
        },
      ]
    }
    const live = evalResults.find((e) => e.live)
    return live ? [live] : []
  }, [movieMarks, activeMark, evalResults, movieName])

  // 监听播放状态 / 时间 / 时长
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => {
      setCurrentTime(v.currentTime)
      if (movieName) saveLastTime(movieName, Math.round(v.currentTime * 1000))
    }
    const onMeta = () => {
      setDuration(v.duration || 0)
      setVideoW(v.videoWidth)
      setVideoH(v.videoHeight)
    }
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    v.addEventListener("timeupdate", onTime)
    v.addEventListener("loadedmetadata", onMeta)
    return () => {
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
      v.removeEventListener("timeupdate", onTime)
      v.removeEventListener("loadedmetadata", onMeta)
    }
  }, [videoUrl])

  // 首次挂载：自动加载最近一次打开的影片（文件存 IndexedDB，进度存 localStorage）
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || videoUrl) return
    restoredRef.current = true
    idbGetLastMovie().then((rec) => {
      if (!rec) return
      setVideoUrl(URL.createObjectURL(rec.file))
      setMovieName(rec.meta.movieName)
      pendingTimeRef.current = rec.meta.lastTime || 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seekBy = (delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
    setCurrentTime(v.currentTime)
  }
  const seekTo = (t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    setCurrentTime(t)
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (videoUrl && source === "local") URL.revokeObjectURL(videoUrl)
    setSource("local")
    setBiliUrl("")
    setVideoUrl(URL.createObjectURL(f))
    const name = f.name.replace(/\.[^.]+$/, "")
    setMovieName(name)
    setRect(null)
    setPickerOpen(false)
    idbPutLastMovie(f, { movieName: name, lastTime: 0 })
  }

  // 云端直链 URL：<video> 直接播放；截图需源开放 CORS
  const openUrl = () => {
    const u = urlInput.trim()
    if (!u) return
    if (videoUrl && source === "local") URL.revokeObjectURL(videoUrl)
    let name = u.slice(0, 24)
    try {
      const uu = new URL(u.startsWith("http") ? u : `https://${u}`)
      const last = uu.pathname.split("/").filter(Boolean).pop() || ""
      name = last.replace(/\.[^.]+$/, "") ? `${uu.hostname} · ${last.replace(/\.[^.]+$/, "")}` : uu.hostname
    } catch { /* 保持截断原名 */ }
    setSource("url")
    setBiliUrl("")
    setVideoUrl(u)
    setMovieName(name)
    setRect(null)
    setPickerOpen(false)
    setMsg("🔗 云端视频：若截图失败，说明该源未开放 CORS，只能播放不能采集")
  }

  // B站：iframe 内嵌预览（跨域播放器无法截图/取时间戳，只供浏览）
  const applyBili = (bvid: string) => {
    if (videoUrl && source === "local") URL.revokeObjectURL(videoUrl)
    setSource("bili")
    setBiliUrl(`https://player.bilibili.com/player.html?bvid=${bvid}&page=1&high_quality=1&danmaku=0`)
    setVideoUrl("")
    setMovieName(bvid)
    setRect(null)
    setPickerOpen(false)
    setMsg("🎬 B站预览模式：仅浏览，不支持画框/截图/采集")
  }

  // B站搜索（走服务端代理规避 CORS/风控）
  const searchBili = async () => {
    const kw = biliKeyword.trim()
    if (!kw) return
    setBiliSearching(true)
    setBiliSearchMsg("")
    try {
      const d = await api<{ items?: any[] }>(`/bili/search?keyword=${encodeURIComponent(kw)}`, { auth: false })
      setBiliResults(d.items ?? [])
      if (!d.items?.length) setBiliSearchMsg("😕 没有搜到结果，换关键词试试")
    } catch (e) {
      setBiliSearchMsg(`❌ 搜索失败: ${String(e)}`)
    } finally {
      setBiliSearching(false)
    }
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  // ── 画框交互（仅 editing 模式下生效）──
  const onWrapMouseDown = (e: React.MouseEvent, handle: Handle) => {
    if (!editing || !wrapRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const startRect = rect ?? { x: 0, y: 0, w: wrapRef.current.clientWidth * 0.3, h: wrapRef.current.clientHeight * 0.2 }
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startRect }
    if (!rect) setRect(startRect)
  }

  // 在画布空白处按下 → 新建框（仅 editing 模式且当前无框）
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (!editing || !wrapRef.current || rect) return
    const r = wrapRef.current.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const startRect = { x, y, w: 0, h: 0 }
    dragRef.current = { handle: "se", startX: e.clientX, startY: e.clientY, startRect }
    setRect(startRect)
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      const wrap = wrapRef.current
      if (!d || !wrap) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      const maxW = wrap.clientWidth
      const maxH = wrap.clientHeight
      let { x, y, w, h } = d.startRect
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

      if (d.handle === "move") {
        x = clamp(d.startRect.x + dx, 0, maxW - d.startRect.w)
        y = clamp(d.startRect.y + dy, 0, maxH - d.startRect.h)
      } else {
        if (d.handle.includes("e")) w = clamp(d.startRect.w + dx, 8, maxW - d.startRect.x)
        if (d.handle.includes("s")) h = clamp(d.startRect.h + dy, 8, maxH - d.startRect.y)
        if (d.handle.includes("w")) {
          const nx = clamp(d.startRect.x + dx, 0, d.startRect.x + d.startRect.w - 8)
          w = d.startRect.w + (d.startRect.x - nx)
          x = nx
        }
        if (d.handle.includes("n")) {
          const ny = clamp(d.startRect.y + dy, 0, d.startRect.y + d.startRect.h - 8)
          h = d.startRect.h + (d.startRect.y - ny)
          y = ny
        }
      }
      setRect({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
    }
    const onUp = () => {
      if (dragRef.current && rect && rect.w < 8 && rect.h < 8) setRect(null)
      dragRef.current = null
      // 拖动/缩放结束后，记忆当前画框（按影片名）
      if (rect && rect.w >= 8 && rect.h >= 8 && wrapRef.current && movieName) {
        saveRectForMovie(movieName, rect, wrapRef.current.clientWidth, wrapRef.current.clientHeight)
      }
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [rect])

  // ── 截图核心：裁剪当前帧字幕区，返回 PNG blob ──
  const cropBlob = useCallback((): Promise<Blob | null> => {
    const v = videoRef.current
    const wrap = wrapRef.current
    if (!v || !wrap || !rect) return Promise.resolve(null)
    if (v.readyState < 2) return Promise.resolve(null)
    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return Promise.resolve(null)
    const scaleX = vw / wrap.clientWidth
    const scaleY = vh / wrap.clientHeight
    const sx = Math.round(rect.x * scaleX)
    const sy = Math.round(rect.y * scaleY)
    const sw = Math.round(rect.w * scaleX)
    const sh = Math.round(rect.h * scaleY)

    const tmp = document.createElement("canvas")
    tmp.width = vw
    tmp.height = vh
    const tctx = tmp.getContext("2d")
    if (!tctx) return Promise.resolve(null)
    try {
      tctx.drawImage(v, 0, 0, vw, vh)
    } catch {
      return Promise.reject(new Error("该视频源不允许截图（跨域未开放 CORS，画布被污染）"))
    }

    const crop = document.createElement("canvas")
    crop.width = sw
    crop.height = sh
    const cctx = crop.getContext("2d")
    if (!cctx) return Promise.resolve(null)
    try {
      cctx.drawImage(tmp, sx, sy, sw, sh, 0, 0, sw, sh)
    } catch {
      return Promise.reject(new Error("该视频源不允许截图（跨域未开放 CORS，画布被污染）"))
    }

    return new Promise<Blob | null>((res) => crop.toBlob(res, "image/png"))
  }, [rect])

  // 拉取历史列表，并把已带 eval 缓存的条目灌回测评区（按 seq 去重）
  const loadList = useCallback(async () => {
    try {
      const data = await api<{ items?: any[] }>(`/subtitle-capture/list`).catch(() => null)
      if (!data) return
      const items = data.items ?? []
      setList(items)
      setEvalResults((prev) => {
        const have = new Set(prev.map((x) => x.seq))
        const restored = items
          .filter((x: any) => x.eval && !have.has(x.seq))
          .map((x: any) => ({
            seq: x.seq,
            timestamp_text: x.timestamp_text,
            movie_name: x.movie_name,
            url: x.url,
            subtitle_text: x.eval.subtitle_text,
            translation: x.eval.translation,
            grammar_corrections: x.eval.grammar_corrections ?? [],
            explanation: x.eval.explanation,
            cached: true,
          }))
        return [...prev, ...restored].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
      })
    } catch {
      /* ignore */
    }
  }, [])

  // 批量删除选中截图（删除模式确认态调用）
  const doDelete = useCallback(async () => {
    const seqs = [...selected]
    if (!seqs.length) return
    let okCount = 0
    for (const seq of seqs) {
      try {
        const ok = await api(`/subtitle-capture/${seq}`, { method: "DELETE" }).then(() => true).catch(() => false)
        if (ok) okCount++
      } catch {
        /* 单条失败继续 */
      }
    }
    setSelected(new Set())
    setDelMode(false)
    if (okCount > 0) setMsg(`🗑 已删除 ${okCount} 张截图`)
    await loadList()
  }, [selected, loadList])
  const doCapture = useCallback(
    async (mode: "save" | "evaluate") => {
      const v = videoRef.current
      if (!v || !rect) {
        setMsg("❌ 请先选影片并框选字幕区域")
        return
      }
      let blob: Blob | null = null
      try {
        blob = await cropBlob()
      } catch (e) {
        setMsg(`❌ 截图失败: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      if (!blob) {
        setMsg("❌ 截图失败（视频未就绪或画框无效）")
        return
      }
      const tsMs = Math.round(v.currentTime * 1000)
      const vw = v.videoWidth
      const vh = v.videoHeight
      const scaleX = vw / (wrapRef.current?.clientWidth || vw)
      const scaleY = vh / (wrapRef.current?.clientHeight || vh)
      const meta = {
        movie_name: movieName,
        timestamp_ms: tsMs,
        video_width: vw,
        video_height: vh,
        crop: { x: Math.round(rect.x * scaleX), y: Math.round(rect.y * scaleY), w: Math.round(rect.w * scaleX), h: Math.round(rect.h * scaleY) },
        crop_width: Math.round(rect.w * scaleX),
        crop_height: Math.round(rect.h * scaleY),
        note,
        lang,
      }

      const url =
        mode === "evaluate"
          ? `/subtitle-capture/auto-evaluate`
          : `/subtitle-capture/capture`
      if (mode === "evaluate") setEvaluating(true)
      else setBusy(true)
      setMsg(mode === "evaluate" ? "🤖 识别+翻译中…" : "上传中…")
      try {
        const fd = new FormData()
        fd.append("file", blob, `${movieName || "shot"}_${tsMs}.png`)
        fd.append("meta", JSON.stringify(meta))
        const r = await api<any>(url, { method: "POST", body: fd })
        if (mode === "evaluate") {
          const result = {
            seq: r.seq,
            timestamp_text: r.timestamp_text,
            movie_name: r.movie_name,
            url: r.url,
            subtitle_text: r.subtitle_text,
            translation: r.translation,
            grammar_corrections: r.grammar_corrections ?? [],
            explanation: r.explanation,
            live: true,
          }
          setEvalResults((prev) => [result, ...prev])
          // 记录书签：本次暂停的时间戳
          saveMark({
            ts: Math.round(v.currentTime * 1000),
            ts_text: r.timestamp_text,
            subtitle: r.subtitle_text,
            translation: r.translation,
            seq: r.seq,
          })
          setMsg(`✅ 已测评 #${r.seq} @${r.timestamp_text}`)
        } else {
          setMsg(`✅ 已保存 #${r.seq} 时间戳 ${r.timestamp_text}`)
          // 顺带保存一条空书签，关联到本次截存的截图（可后续重新测评）
          saveMark({
            ts: Math.round(v.currentTime * 1000),
            ts_text: r.timestamp_text,
            subtitle: "",
            translation: "",
            seq: r.seq,
          })
        }
        loadList()
      } catch (e) {
        setMsg(`❌ 失败: ${String(e)}`)
      } finally {
        if (mode === "evaluate") {
          setEvaluating(false)
          // 识别完成自动跳转到字幕测评区
          setTimeout(() => evalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
        } else setBusy(false)
      }
    },
    [rect, movieName, note, lang, cropBlob]
  )

  // ── TTS 朗读 ──
  const [speaking, setSpeaking] = useState(false)
  const tts = useCallback(async (text: string) => {
    if (!text) return
    try {
      const audio = await api<Blob>("/tts/synthesize", {
        method: "POST",
        body: { text, speed: 5 }, // 音色跟随 useTts 默认（6221）；英文文本由服务端自动改走 4193 大模型音色
        responseType: "blob",
      })
      const aUrl = URL.createObjectURL(audio)
      const au = new Audio(aUrl)
      au.play()
      au.onended = () => URL.revokeObjectURL(aUrl)
    } catch (e) {
      setMsg(`❌ TTS 失败: ${String(e)}`)
    }
  }, [])

  // ── 重新测评：按 seq 用已存截图重跑 LLM，替换旧结果（force）──
  const reEvaluate = useCallback(
    async (seq: number) => {
      if (!seq) return
      setMsg(`🔄 重新测评 #${seq}…`)
      try {
        const r = await api<any>(`/subtitle-capture/re-evaluate`, { method: "POST", body: { seq, lang } })
        setEvalResults((prev) =>
          prev.map((x) =>
            x.seq === seq
              ? {
                  ...x,
                  subtitle_text: r.subtitle_text,
                  translation: r.translation,
                  grammar_corrections: r.grammar_corrections ?? [],
                  explanation: r.explanation,
                  cached: false,
                }
              : x
          )
        )
        setMsg(`✅ 已更新 #${seq}`)
        loadList()
      } catch (e) {
        setMsg(`❌ 重新测评失败: ${String(e)}`)
      }
    },
    [lang, loadList]
  )

  // 暂停时若开启自动测评且有画框（且非自动复习触发的暂停）→ 自动截屏+评估
  const onPauseAuto = useCallback(() => {
    if (autoPausing.current) {
      // 自动复习触发的暂停：只朗读已有书签，不重新测评
      autoPausing.current = false
      const t = Math.round((videoRef.current?.currentTime || 0) * 1000)
      const mk = movieMarks.find((x) => Math.abs(x.ts - t) < 600)
      if (mk) {
        setMsg(`🔖 到达书签 @${mk.ts_text} · 朗读中…`)
        tts(mk.subtitle)
      }
      return
    }
  }, [movieMarks, tts])

  // 把 onPauseAuto 挂到 video 的 pause 事件
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.addEventListener("pause", onPauseAuto)
    return () => v.removeEventListener("pause", onPauseAuto)
  }, [onPauseAuto])

  // 自动复习：播放时检测到跨过书签时间戳 → 自动暂停 + 朗读
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      if (!autoReview || !playing) return
      const tMs = Math.round(v.currentTime * 1000)
      const mk = movieMarks.find((x) => Math.abs(x.ts - tMs) < 400)
      if (mk && lastMarkHit.current !== mk.ts) {
        lastMarkHit.current = mk.ts
        autoPausing.current = true
        v.pause()
        setMsg(`🔖 到达书签 @${mk.ts_text} · 朗读中…`)
        tts(mk.subtitle)
      }
    }
    v.addEventListener("timeupdate", onTime)
    // 拖动/跳转后重置，避免回跳时重复命中
    const onSeek = () => {
      lastMarkHit.current = -1
    }
    v.addEventListener("seeked", onSeek)
    return () => {
      v.removeEventListener("timeupdate", onTime)
      v.removeEventListener("seeked", onSeek)
    }
  }, [autoReview, playing, movieMarks, tts])

  useEffect(() => {
    loadList()
  }, [loadList])

  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
  const handleStyle: Record<Handle, React.CSSProperties> = {
    nw: { left: -5, top: -5, cursor: "nwse-resize" },
    n: { left: "50%", top: -5, transform: "translateX(-50%)", cursor: "ns-resize" },
    ne: { right: -5, top: -5, cursor: "nesw-resize" },
    e: { right: -5, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
    se: { right: -5, bottom: -5, cursor: "nwse-resize" },
    s: { left: "50%", bottom: -5, transform: "translateX(-50%)", cursor: "ns-resize" },
    sw: { left: -5, bottom: -5, cursor: "nesw-resize" },
    w: { left: -5, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
    move: {},
  }

  return (
    <div className="page" style={{ maxWidth: 1100, width: "100%", boxSizing: "border-box", padding: "0 12px" }}>
      {/* 控制区：浅色主题样式 */}
      <style>{`
        /* 操作按钮行：正方形按钮，紧凑排列 */
        .ctrl-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          width: 64px;
          aspect-ratio: 1 / 1;
          padding: 2px;
          border: none;
          border-radius: 8px;
          background: #fff;
          color: #334155;
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
          line-height: 1.15;
          transition: all .15s;
          user-select: none;
          flex-shrink: 0;
        }
        .ctrl-btn:hover:not(:disabled) { border-color: #93c5fd; background: #eff6ff; }
        .ctrl-btn:active:not(:disabled) { transform: scale(0.97); }
        .ctrl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ctrl-btn.primary {
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          border-color: transparent;
          color: #fff;
          box-shadow: 0 2px 8px rgba(59,130,246,.35);
        }
        .ctrl-btn.primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #60a5fa, #3b82f6);
          box-shadow: 0 4px 12px rgba(59,130,246,.45);
        }
        .ctrl-btn .btn-icon { font-size: 18px; line-height: 1; }

        /* 播放大按钮 */
        .play-btn {
          width: 44px; height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          border: none;
          color: #fff;
          font-size: 20px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 12px rgba(59,130,246,.4);
          transition: all .15s;
          flex-shrink: 0;
        }
        .play-btn:hover:not(:disabled) { transform: scale(1.06); box-shadow: 0 5px 16px rgba(59,130,246,.5); }
        .play-btn:active:not(:disabled) { transform: scale(0.95); }

        /* 视频中央两侧控制按钮（倒退/快进 5s） */
        .center-ctrl {
          width: 48px; height: 48px;
          border-radius: 50%;
          background: rgba(0,0,0,0.4);
          border: none;
          color: #fff;
          font-size: 20px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 12px rgba(0,0,0,0.3);
          transition: all .15s;
          opacity: 0.7;
        }
        .center-ctrl:hover:not(:disabled) { background: rgba(59,130,246,0.9); }
        .center-ctrl:active:not(:disabled) { transform: translateY(-50%) scale(0.95); }
        .center-ctrl:disabled { opacity: 0.3; cursor: not-allowed; }
        .play-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        /* 进度条容器 */
        .progress-wrap {
          position: relative;
          width: 100%;
          padding: 12px 0;
        }
        .progress-wrap input[type=range] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%; height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #3b82f6 var(--progress), #e2e8f0 var(--progress));
          outline: none; cursor: pointer;
        }
        .progress-wrap input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid #3b82f6;
          box-shadow: 0 2px 6px rgba(59,130,246,.3);
          cursor: pointer;
        }
        .progress-wrap input[type=range]::-moz-range-thumb {
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid #3b82f6;
          box-shadow: 0 2px 6px rgba(59,130,246,.3);
          cursor: pointer;
        }

        /* 快捷键提示 */
        .shortcut-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 8px 14px;
          background: #f8fafc;
          border-radius: 10px;
          font-size: 11px;
          color: #94a3b8;
        }
        .shortcut-bar kbd {
          display: inline-block;
          padding: 1px 6px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          background: #fff;
          font-family: inherit;
          font-size: 11px;
          color: #475569;
          min-width: 22px;
          text-align: center;
        }

        /* 下拉选择 */
        .lang-select {
          padding: 7px 28px 7px 10px;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center;
          color: #334155;
          font-size: 13px;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
        }
        .lang-select:focus { border-color: #93c5fd; outline: none; }

        /* 语音评测录音红点脉冲动画 */
        @keyframes soePulse {
          0% { box-shadow: 0 0 0 0 rgba(239,68,68,.5); }
          70% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }

        @media (max-width: 480px) {
          .ctrl-btn { font-size: 12px; border-radius: 10px; flex: 1 1 calc(33% - 6px); width: auto; min-width: 0; }
          .ctrl-btn .btn-icon { font-size: 16px; }
          .play-btn { width: 38px; height: 38px; font-size: 17px; }
          .shortcut-bar { font-size: 10px; gap: 8px; padding: 6px 10px; }
          .shortcut-bar kbd { font-size: 10px; min-width: 18px; padding: 0 4px; }
        }
      `}</style>
      <header>
        <h1>🎬 字幕截图采集</h1>
        <p>选择本地 / 云端直链 / B站视频 → 框选字幕区域 → 截屏存盘（含精确时间戳），后续可批量送豆包识别</p>
      </header>

      {/* 媒体 + 控制 section（上控制 下视频） */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "stretch" }}>

        {/* 顶部：控制区（按钮行 + 进度条行垂直堆叠，移动端自适应） */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 14, border: "1px solid #e2e8f0" }}>
          {/* 操作按钮 — 横排 */}
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {/* 选择影片（弹层：本地 / 云端 URL / B站预览） */}
          <button className="ctrl-btn primary" onClick={() => setPickerOpen(true)}
            style={{ cursor: "pointer", padding: "6px 4px", fontSize: 10, justifyContent: "center" }}>
            <span className="btn-icon" style={{ fontSize: 13 }}>🎞️</span>
            影片
          </button>
          {/* 设置截屏区域（B站预览不可采集） */}
          <button onClick={() => {
              if (!canCapture) return
              if (editing) { setEditing(false); if (rect && rect.w >= 8 && rect.h >= 8 && wrapRef.current && movieName) saveRectForMovie(movieName, rect, wrapRef.current.clientWidth, wrapRef.current.clientHeight) }
              else { setEditing(true); if (!rect && wrapRef.current) { const w = wrapRef.current.clientWidth; const h = wrapRef.current.clientHeight; setRect({ x: Math.round(w * 0.1), y: Math.round(h * 0.7), w: Math.round(w * 0.8), h: Math.round(h * 0.25) }) } }
            }}
            className="ctrl-btn"
            disabled={!canCapture}
            style={(editing ? { borderColor: "#22d3ee", color: "#0891b2", background: "#f0fdfa", padding: "6px 4px", fontSize: 10, justifyContent: "center" } : { padding: "6px 4px", fontSize: 10, justifyContent: "center" }) as React.CSSProperties}
          >
            <span className="btn-icon">{editing ? "✅" : "📐"}</span>
            {editing ? "完成" : "截屏"}
          </button>
          {/* 截屏存盘 */}
          <button className="ctrl-btn" onClick={() => doCapture("save")} disabled={!rect || busy || evaluating || !canCapture}
            style={{ borderColor: "#93c5fd", color: "#2563eb", background: "#eff6ff", padding: "6px 4px", fontSize: 10, justifyContent: "center" } as React.CSSProperties}>
            <span className="btn-icon">💾</span> 存图
          </button>
          {/* 识别当前帧 */}
          <button className="ctrl-btn" onClick={() => doCapture("evaluate")} disabled={!rect || busy || evaluating || !canCapture}
            style={{ borderColor: "#c4b5fd", color: "#7c3aed", background: "#f5f3ff", padding: "6px 4px", fontSize: 10, justifyContent: "center" } as React.CSSProperties}>
            <span className="btn-icon">🤖</span> 识别
          </button>
          {/* 语音评测 — 二态按钮 */}
          <button className="ctrl-btn" onClick={() => (soe.recording ? globalSoe.stop() : globalSoe.start())} disabled={soe.evaluating || !soeRefTextActiveRef.current}
            title={soe.recording ? "点击结束录音并上传评测" : "点击开始跟读录音"}
            style={soe.recording
              ? { borderColor: "#ef4444", color: "#dc2626", background: "#fef2f2", padding: "6px 4px", fontSize: 10, justifyContent: "center" } as React.CSSProperties
              : { borderColor: "#f59e0b", color: "#b45309", background: "#fffbeb", padding: "6px 4px", fontSize: 10, justifyContent: "center" } as React.CSSProperties}>
            {soe.recording ? (
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444", animation: "soePulse 1s infinite" }} />
            ) : soe.evaluating ? (
              <span className="btn-icon">⏳</span>
            ) : (
              <span className="btn-icon">🎙</span>
            )}
            {soe.recording ? "结束录音" : soe.evaluating ? "评测…" : "语音"}
            {soe.score != null && !soe.recording && !soe.evaluating && <span style={{ fontSize: 9, color: "#16a34a" }}>{soe.score}</span>}
          </button>
          {/* 自动复习 — 二态按钮 */}
          <button onClick={() => setAutoReview(!autoReview)}
            title={autoReview ? "自动复习：开启（暂停自动测评）" : "自动复习：关闭"}
            className="ctrl-btn"
            style={{
              borderColor: autoReview ? "#22c55e" : "#cbd5e1",
              color: autoReview ? "#16a34a" : "#94a3b8",
              background: autoReview ? "#f0fdf4" : "#f1f5f9",
              padding: "6px 4px", fontSize: 10, justifyContent: "center",
            } as React.CSSProperties}>
            <span className="btn-icon">{autoReview ? "🔁" : "⏸"}</span>
            {autoReview ? "复习中" : "已关闭"}
          </button>
          {/* 朗读当前标记字幕 — 无标记时提示 */}
          <button className="ctrl-btn" disabled={speaking}
            onClick={() => {
              const text = activeMark?.subtitle?.trim()
              if (!text) { setMsg("📍 请先标记识别当前画面"); return }
              setMsg(`🔊 朗读：${text.slice(0, 20)}${text.length > 20 ? "…" : ""}`)
              setSpeaking(true)
              tts(text).finally(() => setSpeaking(false))
            }}
            title={activeMark?.subtitle ? `朗读 ${activeMark.ts_text} 标记的字幕` : "当前时间戳没有标记，请先「识别」"}
            style={{ borderColor: "#a5b4fc", color: "#4f46e5", background: "#eef2ff", padding: "6px 4px", fontSize: 10, justifyContent: "center", opacity: speaking ? 0.6 : 1 } as React.CSSProperties}>
            <span className="btn-icon">{speaking ? "⏳" : "🔊"}</span>
            {speaking ? "朗读中" : "朗读"}
          </button>
          {editing && (
            <p style={{ fontSize: 10, color: "#0891b2", background: "#f0fdfa", padding: "4px 6px", borderRadius: 5, margin: 0 }}>
              📐 框选字幕区
            </p>
          )}
          {source === "bili" && (
            <p style={{ fontSize: 10, color: "#dc2626", background: "#fef2f2", padding: "4px 6px", borderRadius: 5, margin: 0 }}>
              🎬 B站预览模式：仅浏览，不支持画框/截图/采集
            </p>
          )}
          </div>

          {msg && <p className="msg" style={{ fontSize: 11, margin: 0 }}>{msg}</p>}

          {/* 进度条行（满宽独立一行） */}
          {videoUrl && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              <div className="progress-wrap" style={{ "--progress": `${duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0}%`, padding: "0", flex: "1 1 auto", minWidth: 160 } as React.CSSProperties}>
                <input
                  type="range" min={0} max={duration || 0} step={0.01}
                  value={Math.min(currentTime, duration || 0)}
                  disabled={!videoUrl}
                  onChange={(e) => seekTo(Number(e.target.value))}
                />
                {/* 书签标记点 */}
                {duration > 0 && movieMarks.map((mk, i) => (
                  <span key={i} title={`书签 @${mk.ts_text}`} onClick={() => seekTo(mk.ts / 1000)}
                    style={{ position: "absolute", top: -3, left: `calc(${(mk.ts / 1000 / duration) * 100}% - 5px)`, width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", cursor: "pointer", border: "2px solid #fff", boxShadow: "0 1px 3px rgba(0,0,0,.4)" }} />
                ))}
              </div>
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11, fontWeight: 600, color: "#475569", whiteSpace: "nowrap", letterSpacing: ".3px" }}>
                {fmt(Math.round(currentTime * 1000))} / {fmt(Math.round(duration * 1000))}
              </span>
            </div>
          )}
        </section>

        {/* 下方播放器 */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            ref={wrapRef}
            className="video-wrap"
            style={{ position: "relative", width: "100%", background: "#000", borderRadius: 8, overflow: "hidden", aspectRatio: videoW && videoH ? `${videoW}/${videoH}` : "16/9", cursor: editing ? "crosshair" : "default" }}
            onMouseDown={onCanvasMouseDown}
            onMouseEnter={() => setControlsVisible(true)}
            onMouseLeave={() => setControlsVisible(false)}
            onTouchStart={() => setControlsVisible(true)}
            onClick={(e) => {
              // 移动端：点击空白处切换显示（避免与拖动框冲突）
              if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "VIDEO") {
                if (!controlsVisible) setControlsVisible(true)
              }
            }}
          >
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                style={{ width: "100%", display: "block" }}
                onLoadedMetadata={(e) => {
                  setVideoW(e.currentTarget.videoWidth)
                  setVideoH(e.currentTarget.videoHeight)
                  // 恢复该影片记忆的画框（按比例适配当前显示区）
                  if (!rect && wrapRef.current && movieName) {
                    const restored = restoreRectForMovie(movieName, wrapRef.current.clientWidth, wrapRef.current.clientHeight)
                    if (restored) setRect(restored)
                  }
                  // 自动恢复上次播放进度（仅第一次加载时定位）
                  if (pendingTimeRef.current > 0) {
                    e.currentTarget.currentTime = pendingTimeRef.current / 1000
                    setCurrentTime(pendingTimeRef.current / 1000)
                    pendingTimeRef.current = 0
                  }
                }}
                crossOrigin="anonymous"
                onError={() => {
                  if (source === "url") setMsg("❌ 视频加载失败：请确认该链接是可直接播放的媒体文件（.mp4/.webm/.ogg 等），且网络可达")
                }}
              />
            ) : source === "bili" && biliUrl ? (
              /* B站预览：跨域播放器，仅可浏览，无法截图/读时间戳。
               sandbox 禁止顶层导航（allow-top-navigation/popups 均不加）：
               点播放器内「清晰度/去网页观看」等链接不会把本页面跳走；播放/搜索不受影响。 */
              <iframe
                src={biliUrl}
                title="B站预览"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-presentation"
                allow="autoplay; fullscreen; picture-in-picture"
                referrerPolicy="no-referrer-when-downgrade"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            ) : (
              <div style={{ color: "#888", textAlign: "center", padding: 80 }}>点「🎞️ 影片」选择本地文件 / 云端直链 / B站</div>
            )}

            {rect && (
              <div
                onMouseDown={(e) => onWrapMouseDown(e, "move")}
                style={{
                  position: "absolute",
                  left: rect.x,
                  top: rect.y,
                  width: rect.w,
                  height: rect.h,
                  border: `2px solid ${editing ? "#22d3ee" : "#64748b"}`,
                  background: editing ? "rgba(34,211,238,0.12)" : "rgba(100,116,139,0.08)",
                  cursor: editing ? "move" : "default",
                  boxSizing: "border-box",
                }}
              >
                {editing &&
                  handles.map((h) => (
                    <span
                      key={h}
                      onMouseDown={(e) => onWrapMouseDown(e, h)}
                      style={{
                        position: "absolute",
                        width: 10,
                        height: 10,
                        background: "#22d3ee",
                        borderRadius: "50%",
                        border: "1px solid #0e7490",
                        ...handleStyle[h],
                      }}
                    />
                  ))}
              </div>
            )}

            {/* 视频控制按钮组：鼠标/触摸进入播放器时才显示，平时低透明度 */}
            {videoUrl && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  opacity: controlsVisible ? 1 : 0,
                  transition: "opacity .2s",
                }}
              >
                {/* 播放/暂停（居中） */}
                <button
                  onClick={togglePlay}
                  disabled={!videoUrl}
                  title={playing ? "暂停" : "播放"}
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: playing ? "rgba(0,0,0,0.4)" : "rgba(59,130,246,0.85)",
                    border: "none",
                    color: "#fff",
                    fontSize: 26,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                    pointerEvents: "auto",
                    transition: "all .15s",
                    opacity: 0.55,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.06)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)" }}
                >
                  {playing ? "⏸" : "▶"}
                </button>
                {/* 倒退 5s（最左） */}
                <button
                  onClick={() => seekBy(-5)}
                  title="倒退 5s"
                  className="center-ctrl"
                  style={{ position: "absolute", top: "50%", left: 16, transform: "translateY(-50%)", pointerEvents: "auto", opacity: 0.5 }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(-50%) scale(1.1)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.transform = "translateY(-50%) scale(1)" }}
                >
                  ⏪
                </button>
                {/* 快进 5s（最右） */}
                <button
                  onClick={() => seekBy(5)}
                  title="快进 5s"
                  className="center-ctrl"
                  style={{ position: "absolute", top: "50%", right: 16, transform: "translateY(-50%)", pointerEvents: "auto", opacity: 0.5 }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(-50%) scale(1.1)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.transform = "translateY(-50%) scale(1)" }}
                >
                  ⏩
                </button>
              </div>
            )}

          </div>

        </div>
      </section>

      {/* 打开影片来源浮层：本地 / 云端直链 / B站预览 */}
      {pickerOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 420, boxShadow: "0 12px 40px rgba(0,0,0,.28)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: 17, color: "#0f172a" }}>🎞️ 打开影片</h3>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#64748b" }}>选择视频来源 —— 本地最稳定，云端可采集（需源开 CORS），B站仅预览</p>

            {/* 本地文件 */}
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", border: "1px solid #e2e8f0", borderRadius: 12, cursor: "pointer", marginBottom: 8, minHeight: 44 }}>
              <span style={{ fontSize: 20 }}>📁</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>本地文件</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>完整采集</span>
              <input type="file" accept="video/*" onChange={onPickFile} style={{ display: "none" }} />
            </label>

            {/* 云端直链 */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>🔗</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>云端直链 URL</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") openUrl() }}
                  placeholder="https://…/video.mp4"
                  style={{ flex: 1, minWidth: 0, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, color: "#0f172a" }}
                />
                <button onClick={openUrl} style={{ width: "auto", flexShrink: 0, padding: "0 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", minHeight: 44 }}>打开</button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94a3b8" }}>⚠️ 截图需视频源开放 CORS，否则只能播放不能采集（浏览器安全限制）</p>
            </div>

            {/* B站：搜索 + 结果列表 + 直开 BV（都是预览模式） */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>🎬</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>B站视频（预览）</span>
              </div>
              {/* 关键词搜索 */}
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input
                  value={biliKeyword}
                  onChange={(e) => setBiliKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchBili() }}
                  placeholder="🔍 搜索 B站视频，如：小猪佩奇"
                  style={{ flex: 1, minWidth: 0, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, color: "#0f172a" }}
                />
                <button onClick={searchBili} disabled={biliSearching} style={{ width: "auto", flexShrink: 0, padding: "0 14px", borderRadius: 8, border: "none", background: "#0ea5e9", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", minHeight: 44 }}>{biliSearching ? "搜索…" : "搜索"}</button>
              </div>
              {/* 搜索结果列表（点击打开预览） */}
              {biliResults.length > 0 && (
                <div style={{ maxHeight: 190, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 8, background: "#f8fafc" }}>
                  {biliResults.map((it) => (
                    <button
                      key={it.bvid}
                      onClick={() => applyBili(it.bvid)}
                      title={`${it.title} · ${it.author} · 时长 ${it.duration}`}
                      style={{
                        display: "flex", width: "100%", textAlign: "left", alignItems: "center", gap: 10,
                        padding: "9px 12px", minHeight: 44, border: "none", borderBottom: "1px solid #e2e8f0",
                        background: "transparent", cursor: "pointer", borderRadius: 0,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, color: "#64748b" }}>{it.author}</span>
                    </button>
                  ))}
                </div>
              )}
              {biliSearchMsg && <p style={{ margin: "4px 0 8px", fontSize: 11, color: "#dc2626" }}>{biliSearchMsg}</p>}
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94a3b8" }}>⚠️ B站内嵌预览：仅浏览，不能画框/截图/采集；清晰度受 B站登录限制 —— 用同一浏览器登录过 bilibili.com 后可看高清</p>
            </div>

            <button onClick={() => setPickerOpen(false)} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#64748b", fontSize: 13, cursor: "pointer" }}>取消</button>
          </div>
        </div>
      )}

      {/* SOE 单词得分浮窗 — 播放器下方一行，2s 自动消失 */}
      {soeWordPopup && (
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "#0f172a",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
        }}>
          {soeWordPopup.error ? (
            <span style={{ fontSize: 13, color: "#f87171" }}>⚠️ {soeWordPopup.error}</span>
          ) : (
            <>
              <b style={{ fontSize: 13, color: "#fff", flexShrink: 0 }}>🎙 跟读得分 {soeWordPopup.score}</b>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {soeWordPopup.words.map((w, wi) => (
                  <span key={wi} title={`${w.word} · 准确度 ${w.accuracy}`}
                    style={{
                      fontSize: 13, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                      color: w.accuracy >= 80 ? "#4ade80" : w.accuracy >= 60 ? "#fbbf24" : "#f87171",
                      background: `${w.accuracy >= 80 ? "rgba(74,222,128,.12)" : w.accuracy >= 60 ? "rgba(251,191,36,.12)" : "rgba(248,113,113,.12)"}`,
                    }}>
                    {w.word}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 字幕测评区 — 播放器下方 */}
      <section className="card" ref={evalSectionRef} style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>🤖 字幕测评区（{evalResults.length}）</span>
        </div>
        {videoUrl ? (
          <>
            {evaluating && <p className="msg">🤖 识别 + 翻译中…</p>}
            {movieMarks.length > 0 ? (
              activeMark ? (
                <p style={{ fontSize: 12, color: "#16a34a", marginBottom: 8 }}>
                  📍 已定位到字幕点 {activeMark.ts_text}（共 {movieMarks.length} 个标记）
                </p>
              ) : (
                <p className="empty">播放到标记的时间戳点才会显示测评（共 {movieMarks.length} 个标记）</p>
              )
            ) : (
              !evaluating && <p className="empty">暂停播放即可自动生成当前帧测评</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {visibleEvals.map((r, i) => (
                <EvalCard key={r.seq ?? i} r={r} onTts={tts} onReEvaluate={reEvaluate} />
              ))}
            </div>
          </>
        ) : (
          <p className="empty">{source === "bili" ? "🎬 当前为 B站预览模式，不支持测评/采集。请用「📁 本地」或「🔗 云端直链」选片" : "请先选择本地 / 云端 / B站影片"}</p>
        )}
      </section>

      <section className="card">
        {(() => {
          const markSeqs = new Set(movieMarks.map((m) => m.seq))
          const markList = list
            .filter((it) => it.movie_name === movieName)
            .sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))
          // 相邻截图时间戳相差很近（< NEAR_MS）时，将连续相近的项归为一组并红色高亮
          const NEAR_MS = 1500
          const nearSeqs = new Set<number>()
          for (let i = 1; i < markList.length; i++) {
            const prev = markList[i - 1].timestamp_ms || 0
            const cur = markList[i].timestamp_ms || 0
            if (Math.abs(cur - prev) < NEAR_MS) {
              nearSeqs.add(markList[i - 1].seq)
              nearSeqs.add(markList[i].seq)
            }
          }
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>🗂 采集列表 · 本片截图（{markList.length}）</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  {delMode && (
                    <button
                      onClick={() => { setSelected(new Set()); setDelMode(false) }}
                      style={{ minHeight: 44, padding: "4px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #475569", background: "#1e293b", color: "#cbd5e1", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                    >
                      取消
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (delMode) {
                        void doDelete()
                      } else {
                        setDelMode(true)
                        setSelected(new Set())
                      }
                    }}
                    style={{
                      padding: "4px 12px", fontSize: 13, borderRadius: 6, cursor: "pointer", border: "none", minHeight: 44,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: delMode ? "#dc2626" : "#334155", color: "#fff",
                      boxShadow: delMode ? "0 0 0 2px rgba(220,38,38,.4)" : "none",
                    }}
                  >
                    {delMode ? `确认删除（${selected.size}）` : "🗑 删除"}
                  </button>
                </div>
              </div>
              {markList.length === 0 && (
                <p className="empty">当前影片还没有截图（先「💾 存图」或「🔍 识别当前帧」生成截图）</p>
              )}
              {nearSeqs.size > 0 && (
                <p style={{ fontSize: 12, color: "#fca5a5", margin: "0 0 10px" }}>
                  🔴 以下 {nearSeqs.size} 张截图时间相近（&lt;1.5s），方框为字幕采集区域
                </p>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                {markList.map((it) => {
                  const isNear = nearSeqs.has(it.seq)
                  const isSel = delMode && selected.has(it.seq)
                  const c = it.crop as Rect | undefined
                  const vw = it.video_width || 0
                  const vh = it.video_height || 0
                  const showBox = isNear && c && c.w > 0 && c.h > 0 && vw > 0 && vh > 0
                  return (
                    <div
                      key={it.seq}
                      className="cap-item"
                      title={delMode ? "点击选中/取消该截图" : "点击跳转到该时间戳（不自动播放）"}
                      onClick={() => {
                        if (delMode) {
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(it.seq)) next.delete(it.seq)
                            else next.add(it.seq)
                            return next
                          })
                          return
                        }
                        const v = videoRef.current
                        if (!v || !it.timestamp_ms) return
                        v.currentTime = it.timestamp_ms / 1000
                        v.pause()
                        wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
                      }}
                      style={{
                        border: `2px solid ${isSel ? "#22c55e" : isNear ? "#ef4444" : markSeqs.has(it.seq) ? "#f59e0b" : "#334155"}`,
                        borderRadius: 8,
                        overflow: "hidden",
                        cursor: delMode ? "pointer" : "pointer",
                        transition: "border-color .15s",
                        boxShadow: isSel ? "0 0 0 2px rgba(34,197,94,.45)" : isNear ? "0 0 0 2px rgba(239,68,68,.35)" : "none",
                        opacity: delMode && selected.size > 0 && !isSel ? 0.55 : 1,
                      }}
                    >
                      <div style={{ position: "relative", lineHeight: 0 }}>
                        <img src={it.url} alt={`#${it.seq}`} style={{ width: "100%", display: "block", background: "#000" }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3" }} />
                        {delMode && (
                          <div style={{
                            position: "absolute", top: 6, right: 6,
                            width: 22, height: 22, borderRadius: "50%",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 700,
                            background: isSel ? "#22c55e" : "rgba(15,23,42,.7)",
                            color: "#fff", border: isSel ? "none" : "2px solid #cbd5e1",
                          }}>
                            {isSel ? "✓" : ""}
                          </div>
                        )}
                        {showBox && (
                          <div
                            style={{
                              position: "absolute",
                              left: `${(c!.x / vw) * 100}%`,
                              top: `${(c!.y / vh) * 100}%`,
                              width: `${(c!.w / vw) * 100}%`,
                              height: `${(c!.h / vh) * 100}%`,
                              border: "2px solid #ef4444",
                              boxSizing: "border-box",
                              pointerEvents: "none",
                            }}
                          />
                        )}
                      </div>
                      <div style={{ padding: 8, fontSize: 12 }}>
                        <div><b style={{ color: isNear ? "#fca5a5" : "#fff" }}>#{it.seq}</b> · {it.timestamp_text}</div>
                        {it.note && <div style={{ color: "#cbd5e1" }}>📝 {it.note}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )
        })()}
      </section>

      <footer>内网服务 · AiPhonix · 字幕采集</footer>
      {/* 隐藏离屏 canvas，备用 */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  )
}
