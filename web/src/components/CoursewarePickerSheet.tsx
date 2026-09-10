/** 课件选择弹层 — 学科页「课件」按钮打开：按科目列出课件图片，点选即「当拍照识别」。
 * 复用 settings-sheet 底部弹层结构与样式；选中图片走 api() 带鉴权下载 Blob 回传页面。 */

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { listCourseware, uploadCourseware, deleteCourseware, fetchCoursewareImage, type CoursewareItem, type CoursewareModule } from "../services/courseware"

interface CoursewarePickerSheetProps {
  open: boolean
  module: CoursewareModule
  onClose: () => void
  /** 选中一张课件：blob 为带鉴权下载的原图，fileName 为服务端文件名（作为 File 名） */
  onPick: (blob: Blob, fileName: string) => void
}

const MODULE_LABEL: Record<CoursewareModule, string> = {
  chinese: "语文",
  math: "数学",
  english: "英语",
}

export function CoursewarePickerSheet({ open, module, onClose, onPick }: CoursewarePickerSheetProps) {
  const navigate = useNavigate()
  const [items, setItems] = useState<CoursewareItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [pickingId, setPickingId] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError("")
    listCourseware(module)
      .then((data) => {
        if (!cancelled) setItems(data.items ?? [])
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载课件失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, module])

  const goManager = () => {
    onClose()
    navigate(`/module/courseware_manager?module=${module}`)
  }

  const refresh = () => {
    listCourseware(module)
      .then((data) => setItems(data.items ?? []))
      .catch(() => setError("刷新课件失败"))
  }

  const pick = async (it: CoursewareItem) => {
    if (pickingId != null) return
    setPickingId(it.id)
    setError("")
    try {
      const blob = await fetchCoursewareImage(it)
      onPick(blob, it.file_name)
    } catch (e) {
      setError(e instanceof Error ? e.message : "课件图片下载失败")
    } finally {
      setPickingId(null)
    }
  }

  const del = async (it: CoursewareItem) => {
    if (pickingId != null) return
    setPickingId(it.id)
    setError("")
    try {
      await deleteCourseware(it.id)
      setItems((prev) => prev.filter((x) => x.id !== it.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败")
    } finally {
      setPickingId(null)
    }
  }

  const handleUploadFile = async (f: File | undefined) => {
    if (!f) return
    const fd = new FormData()
    fd.append("file", f)
    fd.append("module", module)
    fd.append("title", f.name.replace(/\.[^.]+$/, ""))
    setError("")
    try {
      await uploadCourseware(fd)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败")
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="选择课件"
      >
        <div className="settings-sheet-head">
          <span className="settings-sheet-title">📚 {MODULE_LABEL[module]}课件</span>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-sheet-body">
          {loading ? (
            <p className="empty" style={{ padding: "24px 0" }}>加载课件中…</p>
          ) : items.length === 0 && !error ? (
            <div className="card" style={{ textAlign: "center", padding: "24px 16px" }}>
              <div style={{ fontSize: 36 }}>📭</div>
              <p className="empty">暂无课件，先去上传</p>
            </div>
          ) : (
            <div className="courseware-grid">
              {items.map((it) => (
                <div key={it.id} className="courseware-item">
                  <img
                    className={`courseware-thumb${pickingId === it.id ? " picking" : ""}`}
                    src={it.url}
                    alt={it.title || it.file_name}
                    loading="lazy"
                    onClick={() => void pick(it)}
                  />
                  <div className="courseware-item-actions">
                    <span className="courseware-title" title={it.title || it.file_name}>
                      {it.title || it.file_name.slice(0, 12)}
                    </span>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        void del(it)
                      }}
                      title="删除"
                      disabled={pickingId != null}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="err">{error}</p>}

          <div className="courseware-sheet-foot">
            <button
              className="btn-secondary"
              style={{ flex: 1 }}
              onClick={() => fileRef.current?.click()}
              disabled={pickingId != null}
            >
              📤 上传
            </button>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={goManager}>
              🗂 管理课件
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => void handleUploadFile(e.target.files?.[0])}
          />
        </div>
      </div>
    </div>
  )
}
