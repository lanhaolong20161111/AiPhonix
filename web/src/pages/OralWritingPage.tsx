/** 口述作文页 — 选题 → 分段口述 → 提示 → 评分/润饰 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { useTts } from "../hooks/useTts"
import { isSpeakableChar } from "../lib/chars"
import { AiInputBox, type AiSubmitPayload } from "../components/AiInputBox"
import { parseImage } from "../services/aiImage"
import { useParseSessionStore, newSessionId } from "../stores/parseSessionStore"
import { fetchImports, deleteImport, createArticleImport, type UserImportItem } from "../services/userImports"

interface EssayTopic {
  id: number
  title: string
  content: string
  gradeLevel?: number
}

interface EssaySection {
  label: string
  guide: string
}

type Phase = "topics" | "writing" | "result"

export function OralWritingPage() {
  const navigate = useNavigate()
  const { speaking, speak } = useTts()
  const [phase, setPhase] = useState<Phase>("topics")
  const [topics, setTopics] = useState<EssayTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [selected, setSelected] = useState<EssayTopic | null>(null)
  const [sections, setSections] = useState<EssaySection[]>([])
  const [sectionIndex, setSectionIndex] = useState(0)
  const [sectionTexts, setSectionTexts] = useState<string[]>([])
  const [genStructure, setGenStructure] = useState(false)
  const [hint, setHint] = useState("")
  const [genHint, setGenHint] = useState(false)

  const [result, setResult] = useState<{ formatted: string; feedback: string }>({ formatted: "", feedback: "" })
  const [finishing, setFinishing] = useState(false)
  // 提示文字点击朗读：正在朗读的单个字
  const [speakingChar, setSpeakingChar] = useState<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  // 上传范文（识别后进入阅读页，和 AI 语文一致）
  const [uploadingEssay, setUploadingEssay] = useState(false)
  const [showEssayUpload, setShowEssayUpload] = useState(false)
  // 已上传的范文列表（kind=article，落库）
  const [essayImports, setEssayImports] = useState<UserImportItem[]>([])

  /** 上传范文：识别图片/文本后进入阅读页（和 AI 语文 AiParseResultPage 一致），并落库 */
  const uploadEssay = async (payload: AiSubmitPayload) => {
    if (uploadingEssay) return
    setUploadingEssay(true)
    setError("")
    setShowEssayUpload(false)
    try {
      const filePayload = payload.file ?? null
      const previewUrl = filePayload ? URL.createObjectURL(filePayload) : ""
      let res
      if (filePayload) {
        res = await parseImage(filePayload, "chinese")
      } else if (payload.text?.trim()) {
        const textBlob = new Blob([payload.text], { type: "text/plain" })
        res = await parseImage(textBlob, "chinese")
      } else {
        throw new Error("请提供图片或文本")
      }
      const blocks = res.blocks ?? []
      const fullText = res.text ?? (blocks.length ? blocks.map((b) => b.text).join("") : "")
      // 落库：kind=article，payload 存识别结构（blocks JSON），便于回看
      try {
        await createArticleImport(fullText, JSON.stringify({ blocks, page_bounds: res.page_bounds ?? null }))
        await loadEssayImports()
      } catch {
        /* 落库失败不影响阅读，仅提示 */
        setError("范文已识别，但保存失败（下次可能找不到记录）")
      }
      // 写入 session，跳转阅读页（复用 AiParseResultPage）
      const sessionId = newSessionId()
      useParseSessionStore.getState().setSession({
        sessionId,
        module: "chinese",
        text: fullText,
        questions: res.questions?.length ? res.questions : fullText ? [fullText] : [],
        blocks,
        pageBounds: res.page_bounds ?? null,
        previewUrl,
        file: filePayload,
        crops: res.crops ?? [],
      })
      navigate("/module/ai_parse_result")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`范文上传失败: ${msg}`)
      setUploadingEssay(false)
    }
  }

  /** 加载已上传的范文列表 */
  const loadEssayImports = async () => {
    try {
      const items = await fetchImports("article")
      setEssayImports(items)
    } catch {
      /* 忽略加载失败 */
    }
  }

  /** 点击已有范文：从 payload 恢复 session 进阅读页 */
  const openEssayImport = (item: UserImportItem) => {
    let blocks: any[] = []
    let pageBounds: any = null
    try {
      const p = JSON.parse(item.payload || "{}")
      blocks = p.blocks ?? []
      pageBounds = p.page_bounds ?? null
    } catch {
      blocks = []
    }
    const sessionId = newSessionId()
    useParseSessionStore.getState().setSession({
      sessionId,
      module: "chinese",
      text: item.text ?? "",
      questions: blocks.length ? [] : item.text ? [item.text] : [],
      blocks,
      pageBounds,
      previewUrl: "",
      file: null,
      crops: [],
      fromHistory: true,
    })
    navigate("/module/ai_parse_result")
  }

  /** 删除范文记录 */
  const removeEssayImport = async (id: number) => {
    try {
      await deleteImport(id)
      setEssayImports((prev) => prev.filter((i) => i.id !== id))
    } catch {
      setError("删除失败")
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await api<{ essays: EssayTopic[] }>("/essays", { auth: false, timeoutMs: 10000 })
        setTopics(res.essays ?? [])
      } catch {
        setError("加载题目失败")
      } finally {
        setLoading(false)
      }
      // 同步加载已上传范文（不阻塞题目加载）
      try {
        const items = await fetchImports("article")
        setEssayImports(items)
      } catch {
        /* 忽略 */
      }
    })()
  }, [])

  const selectTopic = async (t: EssayTopic) => {
    setSelected(t)
    setPhase("writing")
    setGenStructure(true)
    setError("")
    try {
      const res = await api<{ sections: EssaySection[] }>("/essays/structure", {
        method: "POST",
        body: { title: t.title, content: t.content, gradeLevel: t.gradeLevel ?? 2 },
        timeoutMs: 20000,
      })
      const secs = res.sections?.length ? res.sections : [
        { label: "开头", guide: "介绍这个主题" },
        { label: "内容", guide: "说说具体内容" },
        { label: "结尾", guide: "总结你的想法" },
      ]
      setSections(secs)
      setSectionTexts(Array(secs.length).fill(""))
      setSectionIndex(0)
    } catch {
      const secs = [
        { label: "开头", guide: "介绍这个主题" },
        { label: "内容", guide: "说说具体内容" },
        { label: "结尾", guide: "总结你的想法" },
      ]
      setSections(secs)
      setSectionTexts(Array(secs.length).fill(""))
      setSectionIndex(0)
    } finally {
      setGenStructure(false)
    }
  }

  const updateText = (v: string) => {
    setSectionTexts((prev) => prev.map((t, i) => (i === sectionIndex ? v : t)))
    setHint("")
  }

  /** 点击提示文字中的单个汉字/字母朗读 */
  const speakHintChar = useCallback(async (ch: string) => {
    if (speaking || !isSpeakableChar(ch)) return
    setSpeakingChar(ch)
    await speak(ch)
    if (mountedRef.current) setSpeakingChar(null)
  }, [speaking, speak])

  const requestHint = useCallback(async () => {
    if (!selected || genHint) return
    const section = sections[sectionIndex]
    if (!section) return
    setGenHint(true)
    try {
      const res = await api<{ hint: string }>("/essays/hint", {
        method: "POST",
        body: {
          title: selected.title,
          content: selected.content,
          sectionLabel: section.label,
          sectionGuide: section.guide,
          studentText: sectionTexts[sectionIndex] ?? "",
          hintType: "帮我提示一下",
          stuckDurationMs: 0,
        },
        timeoutMs: 15000,
      })
      setHint(res.hint)
    } catch {
      setHint("慢慢来，想到什么就说什么。加油！")
    } finally {
      setGenHint(false)
    }
  }, [selected, sections, sectionIndex, sectionTexts, genHint])

  const finishWriting = async () => {
    if (!selected || finishing) return
    setFinishing(true)
    setPhase("result")
    const sectionList = sections.map((s) => ({ label: s.label, guide: s.guide }))
    const finalText = sectionTexts.filter((t) => t.trim()).join("\n")
    try {
      const [fmt, sc] = await Promise.all([
        api<{ formatted: string }>("/essays/format", {
          method: "POST",
          body: { sections: sectionList, sectionTexts },
          timeoutMs: 20000,
        }).catch(() => ({ formatted: "" })),
        api<{ feedback: string }>("/essays/score", {
          method: "POST",
          body: { title: selected.title, content: selected.content, sections: sectionList, sectionTexts, finalText },
          timeoutMs: 20000,
        }).catch(() => ({ feedback: "" })),
      ])
      setResult({
        formatted: fmt.formatted || finalText,
        feedback: sc.feedback || "",
      })
    } catch {
      setError("评分失败，请重试")
    } finally {
      setFinishing(false)
    }
  }

  if (loading) return <div className="page center-page"><p className="empty">加载题目…</p></div>
  if (phase === "topics") {
    return (
      <div className="page oralwriting-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>口述作文</h1>
        </header>
        <p className="module-hint">选择题目，看着说出一篇作文</p>
        {error && <p className="err">{error}</p>}

        {/* 上传范文：识别后进入阅读页（和 AI 语文一致） */}
        {showEssayUpload ? (
          <div className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 className="section-title" style={{ margin: 0 }}>📖 上传范文</h2>
              <button className="btn-secondary btn-sm" onClick={() => setShowEssayUpload(false)}>✕ 关闭</button>
            </div>
            <AiInputBox
              buttonLabel={uploadingEssay ? "识别中…" : "上传范文"}
              placeholder="拍照/粘贴范文图片，或直接输入文本，点「上传范文」进入阅读"
              busy={uploadingEssay}
              onSubmit={uploadEssay}
            />
          </div>
        ) : (
          <button
            className="btn-primary"
            style={{ width: "100%", marginBottom: 8 }}
            onClick={() => setShowEssayUpload(true)}
          >
            + 上传范文（拍照/粘贴文章 → 分段阅读 · TTS · 评测 · 高亮 · AI 提问）
          </button>
        )}

        {/* 已上传范文列表（点击进入阅读页） */}
        {essayImports.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <h2 className="section-title" style={{ margin: "4px 0" }}>📚 我的范文</h2>
            {essayImports.map((item) => (
              <div key={item.id} className="essay-topic" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  onClick={() => openEssayImport(item)}
                >
                  <b>{item.text?.split(/[\n。.!！?？]/)[0].trim().slice(0, 24) || "范文"}</b>
                  <span>{item.text?.replace(/\s+/g, " ").slice(0, 40) || ""}</span>
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => removeEssayImport(item.id)}
                  title="删除"
                >🗑</button>
              </div>
            ))}
          </div>
        )}

        {topics.map((t) => (
          <button key={t.id} className="essay-topic" onClick={() => selectTopic(t)}>
            <b>{t.title}</b>
            <span>{t.content}</span>
            <span className="essay-arrow">›</span>
          </button>
        ))}
      </div>
    )
  }

  if (phase === "writing") {
    const section = sections[sectionIndex]
    const isFirst = sectionIndex === 0
    const isLast = sectionIndex === sections.length - 1
    return (
      <div className="page oralwriting-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>{selected?.title}</h1>
          <span className="module-level">第 {sectionIndex + 1}/{sections.length} 段</span>
        </header>

        <div className="essay-section card">
          <div className="essay-section-head">
            <b>{section?.label}</b>
            <span className="essay-section-guide">{section?.guide}</span>
          </div>
          {genStructure ? (
            <p className="empty">生成结构…</p>
          ) : (
            <>
              <textarea
                className="essay-textarea"
                rows={6}
                value={sectionTexts[sectionIndex] ?? ""}
                onChange={(e) => updateText(e.target.value)}
                placeholder="可点输入框用语音输入，或直接打字"
              />
              <div className="essay-actions">
                <button className="btn-secondary" disabled={speaking} onClick={() => speak(section?.label ?? "")}>
                  🔊 听段落
                </button>
                <button className="btn-secondary" disabled={genHint} onClick={requestHint}>
                  {genHint ? "提示中…" : "💡 提示"}
                </button>
                {!isFirst && (
                  <button className="btn-secondary" onClick={() => { setSectionIndex((i) => i - 1); setHint("") }}>
                    ← 上一段
                  </button>
                )}
                {isLast ? (
                  <button className="btn-primary" onClick={finishWriting} disabled={finishing}>
                    {finishing ? "评分中…" : "完成并评分 ✓"}
                  </button>
                ) : (
                  <button className="btn-primary" onClick={() => { setSectionIndex((i) => i + 1); setHint("") }}>
                    下一段 →
                  </button>
                )}
              </div>
              {hint && (
                <div className="hint-box">
                  <p style={{ margin: 0 }}>
                    💡 {[...hint].map((ch, i) => {
                      if (ch === " " || ch === "\n") return <span key={i}>{ch === " " ? "\u3000" : <br />}</span>
                      if (!isSpeakableChar(ch)) return <span key={i}>{ch}</span>
                      const isPlaying = speakingChar === ch
                      return (
                        <span
                          key={i}
                          className="speak-char"
                          style={{
                            cursor: "pointer",
                            color: isPlaying ? "#2563eb" : undefined,
                            fontWeight: isPlaying ? 700 : undefined,
                            borderBottom: "1px dashed currentColor",
                          }}
                          onClick={() => void speakHintChar(ch)}
                        >
                          {ch}
                        </span>
                      )
                    })}
                  </p>
                </div>
              )}
              {error && <p className="err">{error}</p>}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page oralwriting-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>{selected?.title}</h1>
      </header>
      <div className="essay-result card">
        <h2 className="section-title">📝 润色后的作文</h2>
        <div className="essay-formatted">{result.formatted}</div>
        {result.feedback && (
          <>
            <h2 className="section-title" style={{ color: "#2563eb" }}>📊 老师点评</h2>
            <div className="essay-feedback">{result.feedback}</div>
          </>
        )}
        <div className="essay-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" disabled={speaking} onClick={() => speak(result.formatted)}>
            🔊 朗读
          </button>
          <button className="btn-primary" onClick={() => { setPhase("topics"); setSelected(null) }}>
            再写一篇
          </button>
        </div>
      </div>
    </div>
  )
}
