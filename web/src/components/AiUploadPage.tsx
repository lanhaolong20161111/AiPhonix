/** AI 上传页 —— AI 语文 / AI 英语 / AI 数学 三页共用的同一条流程：
 *  拍照·粘贴图片 → 识别跳结果页；纯文本 → 直接问 LLM；选图后还能「✂️ 切块」或「🖱️ 自由框选」。
 *
 * 折叠前这三页是**逐行复制**的三份实现，`git diff` 只差组件名 / mode / 标题 / 提示文案，
 * 外加中文独有的注音回填与数学独有的扁平口径 —— 改一处要改三处。现在页面只给 mode 与文案。
 *
 * ⚠️ 下面三个开关对应**有意保留的行为差异**，不要"顺手统一"：
 *   - `polyPatch`      中文：「切块 / 自由框选」路径不走 parseBatch，所以要各段自己后台补注音。
 *   - `omitStructured` 数学：整图识别沿用扁平口径（不落 blocks/crops，展示退回题目列表）。
 *   - `plainStatus`    语文：进度提示历史上用朴素内联样式，与另两页的 `.ai-parse-status`
 *                      卡片**视觉不同**；此处按原样保留，避免折叠顺带改 UI。
 */

import { useState, type CSSProperties } from "react"
import { useNavigate } from "react-router-dom"
import { type ParseImageResult, type ParseStage } from "../services/aiImage"
import { prepareImageFile } from "../lib/imageCompress"
import { startParseBatch } from "../lib/parseBatch"
import { schedulePolyPatch } from "../lib/polyPatch"
import { useParseSessionStore, newSessionId } from "../stores/parseSessionStore"
import { useAiChat } from "../hooks/useAiChat"
import { AiInputBox } from "./AiInputBox"
import { ParseTimer } from "./ParseTimer"
import { AiChatPanel } from "./AiChatPanel"
import { ImageSliceSheet } from "./ImageSliceSheet"
import { OcrPickSheet } from "./OcrPickSheet"
import { CoursewarePickerSheet } from "./CoursewarePickerSheet"

/** 与 `lib/parseBatch` 的 `BatchModule` 同一集合 */
export type AiUploadMode = "chinese" | "english" | "math"

export interface AiUploadPageProps {
  mode: AiUploadMode
  /** 页头标题（含 emoji） */
  title: string
  /** 标题下的一行提示 */
  hint: string
  /** 中文专属：切块 / 自由框选路径后台补注音 */
  polyPatch?: boolean
  /** 数学专属：整图识别不落 blocks/crops */
  omitStructured?: boolean
  /** 语文专属：进度提示用朴素内联样式（不用 `.ai-parse-status` 卡片） */
  plainStatus?: boolean
}

/** 语文页历史的进度提示内联样式，原样搬过来（保证视觉零变化） */
const PLAIN_STATUS_STYLE: CSSProperties = { margin: "6px 4px", fontSize: 13, color: "#2563eb", fontWeight: 500 }

export function AiUploadPage({ mode, title, hint, polyPatch = false, omitStructured = false, plainStatus = false }: AiUploadPageProps) {
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [parsing, setParsing] = useState(false)
  // 识别分阶段进度（处理图片→上传→AI识别中），展示给用户降低等待焦虑
  const [parseStage, setParseStage] = useState<ParseStage | null>(null)

  // 切块识别：待切块的图片（已转正）
  const [sliceTarget, setSliceTarget] = useState<{ file: File | Blob; previewUrl: string } | null>(null)
  // 自由框选识别：待框选的图片
  const [freePickTarget, setFreePickTarget] = useState<{ file: File; previewUrl: string } | null>(null)

  // 多轮对话（纯文本提问）
  const chat = useAiChat(mode)
  // 课件选择弹层
  const [coursewareOpen, setCoursewareOpen] = useState(false)

  /** 课件选中：包成 File 走「仅图片→识别结果页」，与拍照一致 */
  const onCoursewarePick = (blob: Blob, fileName: string) => {
    setCoursewareOpen(false)
    const file = new File([blob], fileName, { type: blob.type || "image/jpeg" })
    void submitImages([file])
  }

  /** 提交一批照片（2026-09-16）：第 1 张前台优先识别、成功即跳结果页；
   *  其余照片由 parseBatch 在后台依次识别，结果页「第 N 张」标签上能看到进度。 */
  const submitImages = async (files: (File | Blob)[], initialQuestion?: string) => {
    if (!files.length) return
    setParsing(true)
    setParseStage("preparing")
    setError("")
    try {
      const r = await startParseBatch({ files, module: mode, onStage: setParseStage, initialQuestion, omitStructured })
      if (!r.ok) {
        setError(r.error ?? "识别失败，请重试")
        return
      }
      navigate("/module/ai_parse_result")
      // 注音由 parseBatch 逐页后台补齐（服务端已先返回正文），就绪后自动回填到结果页
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
      // 图 + 文本 → 对话里一起问
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

  /** 切块识别完成：把合并结果直接写入会话并跳结果页（不再重复整图识别） */
  const gotoSliceResult = (result: ParseImageResult, previewUrl: string) => {
    setError("")
    useParseSessionStore.getState().setSession({
      sessionId: newSessionId(),
      module: mode,
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
    // 切块每段各自后台补注音，按区间回填（仅中文）
    if (polyPatch) schedulePolyPatch(result, mode)
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
      module: mode,
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
    // 每个框独立后台补注音，按区间回填（仅中文）
    if (polyPatch) schedulePolyPatch(result, mode)
  }

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>{title}</h1>
      </header>
      <p className="module-hint">{hint}</p>

      <div className="ai-header-actions">
        <button className="btn-secondary" onClick={() => navigate(`/module/ai_history?module=${mode}`)}>
          🗂 历史会话
        </button>
        <button className="btn-secondary" onClick={() => setCoursewareOpen(true)}>
          📚 课件
        </button>
      </div>

      {/* 识别分阶段进度：处理图片→上传→AI识别中（替代笼统"处理中"） */}
      {parseStage && (
        <p className={plainStatus ? undefined : "ai-parse-status"} style={plainStatus ? PLAIN_STATUS_STYLE : undefined}>
          <ParseTimer active={parsing || chat.asking} />{" "}
          {parseStage === "preparing"
            ? "🖼️ 正在处理图片（方向纠正/压缩）…"
            : parseStage === "uploading"
              ? "⬆️ 图片已就绪，正在上传…"
              : "🔍 AI 识别中，整页/复杂图片约需 30–60 秒，请稍候…"}
        </p>
      )}

      {/* 统一输入：文本提问 或 粘贴/选择图片后点「提问」识别；选图后可「🖱️ 自由框选」或「✂️ 切块识别」。
          可一次选多张照片：第 1 张先识别出结果，其余在后台依次识别，结果页用「第 N 张」标签切换。 */}
      <AiInputBox
        onSubmit={handleSubmit}
        onSlice={openSlice}
        onFreePick={openFreePick}
        busy={parsing || chat.asking}
        buttonLabel="提问"
        multiple
      />

      {/* 多轮对话记录（含问答定位条） */}
      {chat.turns.length > 0 && <AiChatPanel chat={chat} />}

      {error && <p className="err">{error}</p>}
      {chat.error && <p className="err">{chat.error}</p>}

      {/* 切块识别选择器：自动/手动切块 → 合并 → 跳结果页 */}
      {sliceTarget && (
        <ImageSliceSheet
          file={sliceTarget.file}
          module={mode}
          onClose={() => setSliceTarget(null)}
          onDone={gotoSliceResult}
        />
      )}

      {/* 自由框选识别器：手动拖框选区域 → 点「开始识别」→ 跳结果页 */}
      {freePickTarget && (
        <OcrPickSheet
          file={freePickTarget.file}
          title="📷 自由框选识别"
          module={mode}
          onClose={() => setFreePickTarget(null)}
          onConfirmResult={gotoFreePickResult}
        />
      )}

      {/* 课件选择：选一张课件图当拍照识别 */}
      <CoursewarePickerSheet
        open={coursewareOpen}
        module={mode}
        onClose={() => setCoursewareOpen(false)}
        onPick={onCoursewarePick}
      />
    </div>
  )
}
