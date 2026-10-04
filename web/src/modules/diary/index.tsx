/** 成长日记页 — 每天一句话记录生活，AI 帮忙润色 + 温暖点评，时间线回顾 */

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTts } from "../../hooks/useTts"
import { askLlm } from "../../services/aiAsk"

interface DiaryEntry {
  date: string // YYYY-MM-DD
  text: string
  polish: string
  comment: string
}

const KEY = "ai_diary_entries"

function loadEntries(): DiaryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as DiaryEntry[]
  } catch {
    return []
  }
}

function saveEntries(list: DiaryEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const diffDays = Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000)
  if (diffDays <= 0) return "今天"
  if (diffDays === 1) return "昨天"
  return `${m}月${d}日`
}

export function DiaryPage() {
  const navigate = useNavigate()
  const { speaking, speak } = useTts()
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const today = todayKey()

  useEffect(() => {
    setEntries(loadEntries())
    const existing = loadEntries().find((e) => e.date === today)
    if (existing) setText(existing.text)
  }, [])

  const submit = useCallback(async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      const reply = await askLlm(
        `我是一个小学生，这是我今天的日记，请你：1）帮我把句子改得更通顺优美（保留我的原意和用词难度）；2）用温暖鼓励的语气给我 2-3 句点评，可以提一个小建议或问一个小问题。格式：第一行输出润色后的日记，空一行后输出点评。【我的日记】${t}`,
        "chinese",
      )
      // 拆润色与点评：第一个空行分界
      const parts = reply.split(/\n{2,}/)
      const polish = (parts[0] ?? "").trim()
      const comment = parts.slice(1).join("\n").trim() || reply.trim()
      const list = loadEntries().filter((e) => e.date !== today)
      list.unshift({ date: today, text: t, polish, comment })
      list.sort((a, b) => b.date.localeCompare(a.date))
      saveEntries(list)
      setEntries(list)
    } finally {
      setBusy(false)
    }
  }, [text, busy, today])

  const todayEntry = entries.find((e) => e.date === today)

  return (
    <div className="page wordbook-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📖 成长日记</h1>
      </header>
      <p className="module-hint">每天写一两句今天发生的事（用输入法的语音说话也可以），AI 老师帮你润色和点评。</p>

      <div className="card wordbook-card" style={{ textAlign: "left" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#334155" }}>📅 {dateLabel(today)}</h3>
        <textarea
          className="sentence-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="今天发生了什么开心的事？学到了什么？"
          rows={3}
          disabled={busy}
        />
        <div className="wordbook-btns">
          <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
            {busy ? "AI 老师写评语中…" : todayEntry ? "重新润色" : "交给 AI 老师"}
          </button>
        </div>
        {todayEntry?.polish && (
          <div className="diary-polish">
            <p className="diary-polish-text">{todayEntry.polish}</p>
            <button className="ai-chat-speak" disabled={speaking} onClick={() => void speak(todayEntry.polish)}>
              🔊 朗读
            </button>
          </div>
        )}
        {todayEntry?.comment && (
          <div className="ai-chat-fix" style={{ maxWidth: "100%" }}>
            💬 {todayEntry.comment}
          </div>
        )}
      </div>

      <h3 style={{ margin: "16px 0 8px", fontSize: 14, color: "#334155" }}>🕰️ 时间线</h3>
      {entries.length === 0 ? (
        <p className="empty">还没有日记，从今天开始吧</p>
      ) : (
        entries.map((e) => (
          <div key={e.date} className="card diary-entry">
            <div className="diary-entry-date">{dateLabel(e.date)}</div>
            {e.polish && <p className="diary-polish-text">{e.polish}</p>}
            {e.text !== e.polish && <p className="diary-orig">我的原话：{e.text}</p>}
            {e.comment && <p className="diary-comment">💬 {e.comment}</p>}
            <div className="ai-chat-actions">
              <button className="ai-chat-speak" disabled={speaking} onClick={() => void speak(e.polish || e.text)}>
                🔊 朗读
              </button>
              <button
                className="ai-chat-speak"
                onClick={() => {
                  if (confirm(`删除 ${dateLabel(e.date)} 的日记？`)) {
                    const list = loadEntries().filter((x) => x.date !== e.date)
                    saveEntries(list)
                    setEntries(list)
                  }
                }}
              >
                🗑 删除
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
