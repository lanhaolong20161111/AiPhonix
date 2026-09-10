/** AI 语文页 — 粘贴/拍照图片 → 识别；输入文本 → 直接提问 LLM 回答 */

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { parseImage, parseImageStream, type ParseImageResult, type ParseStage } from "../services/aiImage"
import { prepareImageFile } from "../lib/imageCompress"
import { useTts } from "../hooks/useTts"
import { AiInputBox } from "../components/AiInputBox"
import { ParseTimer } from "../components/ParseTimer"
import { AiChatPanel } from "../components/AiChatPanel"
import { ImageSliceSheet } from "../components/ImageSliceSheet"
import { OcrPickSheet } from "../components/OcrPickSheet"
import { CoursewarePickerSheet } from "../components/CoursewarePickerSheet"
import { useParseSessionStore, newSessionId } from "../stores/parseSessionStore"
import { schedulePolyPatch } from "../lib/polyPatch"
import { useAiChat } from "../hooks/useAiChat"
import { detailFromError } from "../services/auth"

export function AiChinesePage() {
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [parsing, setParsing] = useState(false)
  // 识别分阶段进度（处理图片→上传→AI识别中），展示给用户降低等待焦虑
  const [parseStage, setParseStage] = useState<ParseStage | null>(null)
  // 流式识图：边识别边追加的实时文字（学生 1~3s 就能开始读）
  const [liveLines, setLiveLines] = useState<string[]>([])
  // 流式期间正在朗读的行号（-1 无）；点行朗读 / 再点停止
  const [readingIdx, setReadingIdx] = useState(-1)
  // 提前结束：abort 流式请求，用已收到的文字直接进结果页
  const abortRef = useRef<AbortController | null>(null)
  const tts = useTts()
  // 播放结束自动清除朗读态
  useEffect(() => {
    if (!tts.speaking) setReadingIdx(-1)
  }, [tts.speaking])
  /** 点实时行朗读（正在读该行则停止） */
  const readLiveLine = (text: string, i: number) => {
    if (readingIdx === i && tts.speaking) {
      tts.stop()
      setReadingIdx(-1)
      return
    }
    tts.stop()
    setReadingIdx(i)
    void tts.speak(text)
  }
  // 已出字数（不含换行，给家长/孩子一个"进度感"）
  const liveChars = liveLines.reduce((n, t) => n + t.length, 0)

  // 切块识别：待切块的图片（已转正）+ 是否打开切块选择器
  const [sliceTarget, setSliceTarget] = useState<{ file: File | Blob; previewUrl: string } | null>(null)
  // 自由框选识别：待框选的图片
  const [freePickTarget, setFreePickTarget] = useState<{ file: File; previewUrl: string } | null>(null)

  // 多轮对话（纯文本提问）
  const chat = useAiChat("chinese")
  // 课件选择弹层
  const [coursewareOpen, setCoursewareOpen] = useState(false)

  /** 课件选中：包成 File 走「仅图片→识别结果页」，与拍照一致 */
  const onCoursewarePick = (blob: Blob, fileName: string) => {
    setCoursewareOpen(false)
    const file = new File([blob], fileName, { type: blob.type || "image/jpeg" })
    void handleSubmit({ file, source: "pick" })
  }

  const gotoParseResult = (file: File | Blob, previewUrl: string, noCache: boolean, initialQuestion?: string) => {
    setParsing(true)
    setParseStage("preparing")
    setLiveLines([])
    setReadingIdx(-1)
    setError("")
    const controller = new AbortController()
    abortRef.current = controller
    void (async () => {
      try {
        // 流式优先：边识别边显示文字（首行 1~3s）；不可用/未出字则回退非流式完整链路
        let res = await parseImageStream(file, "chinese", noCache, {
          onStage: setParseStage,
          onLine: (t) => setLiveLines((prev) => [...prev, t]),
          signal: controller.signal,
        })
        // 用户点了「就按这些字来」→ 不再回退非流式，直接用已收到的部分文字
        if (!res) {
          if (controller.signal.aborted) return
          res = await parseImage(file, "chinese", noCache, setParseStage)
        }
        if (!res.text?.trim()) {
          setError("没识别到文字，换一张更清晰的照片试试～")
          return
        }
        useParseSessionStore.getState().setSession({
          sessionId: newSessionId(),
          module: "chinese",
          text: res.text ?? "",
          questions: res.questions?.length ? res.questions : res.text ? [res.text] : [],
          blocks: res.blocks ?? [],
          pageBounds: res.page_bounds ?? null,
          previewUrl,
          file,
          initialQuestion,
        })
        navigate("/module/ai_parse_result")
        // 注音后台补齐（服务端已先返回正文），就绪后自动回填到结果页
        schedulePolyPatch(res, "chinese")
      } catch (err) {
        if (controller.signal.aborted) return
        setError(`识别失败: ${detailFromError(err)}`)
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setParsing(false)
        setParseStage(null)
        setLiveLines([])
        setReadingIdx(-1)
      }
    })()
  }

  /** 提前结束识别：中断流式请求，用已识别的文字直接进结果页 */
  const finishNow = () => {
    tts.stop()
    abortRef.current?.abort()
  }

  /** 统一提交：仅图片→跳结果页识别（保留逐字点读/标记）；图片+文本→对话多模态；纯文本→对话 */
  const handleSubmit = async (payload: { file?: File | Blob | null; source?: "paste" | "pick"; text?: string }) => {
    setError("")
    const q = payload.text?.trim() ?? ""
    if (payload.file && q) {
      // 图 + 文本 → 对话里一起问
      await chat.askWithImage(q, payload.file)
      return
    }
    if (payload.file) {
      // 仅图片 → 跳结果页识别（File 走 EXIF/横拍方向纠正转正）
      // 仅图片 → 跳结果页识别。prepareImageFile 单次完成转正+压缩
      //（2026-09-02：原 orientImageFile 重编码一次、parseImage 内再压缩一次，双重处理）
      let prepared: File | Blob = payload.file
      try {
        prepared = await prepareImageFile(payload.file, 1600, 0.85)
      } catch {
        prepared = payload.file
      }
      gotoParseResult(prepared, URL.createObjectURL(prepared), false, undefined)
      return
    }
    if (q) {
      await chat.ask(q)
    }
  }

  /** 切块识别完成：把合并结果直接写入会话并跳结果页（不再重复整图识别） */
  const gotoSliceResult = (result: ParseImageResult, previewUrl: string) => {
    setError("")
    useParseSessionStore.getState().setSession({
      sessionId: newSessionId(),
      module: "chinese",
      text: result.text ?? "",
      questions: result.questions?.length ? result.questions : result.text ? [result.text] : [],
      blocks: result.blocks ?? [],
      pageBounds: result.page_bounds ?? null,
      previewUrl,
      file: sliceTarget?.file ?? null,
      crops: result.crops ?? [],
    })
    setSliceTarget(null)
    navigate("/module/ai_parse_result")
    // 切块每段各自后台补注音，按区间回填
    schedulePolyPatch(result, "chinese")
  }

  /** 「✂️ 切块识别」：转正图片 → 打开切块选择器 */
  const openSlice = async (file: File | Blob) => {
    setError("")
    // prepareImageFile 单次转正+压缩（1600px），切块/框选在更小的图上工作更快
    let oriented: File | Blob = file
    try {
      oriented = await prepareImageFile(file, 1600, 0.85)
    } catch {
      oriented = file
    }
    setSliceTarget({ file: oriented, previewUrl: URL.createObjectURL(oriented) })
  }

  /** 「🖱️ 自由框选」：转正图片 → 打开自由框选识别器 */
  const openFreePick = async (file: File | Blob) => {
    setError("")
    // prepareImageFile 单次转正+压缩（1600px），切块/框选在更小的图上工作更快
    let oriented: File | Blob = file
    try {
      oriented = await prepareImageFile(file, 1600, 0.85)
    } catch {
      oriented = file
    }
    // OcrPickSheet 需要 File（内部做 detectTextBlocks 用 File）；Blob 转 File
    const asFile = oriented instanceof File ? oriented : new File([oriented], "frame.jpg", { type: oriented.type })
    setFreePickTarget({ file: asFile, previewUrl: URL.createObjectURL(asFile) })
  }

  /** 自由框选识别完成：合并结果写入会话并跳结果页 */
  const gotoFreePickResult = (result: ParseImageResult, previewUrl: string) => {
    setError("")
    useParseSessionStore.getState().setSession({
      sessionId: newSessionId(),
      module: "chinese",
      text: result.text ?? "",
      questions: result.questions?.length ? result.questions : result.text ? [result.text] : [],
      blocks: result.blocks ?? [],
      pageBounds: result.page_bounds ?? null,
      previewUrl,
      file: freePickTarget?.file ?? null,
      crops: result.crops ?? [],
    })
    setFreePickTarget(null)
    navigate("/module/ai_parse_result")
    // 每个框独立后台补注音，按区间回填
    schedulePolyPatch(result, "chinese")
  }

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📖 AI 语文</h1>
      </header>
      <p className="module-hint">拍照识别课文，或在框内输入问题/内容，点「提问」让 AI 直接回答。</p>

      <div className="ai-header-actions">
        <button
          className="btn-secondary"
          onClick={() => navigate("/module/ai_history?module=chinese")}
        >
          🗂 历史会话
        </button>
        <button className="btn-secondary" onClick={() => setCoursewareOpen(true)}>
          📚 课件
        </button>
      </div>

      {/* 识别分阶段进度：处理图片→上传→AI识别中（替代笼统"处理中"） */}
      {parseStage && (
        <p style={{ margin: "6px 4px", fontSize: 13, color: "#2563eb", fontWeight: 500 }}>
          <ParseTimer active={parsing || chat.asking} />{" "}
          {parseStage === "preparing"
            ? "🖼️ 正在处理图片（方向纠正/压缩）…"
            : parseStage === "uploading"
              ? "⬆️ 图片已就绪，正在上传…"
              : "🔍 AI 识别中，整页/复杂图片约需 30–60 秒，请稍候…"}
        </p>
      )}

      {/* 流式识图：边识别边显示文字，学生可先读/点读已出的部分（不必等整页完成） */}
      {liveLines.length > 0 && (
        <div className="parse-live">
          <div className="parse-live-head">
            <span>
              ✨ 正在识别 · 已出 {liveLines.length} 行 / {liveChars} 字
            </span>
            <button type="button" className="parse-live-finish" onClick={finishNow}>
              就按这些字来 →
            </button>
          </div>
          <p className="parse-live-hint">👆 点任意一行可以听读音</p>
          <div className="parse-live-body">
            {liveLines.map((t, i) => (
              <p
                key={i}
                className={`parse-live-line${readingIdx === i ? " reading" : ""}`}
                onClick={() => readLiveLine(t, i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    readLiveLine(t, i)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                {t}
                {readingIdx === i && <span className="parse-live-speaker">🔊</span>}
              </p>
            ))}
            <span className="parse-live-caret" />
          </div>
        </div>
      )}

      {/* 统一输入：文本提问 或 粘贴/选择图片后点「提问」识别；选图后可「🖱️ 自由框选」或「✂️ 切块识别」 */}
      <AiInputBox onSubmit={handleSubmit} onSlice={openSlice} onFreePick={openFreePick} busy={parsing || chat.asking} buttonLabel="提问" />

      {/* 多轮对话记录（含问答定位条） */}
      {chat.turns.length > 0 && <AiChatPanel chat={chat} />}

      {error && <p className="err">{error}</p>}
      {chat.error && <p className="err">{chat.error}</p>}

      {/* 切块识别选择器：自动/手动切块 → 合并 → 跳结果页 */}
      {sliceTarget && (
        <ImageSliceSheet
          file={sliceTarget.file}
          module="chinese"
          onClose={() => setSliceTarget(null)}
          onDone={gotoSliceResult}
        />
      )}

      {/* 自由框选识别器：手动拖框选区域 → 点「开始识别」→ 跳结果页 */}
      {freePickTarget && (
        <OcrPickSheet
          file={freePickTarget.file}
          title="📷 自由框选识别"
          module="chinese"
          onClose={() => setFreePickTarget(null)}
          onConfirmResult={gotoFreePickResult}
        />
      )}

      {/* 课件选择：选一张课件图当拍照识别 */}
      <CoursewarePickerSheet
        open={coursewareOpen}
        module="chinese"
        onClose={() => setCoursewareOpen(false)}
        onPick={onCoursewarePick}
      />
    </div>
  )
}
