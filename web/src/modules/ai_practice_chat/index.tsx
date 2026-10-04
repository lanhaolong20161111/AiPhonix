/** AI 陪我练会话页 — 多轮对话 + 纠正/表扬 + TTS */

import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { aiChat, getAiSessionDetail, type AiTurn } from "./aiPractice"
import { useTts } from "../../hooks/useTts"
import { detailFromError } from "../../services/auth"

export function AiPracticeChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [search] = useSearchParams()
  const content = search.get("content") ?? ""
  const navigate = useNavigate()

  const [turns, setTurns] = useState<AiTurn[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")
  const { speaking, speak } = useTts()

  const id = Number(sessionId)

  useEffect(() => {
    void (async () => {
      try {
        const d = await getAiSessionDetail(id)
        setTurns(d.turns ?? [])
        setDone(d.status === "done")
      } catch {
        setError("加载会话失败")
      }
    })()
  }, [id])

  const send = useCallback(async () => {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput("")
    setSending(true)
    setError("")
    // 立即回显学生回答
    setTurns((prev) => [...prev, { role: "user", text, correction: "", praise: "", audio_path: "" }])
    try {
      const res = await aiChat(id, text)
      setTurns((prev) => [
        ...prev,
        {
          role: "ai",
          text: res.question,
          correction: res.correction,
          praise: res.praise,
          audio_path: "",
        },
      ])
      if (res.done) setDone(true)
    } catch (e) {
      setError(detailFromError(e))
      setTurns((prev) => prev.filter((t) => t !== turns[turns.length]))
    } finally {
      setSending(false)
    }
  }, [input, sending, id, turns])

  return (
    <div className="page aipractice-chat-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>{content.slice(0, 14) || "AI 陪我练"}</h1>
        <span className={`module-level${done ? " done-tag" : ""}`}>{done ? "✅ 已完成" : "⏳ 进行中"}</span>
      </header>

      <div className="chat-list">
        {turns.length === 0 && !sending && <p className="empty">等待 AI 提问…（若长时间无响应，可能是服务繁忙）</p>}
        {turns.map((t, i) => (
          <div key={i} className={`chat-bubble ${t.role}`}>
            <div className="chat-bubble-head">
              <span>{t.role === "ai" ? "🤖" : "🧒"}</span>
              {t.role === "ai" && (
                <button className="chat-speak" disabled={speaking} onClick={() => speak(t.text)}>🔊</button>
              )}
            </div>
            <div className="chat-text">{t.text}</div>
            {t.correction && (
              <div className="chat-correction">✏️ 纠正：{t.correction}</div>
            )}
            {t.praise && (
              <div className="chat-praise">🌟 表扬：{t.praise}</div>
            )}
          </div>
        ))}
        {sending && <p className="empty">AI 思考中…</p>}
        {error && <p className="err">{error}</p>}
      </div>

      {done ? (
        <div className="chat-done-panel">
          <p className="all-done">🎉 练习完成！</p>
          <button className="btn-primary" onClick={() => navigate(-1)}>返回</button>
        </div>
      ) : (
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="说出你的回答（可点输入框用语音输入）"
          />
          <button className="btn-primary chat-send" onClick={send} disabled={sending || !input.trim()}>
            {sending ? "…" : "发送"}
          </button>
        </div>
      )}
    </div>
  )
}
