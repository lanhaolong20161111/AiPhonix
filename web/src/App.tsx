import { useCallback, useEffect, useRef, useState } from "react"
import "./App.css"
import SoeDemo from "./SoeDemo"
import { listUploads, uploadPhoto, uploadText, type UploadItem } from "./services/uploads"

function formatTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function PhotoUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [origin, setOrigin] = useState("")
  const [preview, setPreview] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    if (!file) {
      setPreview("")
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const upload = async () => {
    if (!file) return
    setBusy(true)
    setMsg("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("note", note)
      fd.append("origin", origin)
      const r = await uploadPhoto(fd)
      setMsg(`✅ 上传成功 id=${r.id}，正在后台识别文字…`)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ""
      onUploaded()
    } catch (e) {
      setMsg(`❌ 上传失败: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>📷 拍照 / 选图上传</h2>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {preview && <img className="preview" src={preview} alt="预览" />}
      <input
        className="note"
        placeholder="📖 出处（如：二年级语文上册 P23）"
        value={origin}
        onChange={(e) => setOrigin(e.target.value)}
      />
      <input
        className="note"
        placeholder="备注（可选）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button disabled={!file || busy} onClick={upload}>
        {busy ? "上传中…" : "上传"}
      </button>
      {msg && <p className="msg">{msg}</p>}
    </section>
  )
}

function TextUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const [text, setText] = useState("")
  const [note, setNote] = useState("")
  const [origin, setOrigin] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")

  const upload = async () => {
    if (!text.trim()) return
    setBusy(true)
    setMsg("")
    try {
      const r = await uploadText({ text, note, origin })
      setMsg(`✅ 已保存 id=${r.id}`)
      setText("")
      onUploaded()
    } catch (e) {
      setMsg(`❌ 上传失败: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>📝 文本上传</h2>
      <textarea
        rows={4}
        placeholder="输入要保存的文本内容…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        className="note"
        placeholder="📖 出处（如：Muzzy 第 3 集字幕）"
        value={origin}
        onChange={(e) => setOrigin(e.target.value)}
      />
      <input
        className="note"
        placeholder="备注（可选）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button disabled={!text.trim() || busy} onClick={upload}>
        {busy ? "上传中…" : "保存"}
      </button>
      {msg && <p className="msg">{msg}</p>}
    </section>
  )
}

function UploadList() {
  const [items, setItems] = useState<UploadItem[]>([])

  const load = useCallback(async () => {
    try {
      const data = await listUploads(20)
      setItems(data.items ?? [])
    } catch {
      /* 忽略加载失败 */
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000) // 5 秒轮询，自动刷新 OCR 结果
    return () => clearInterval(timer)
  }, [load])

  return (
    <section className="card">
      <h2>🗂 最近上传（{items.length}）</h2>
      {items.length === 0 && <p className="empty">还没有上传记录</p>}
      {items.map((it) => (
        <div key={it.id} className="row">
          {it.kind === "photo" ? (
            <img className="thumb" src={it.url} alt="上传图" />
          ) : (
            <div className="thumb placeholder">📄</div>
          )}
          <div className="row-body">
            <div className="row-title">
              {it.kind === "photo" ? `图片 #${it.id}` : `文本 #${it.id}`}
              {it.origin && <span className="origin-tag">📖 {it.origin}</span>}
              {it.note && <span className="note-tag">{it.note}</span>}
              <span className="time">{formatTime(it.created_at)}</span>
            </div>
            {it.kind === "text" && <p className="text-body">{it.content}</p>}
            {it.kind === "photo" && it.ocr_text && (
              <p className="ocr">🔍 {it.ocr_text}</p>
            )}
            {it.kind === "photo" && !it.ocr_text && (
              <p className="ocr pending">识别中…</p>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

export default function App() {
  const [tab, setTab] = useState<"soe" | "uploads">("soe")
  return (
    <div className="root">
      <nav className="tabbar">
        <button
          className={tab === "soe" ? "tab active" : "tab"}
          onClick={() => setTab("soe")}
        >
          🎤 发音评测
        </button>
        <button
          className={tab === "uploads" ? "tab active" : "tab"}
          onClick={() => setTab("uploads")}
        >
          📥 素材采集
        </button>
      </nav>
      {tab === "soe" ? <SoeDemo /> : <UploadsApp />}
    </div>
  )
}

function UploadsApp() {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="page">
      <header>
        <h1>📥 学习素材采集</h1>
        <p>拍照或输入文字，上传到服务器存储备用</p>
      </header>
      <PhotoUploadCard onUploaded={() => setRefreshKey((k) => k + 1)} />
      <TextUploadCard onUploaded={() => setRefreshKey((k) => k + 1)} />
      <UploadList key={refreshKey} />
      <footer>内网服务 · AiPhonix</footer>
    </div>
  )
}
