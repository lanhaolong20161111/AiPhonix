/** AI 数学作业页 — 拍照/粘贴图片 → 识别；输入文本 → 直接提问 LLM 回答 */

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { type ParseImageResult, type ParseStage } from "../../services/aiImage"
import { prepareImageFile } from "../../lib/imageCompress"
import { startParseBatch } from "../../lib/parseBatch"
import { AiInputBox } from "../../components/AiInputBox"
import { ParseTimer } from "../../components/ParseTimer"
import { AiChatPanel } from "../../components/AiChatPanel"
import { ImageSliceSheet } from "../../components/ImageSliceSheet"
import { OcrPickSheet } from "../../components/OcrPickSheet"
import { CoursewarePickerSheet } from "../../components/CoursewarePickerSheet"
import { useParseSessionStore, newSessionId } from "../../stores/parseSessionStore"
import { useAiChat } from "../../hooks/useAiChat"

export function AiHomeworkPage() {
  const navigate = useNavigate()
  const [error, setError] = useState("")

  const [parsing, setParsing] = useState(false)
  // 识别分阶段进度（处理图片→上传→AI识别中），展示给用户降低等待焦虑
  const [parseStage, setParseStage] = useState<ParseStage | null>(null)

  // 切块识别：待切块的图片（已转正）+ 是否打开切块选择器
  const [sliceTarget, setSliceTarget] = useState<{ file: File | Blob; previewUrl: string } | null>(null)
  // 自由框选识别：待框选的图片
  const [freePickTarget, setFreePickTarget] = useState<{ file: File; previewUrl: string } | null>(null)

  // 多轮对话（纯文本提问）
  const chat = useAiChat("math")
  // 课件选择弹层
  const [coursewareOpen, setCoursewareOpen] = useState(false)

  /** 课件选中：包成 File 走「仅图片→识别结果页」，与拍照一致 */
  const onCoursewarePick = (blob: Blob, fileName: string) => {
    setCoursewareOpen(false)
    const file = new File([blob], fileName, { type: blob.type || "image/jpeg" })
    void submitImages([file])
  }

  /** 提交一批照片（2026-09-16）：第 1 张前台优先识别、成功即跳结果页；
   *  其余照片由 parseBatch 在后台依次识别，结果页「第 N 张」标签上能看到进度。
   *  `omitStructured`：沿用数学整图识别的既有口径（不落 blocks/crops，展示退回题目列表），
   *  避免本次改动顺带改变数学卷面的渲染方式。 */
  const submitImages = async (files: (File | Blob)[], initialQuestion?: string) => {
    if (!files.length) return
    setParsing(true)
    setParseStage("preparing")
    setError("")
    try {
      const r = await startParseBatch({
        files,
        module: "math",
        onStage: setParseStage,
        initialQuestion,
        omitStructured: true,
      })
      if (!r.ok) {
        setError(r.error ?? "识别失败，请重试")
        return
      }
      navigate("/module/ai_parse_result")
    } finally {
      setParsing(false)
      setParseStage(null)
    }
  }

  /** 统一提交：仅图片→跳结果页识别（保留逐字点读/标记）；图片+文本→对话多模态；纯文本→对话 */
  const handleSubmit = async (payload: { file?: File | Blob | null; files?: (File | Blob)[]; source?: "paste" | "pick"; text?: string }) => {
    setError("")
    const q = payload.text?.trim() ?? ""
    if (payload.file && q) {
      await chat.askWithImage(q, payload.file)
      return
    }
    if (payload.file) {
      // 仅图片 → 跳结果页识别（多张时第 1 张优先，其余后台依次识别）
      await submitImages(payload.files?.length ? payload.files : [payload.file])
      return
    }
    if (q) {
      await chat.ask(q)
    }
  }

  /** 切块识别完成：合并结果直接写入会话并跳结果页 */
  const gotoSliceResult = (result: ParseImageResult, previewUrl: string) => {
    setError("")
    useParseSessionStore.getState().setSession({
      sessionId: newSessionId(),
      module: "math",
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
      module: "math",
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
  }

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🧮 AI 数学</h1>
      </header>
      <p className="module-hint">拍照识别题目（可一次选多张，第 1 张先出结果）或输入文字，点「提问」让 AI 直接解答/讲解。</p>

      <div className="ai-header-actions">
        <button
          className="btn-secondary"
          onClick={() => navigate("/module/ai_history?module=math")}
        >
          🗂 历史会话
        </button>
        <button className="btn-secondary" onClick={() => setCoursewareOpen(true)}>
          📚 课件
        </button>
      </div>

      {/* 识别分阶段进度：处理图片→上传→AI识别中（替代笼统"处理中"） */}
      {parseStage && (
        <p className="ai-parse-status">
          <ParseTimer active={parsing || chat.asking} />{" "}
          {parseStage === "preparing"
            ? "🖼️ 正在处理图片（方向纠正/压缩）…"
            : parseStage === "uploading"
              ? "⬆️ 图片已就绪，正在上传…"
              : "🔍 AI 识别中，整页/复杂图片约需 30–60 秒，请稍候…"}
        </p>
      )}

      {/* 统一输入：文本提问 或 粘贴/选择图片后点「提问」识别；选图后可「🖱️ 自由框选」或「✂️ 切块识别」 */}
      <AiInputBox onSubmit={handleSubmit} onSlice={openSlice} onFreePick={openFreePick} busy={parsing || chat.asking} buttonLabel="提问" multiple />

      {/* 多轮对话记录（含问答定位条） */}
      {chat.turns.length > 0 && <AiChatPanel chat={chat} />}

      {error && <p className="err">{error}</p>}
      {chat.error && <p className="err">{chat.error}</p>}

      {/* 切块识别选择器 */}
      {sliceTarget && (
        <ImageSliceSheet
          file={sliceTarget.file}
          module="math"
          onClose={() => setSliceTarget(null)}
          onDone={gotoSliceResult}
        />
      )}

      {/* 自由框选识别器：手动拖框选区域 → 点「开始识别」→ 跳结果页 */}
      {freePickTarget && (
        <OcrPickSheet
          file={freePickTarget.file}
          title="📷 自由框选识别"
          module="math"
          onClose={() => setFreePickTarget(null)}
          onConfirmResult={gotoFreePickResult}
        />
      )}

      {/* 课件选择：选一张课件图当拍照识别 */}
      <CoursewarePickerSheet
        open={coursewareOpen}
        module="math"
        onClose={() => setCoursewareOpen(false)}
        onPick={onCoursewarePick}
      />
    </div>
  )
}
