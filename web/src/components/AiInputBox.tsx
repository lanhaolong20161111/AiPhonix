/** 统一输入框 — 文本/图片可共存，点「提问」统一提交
 *
 * 行为：选图/粘贴图片只预览不识别；文本框与图片可同时存在；
 * 点主按钮「提问」→ onSubmit({ file?, text? })：
 *   纯文本 → { text }；纯图片 → { file }；都有 → { file, text }。
 */

import { useRef, useState } from "react"
import { OcrEnginePicker } from "./OcrEnginePicker"

export interface AiSubmitPayload {
  file?: File | Blob | null
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
}

export function AiInputBox({
  onSubmit,
  onSlice,
  onFreePick,
  buttonLabel = "提问",
  placeholder = "输入问题，或粘贴/选择图片（可图文同时），点「提问」",
  busy = false,
}: AiInputBoxProps) {
  const [text, setText] = useState("")
  const [pastePreview, setPastePreview] = useState("")
  const [pastedFile, setPastedFile] = useState<File | Blob | null>(null)
  const [source, setSource] = useState<"paste" | "pick" | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 选到图片：仅保存并预览，不自动识别；可与文本共存 */
  const attachImage = (file: File | Blob, src: "paste" | "pick") => {
    setPastedFile(file)
    setPastePreview(URL.createObjectURL(file))
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
          attachImage(file, "paste")
          return
        }
      }
    }
  }

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    attachImage(file, "pick")
    // 允许再次选择同一文件
    e.target.value = ""
  }

  const clearPaste = () => {
    setPastedFile(null)
    setPastePreview("")
    setSource(null)
  }

  const submit = () => {
    if (busy) return
    if (!pastedFile && !text.trim()) return
    onSubmit({
      file: pastedFile ?? null,
      source: (source ?? undefined) as "paste" | "pick" | undefined,
      text: text.trim() || undefined,
    })
    // 提交后清空文本框文字（图片预览保留）
    setText("")
  }

  const hasInput = !!pastedFile || !!text.trim()

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
          <div className="ai-paste-actions">
            <button className="btn-secondary btn-sm" onClick={() => onFreePick?.(pastedFile!, source ?? "pick")} disabled={busy || !onFreePick}>
              🖱️ 自由框选
            </button>
            <button className="btn-secondary btn-sm" onClick={() => onSlice?.(pastedFile!, source ?? "pick")} disabled={busy || !onSlice}>
              ✂️ 切块识别
            </button>
            <button className="btn-secondary btn-sm" onClick={clearPaste}>
              ✕ 移除
            </button>
          </div>
        </div>
      )}
      {/* 识别前选择模型（覆盖整图识别 / 切块 / 自由框选，统一走所选模型） */}
      <OcrEnginePicker />
      <div className="ai-upload-row" style={{ marginTop: 8 }}>
        <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "处理中…" : "🖼️ 拍照 / 相册"}
        </button>
        <button className="btn-primary" onClick={submit} disabled={busy || !hasInput}>
          {busy ? "处理中…" : buttonLabel}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePick} />
    </div>
  )
}
