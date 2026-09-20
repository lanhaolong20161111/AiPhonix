/** 统一输入框 — 文本/图片可共存，点「提问」统一提交
 *
 * 行为：选图/粘贴图片只预览不识别；文本框与图片可同时存在；
 * 点主按钮「提问」→ onSubmit({ file?, files?, text? }）：
 *   纯文本 → { text }；纯图片 → { file, files }；都有 → { file, files, text }。
 *
 * `multiple`（2026-09-16，仅 AI 语文/数学/英语三页开启）：相册一次可多选，
 * `files` 带上全部选中的图（`file` = 第一张，兼容只看单张的老页面）；
 * 未开启时行为与以前完全一致（只取第一张）。
 */

import { useRef, useState } from "react"
import { OcrEnginePicker } from "./OcrEnginePicker"

export interface AiSubmitPayload {
  /** 第一张图片（兼容既有单图调用方） */
  file?: File | Blob | null
  /** 全部选中的图片（multiple 时可能多张；未开启 multiple 时长度恒为 1） */
  files?: (File | Blob)[]
  /** 图片来源：粘贴 paste / 相册拍照 pick */
  source?: "paste" | "pick"
  text?: string
}

interface AiInputBoxProps {
  /** 点「提问」统一提交（携带可选的 图片 + 文本） */
  onSubmit: (payload: AiSubmitPayload) => void
  /** 点「✂️ 切块识别」时回调（把选到的图片交回页面，由页面转正后弹出切块识别器） */
  onSlice?: (file: File | Blob, source: "paste" | "pick") => void
  /** 点「🖱️ 自由框选」时回调（把选到的图片交回页面，由页面打开自由框选识别器） */
  onFreePick?: (file: File | Blob, source: "paste" | "pick") => void
  buttonLabel?: string
  placeholder?: string
  busy?: boolean
  /** 允许一次选多张照片（结果页会出「第 N 张」切换标签）；默认关闭 */
  multiple?: boolean
  /** 最多可选张数（multiple 时生效，超出只取前 N 张） */
  maxFiles?: number
}

export function AiInputBox({
  onSubmit,
  onSlice,
  onFreePick,
  buttonLabel = "提问",
  placeholder = "输入问题，或粘贴/选择图片（可图文同时），点「提问」",
  busy = false,
  multiple = false,
  maxFiles = 6,
}: AiInputBoxProps) {
  const [text, setText] = useState("")
  const [pastePreview, setPastePreview] = useState("")
  const [pastedFiles, setPastedFiles] = useState<(File | Blob)[]>([])
  const [source, setSource] = useState<"paste" | "pick" | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 选到图片：仅保存并预览，不自动识别；可与文本共存。
   *  多选时**整批替换**（而不是追加）—— 追加会让"再选一张"变成"又多一张"，
   *  与用户预期相反；想全部换掉只需再选一次。 */
  const attachImages = (files: (File | Blob)[], src: "paste" | "pick") => {
    const list = (multiple ? files : files.slice(0, 1)).slice(0, multiple ? maxFiles : 1)
    if (!list.length) return
    setPastedFiles(list)
    setPastePreview(URL.createObjectURL(list[0]))
    setSource(src)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const file = it.getAsFile()
        if (file) {
          e.preventDefault()
          attachImages([file], "paste")
          return
        }
      }
    }
  }

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])]
    if (!list.length) return
    attachImages(list, "pick")
    // 允许再次选择同一文件
    e.target.value = ""
  }

  const clearPaste = () => {
    setPastedFiles([])
    setPastePreview("")
    setSource(null)
  }

  const submit = () => {
    if (busy) return
    if (!pastedFiles.length && !text.trim()) return
    onSubmit({
      file: pastedFiles[0] ?? null,
      files: pastedFiles,
      source: (source ?? undefined) as "paste" | "pick" | undefined,
      text: text.trim() || undefined,
    })
    // 提交后清空文本框文字（图片预览保留）
    setText("")
  }

  const hasInput = pastedFiles.length > 0 || !!text.trim()
  const first = pastedFiles[0] ?? null

  return (
    <div className="card">
      <h2 className="section-title">✍️ 输入 / 粘贴</h2>
      <textarea
        className="essay-textarea"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={handlePaste}
        placeholder={placeholder}
      />
      {pastePreview && (
        <div className="ai-paste-preview">
          <img src={pastePreview} alt="待识别的图片" />
          {pastedFiles.length > 1 && (
            <span className="ai-paste-count">共 {pastedFiles.length} 张 · 按顺序识别（第 1 张优先）</span>
          )}
          <div className="ai-paste-actions">
            <button className="btn-secondary btn-sm" onClick={() => onFreePick?.(first!, source ?? "pick")} disabled={busy || !onFreePick || pastedFiles.length > 1}>
              🖱️ 自由框选
            </button>
            <button className="btn-secondary btn-sm" onClick={() => onSlice?.(first!, source ?? "pick")} disabled={busy || !onSlice || pastedFiles.length > 1}>
              ✂️ 切块识别
            </button>
            <button className="btn-secondary btn-sm" onClick={clearPaste}>
              ✕ 移除
            </button>
          </div>
          {/* 切块/框选只做单张（多选时禁用，避免"框选了第 1 张、其余 4 张无声无息"） */}
          {multiple && pastedFiles.length > 1 && (
            <p className="import-meaning" style={{ marginTop: 6 }}>
              多张照片不支持切块/自由框选，如需精细识别请一次只选一张。
            </p>
          )}
        </div>
      )}
      {/* 识别前选择模型（覆盖整图识别 / 切块 / 自由框选，统一走所选模型） */}
      <OcrEnginePicker />
      <div className="ai-upload-row" style={{ marginTop: 8 }}>
        <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "处理中…" : multiple ? "🖼️ 拍照 / 相册（可多选）" : "🖼️ 拍照 / 相册"}
        </button>
        <button className="btn-primary" onClick={submit} disabled={busy || !hasInput}>
          {busy ? "处理中…" : buttonLabel}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        style={{ display: "none" }}
        onChange={handlePick}
      />
    </div>
  )
}
