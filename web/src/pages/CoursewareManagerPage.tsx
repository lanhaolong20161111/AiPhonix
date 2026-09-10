/** 课件管理页 — 语/数/英课件图片的上传与管理（家长端）
 * 三个科目 tab 各列其课件图；上传可多选（每张图以原文件名为标题）。 */

import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { listCourseware, uploadCourseware, deleteCourseware, type CoursewareItem, type CoursewareModule } from "../services/courseware"
import { detailFromError } from "../services/auth"

const MODULES: CoursewareModule[] = ["math", "chinese", "english"]
const MODULE_LABEL: Record<CoursewareModule, string> = { math: "数学", chinese: "语文", english: "英语" }
const MODULE_ICON: Record<CoursewareModule, string> = { math: "🧮", chinese: "📖", english: "📚" }

function isModule(v: string | null): v is CoursewareModule {
  return v === "math" || v === "chinese" || v === "english"
}

export function CoursewareManagerPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initial = params.get("module")
  const [module, setModule] = useState<CoursewareModule>(isModule(initial) ? initial : "chinese")

  const [items, setItems] = useState<CoursewareItem[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    setError("")
    listCourseware(module)
      .then((data) => setItems(data.items ?? []))
      .catch((e: unknown) => setError(`加载失败: ${detailFromError(e)}`))
      .finally(() => setLoading(false))
  }, [module])

  const switchModule = (m: CoursewareModule) => {
    setModule(m)
    setParams({ module: m }, { replace: true })
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || uploading) return
    setUploading(true)
    setError("")
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData()
        fd.append("file", f)
        fd.append("module", module)
        fd.append("title", f.name.replace(/\.[^.]+$/, ""))
        await uploadCourseware(fd)
      }
      const data = await listCourseware(module)
      setItems(data.items ?? [])
    } catch (e) {
      setError(`上传失败: ${detailFromError(e)}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const handleDelete = async (it: CoursewareItem) => {
    if (!window.confirm(`删除课件「${it.title || it.file_name}」？`)) return
    setError("")
    try {
      await deleteCourseware(it.id)
      setItems((prev) => prev.filter((x) => x.id !== it.id))
    } catch (e) {
      setError(`删除失败: ${detailFromError(e)}`)
    }
  }

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📚 课件库</h1>
      </header>
      <p className="module-hint">按科目上传/管理课件图片，学科页「课件」按钮可选用。</p>

      {/* 科目 tab */}
      <div className="ai-pref-row" style={{ marginBottom: 10 }}>
        {MODULES.map((m) => (
          <button
            key={m}
            className={`ai-pref-chip${module === m ? " active" : ""}`}
            onClick={() => switchModule(m)}
          >
            {MODULE_ICON[m]} {MODULE_LABEL[m]}
          </button>
        ))}
      </div>

      {/* 上传 */}
      <button
        className="btn-primary"
        style={{ width: "100%", marginBottom: 10 }}
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? "上传中…" : "📤 上传课件图片（可多选）"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => void handleFiles(e.target.files)}
      />

      {error && <p className="err">{error}</p>}

      {loading ? (
        <p className="empty" style={{ padding: "24px 0" }}>加载中…</p>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "28px 16px" }}>
          <div style={{ fontSize: 36 }}>📭</div>
          <p className="empty">「{MODULE_LABEL[module]}」还没有课件</p>
        </div>
      ) : (
        <div className="courseware-grid">
          {items.map((it) => (
            <div key={it.id} className="courseware-item">
              <img className="courseware-thumb" src={it.url} alt={it.title || it.file_name} loading="lazy" />
              <div className="courseware-item-actions">
                <span className="courseware-title" title={it.title || it.file_name}>
                  {it.title || it.file_name.slice(0, 12)}
                </span>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => void handleDelete(it)}
                  title="删除"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
