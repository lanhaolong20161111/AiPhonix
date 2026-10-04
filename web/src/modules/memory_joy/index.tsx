/** 记忆快乐本 — 每日一练·语文：今日字词 → LLM 趣味文段，按日期倒序排列（随账号持久化）
 * 数据源：/joy/list；每条文段高亮当日字词；文段逐字可点读发音（tap-char），支持整段朗读/删除。
 */
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTts } from "../../hooks/useTts"
import { isSpeakableChar } from "../../lib/chars"
import { deleteJoy, fetchJoyList, highlightJoyText, type JoyEntry } from "../../services/joy"

export function MemoryJoyPage() {
  const navigate = useNavigate()
  const { speaking, speak, speakChar, stop } = useTts()
  const [items, setItems] = useState<JoyEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  /** 正在发音的单字（tap-char 高亮） */
  const [speakingChar, setSpeakingChar] = useState<string | null>(null)

  /** 点读单个汉字：speakChar 走服务端音频库（录音/沉淀/预生成），播完清除高亮 */
  const handleChar = async (ch: string) => {
    if (!isSpeakableChar(ch)) return
    setSpeakingChar(ch)
    try {
      await speakChar(ch)
    } finally {
      setSpeakingChar(null)
    }
  }

  /** 点读「当日字词」里的词条：单字走 speakChar，多字词走整词合成 */
  const handleChip = (w: string) => {
    if ([...w].length === 1) return handleChar(w)
    return speak(w, {})
  }

  const reload = useCallback(async () => {
    try {
      const list = await fetchJoyList()
      setItems(list)
    } catch {
      /* 拉取失败保留现状 */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const remove = async (id: number) => {
    const ok = await deleteJoy(id)
    if (ok) setItems((prev) => prev.filter((e) => e.id !== id))
  }

  // 按日期倒序分组（后端已按 date 倒序返回，顺序分组即可）
  const groups: { date: string; entries: JoyEntry[] }[] = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && last.date === it.date) last.entries.push(it)
    else groups.push({ date: it.date, entries: [it] })
  }

  return (
    <div className="page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🌟 记忆快乐本</h1>
        <button className="btn-secondary btn-sm" onClick={() => void reload()} title="刷新">
          🔄
        </button>
      </header>
      <p className="module-hint">认字/练词时，今日字词会自动编成小故事收在这里，按日期排好（随账号保存）。</p>

      {!loaded ? (
        <p className="empty">加载中…</p>
      ) : groups.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "32px 16px" }}>
          <div style={{ fontSize: 40 }}>🌤</div>
          <p style={{ fontWeight: 700, margin: "8px 0 4px" }}>还没有快乐文段</p>
          <p style={{ color: "#6b7280", fontSize: 13 }}>去「每日一练 · 语文」设置今日字词，认字页会自动生成小故事收进来</p>
          <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
            <button className="btn-secondary" onClick={() => navigate("/module/daily_chinese")}>⚙️ 去设置</button>
            <button className="btn-primary" onClick={() => navigate("/module/recognition")}>🔤 去认字</button>
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date}>
            <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700, margin: "12px 2px 6px" }}>
              📅 {g.date}
            </p>
            {g.entries.map((e) => {
              const segs = highlightJoyText(e.text, e.chars, e.words)
              return (
                <div key={e.id} className="card" style={{ marginBottom: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <b style={{ fontSize: 15 }}>{e.title || e.date}</b>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => (speaking ? stop() : void speak(e.text, {}))}
                        title={speaking ? "停止" : "朗读文段"}
                        aria-label="朗读文段"
                      >
                        {speaking ? "⏹" : "🔊"}
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => void remove(e.id)}
                        title="删除这条"
                        aria-label="删除"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  <p
                    className="joy-essay"
                    style={{ margin: "8px 0 4px", fontSize: 16, lineHeight: 1.9, whiteSpace: "pre-wrap", color: "#1f2937" }}
                  >
                    {segs.map((s, i) =>
                      [...s.text].map((ch, j) => {
                        const key = `${i}-${j}`
                        if (!isSpeakableChar(ch)) return <span key={key}>{ch}</span>
                        return (
                          <span
                            key={key}
                            className={`tap-char-item${s.hit ? " hit" : ""}${speakingChar === ch ? " playing" : ""}`}
                            onClick={() => void handleChar(ch)}
                          >
                            {ch}
                          </span>
                        )
                      }),
                    )}
                  </p>
                  {(e.chars || e.words) && (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#94a3b8" }}>
                      当日字词：
                      {[...e.words.split(/[,，、;；\s]+/).filter(Boolean), ...[...e.chars]].map((w, i) => (
                        <span key={i}>
                          {i > 0 && "、"}
                          <span
                            className="joy-char-chip"
                            onClick={() => void handleChip(w)}
                            title={([...w].length === 1 ? "点击发音" : "点击朗读词语")}
                          >
                            {w}
                          </span>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
