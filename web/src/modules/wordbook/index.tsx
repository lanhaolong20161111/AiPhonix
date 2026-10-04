/** 生词本页 — SRS 间隔重复复习 + 词表管理 */

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTts } from "../../hooks/useTts"
import { PhonicsWord } from "../../components/PhonicsWord"
import { isEnglishWord } from "../../lib/phonics"
import {
  listWordbook, rateWordbook, removeWordbook, reviewQueue,
  type WordbookItem,
} from "../../services/wordbook"

type Tab = "review" | "list"

export function WordbookPage() {
  const navigate = useNavigate()
  const { speaking, speak } = useTts()
  const [tab, setTab] = useState<Tab>("review")
  const [items, setItems] = useState<WordbookItem[]>([])
  const [queue, setQueue] = useState<WordbookItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [doneCount, setDoneCount] = useState(0)

  const refresh = useCallback(async () => {
    const [all, due] = await Promise.all([listWordbook(), reviewQueue()])
    setItems(all)
    setQueue(due)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rate = async (it: WordbookItem, correct: boolean) => {
    await rateWordbook(it.id, correct)
    setQueue((q) => q.filter((x) => x.id !== it.id))
    if (correct) setDoneCount((n) => n + 1)
    void refresh()
  }

  const del = async (id: number) => {
    await removeWordbook(id)
    setQueue((q) => q.filter((x) => x.id !== id))
    setItems((l) => l.filter((x) => x.id !== id))
  }

  const current = queue[0]

  return (
    <div className="page wordbook-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📓 生词本</h1>
        <span className="module-level">{items.length}</span>
      </header>
      <p className="module-hint">点读生字/生词就能自动收进来。到期的词每天复习一遍，认对的间隔会越来越长。</p>

      <div className="wordbook-tabs">
        <button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>
          🔁 复习{queue.length > 0 ? ` (${queue.length})` : ""}
        </button>
        <button className={tab === "list" ? "active" : ""} onClick={() => setTab("list")}>
          📋 词表 ({items.length})
        </button>
      </div>

      {tab === "review" && (
        <>
          {!loaded ? (
            <p className="empty">加载中…</p>
          ) : !current ? (
            <div className="card" style={{ textAlign: "center", padding: "32px 16px" }}>
              <div style={{ fontSize: 40 }}>{doneCount > 0 ? "🎉" : "🌤"}</div>
              <p style={{ fontWeight: 700, margin: "8px 0 4px" }}>
                {doneCount > 0 ? `本轮复习完成，答对 ${doneCount} 个！` : "今天没有到期的生词"}
              </p>
              <p style={{ color: "#6b7280", fontSize: 13 }}>点读生字/生词可以继续收集</p>
            </div>
          ) : (
            <div className="card wordbook-card">
              <button
                className="wordbook-big"
                disabled={speaking}
                onClick={() => void speak(current.text, { pinyin: current.pinyin })}
                title="点击听发音"
              >
                {isEnglishWord(current.text) ? <PhonicsWord word={current.text} /> : current.text}
              </button>
              {current.pinyin && <p className="wordbook-pinyin">{current.pinyin}</p>}
              <div className="wordbook-btns">
                <button className="btn-secondary" disabled={speaking} onClick={() => void rate(current, false)}>
                  😕 不认识
                </button>
                <button className="btn-primary" disabled={speaking} onClick={() => void rate(current, true)}>
                  😄 认识
                </button>
              </div>
              <p className="wordbook-meta">第 {current.box} 阶 · 学过 {current.times} 次</p>
            </div>
          )}
        </>
      )}

      {tab === "list" && (
        <>
          {items.length === 0 ? (
            <p className="empty">还没有生词，去点读生字/生词收集吧</p>
          ) : (
            items.map((it) => (
              <div key={it.id} className="card history-card">
                <div className="history-row">
                  <div className="history-body">
                    <div className="history-text">
                      {isEnglishWord(it.text) ? <PhonicsWord word={it.text} /> : it.text}
                      {it.pinyin ? `（${it.pinyin}）` : ""}
                    </div>
                    <div className="history-meta">
                      第 {it.box} 阶 · {it.correct}/{it.times} 次答对 · 下次复习 {it.next_review || "—"}
                    </div>
                  </div>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => void speak(it.text, { pinyin: it.pinyin })}
                    disabled={speaking}
                    title="听发音"
                  >
                    🔊
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => void del(it.id)}
                    title="删除"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
