/** 家长周报 — 近 7 天评测趋势 / 学习状态统计 / 生词收集，给家长看的打印友好页 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { fetchFeedback, fetchSoeRecords } from "../../services/soeRecords"
import { listWordbook, type WordbookItem } from "../../services/wordbook"
import { useAuthStore } from "../../stores/authStore"

interface DayStat {
  date: string
  count: number
  avgScore: number | null
}

export function ParentReportPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState<Awaited<ReturnType<typeof fetchSoeRecords>>>([])
  const [fbStats, setFbStats] = useState<{ correct: number; wrong: number; unsure: number }>({ correct: 0, wrong: 0, unsure: 0 })
  const [words, setWords] = useState<WordbookItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const userId = useAuthStore.getState().session?.user.user_id ?? 0
      const [recs, fb, wb] = await Promise.all([
        fetchSoeRecords({ user_id: userId, limit: 500 }).catch(() => []),
        fetchFeedback(userId).catch(() => ({ items: [], total: 0, stats: {} })),
        listWordbook().catch(() => []),
      ])
      setRecords(recs)
      const s = fb.stats as Record<string, number>
      setFbStats({ correct: s.correct ?? 0, wrong: s.wrong ?? 0, unsure: s.unsure ?? 0 })
      setWords(wb)
      setLoading(false)
    })()
  }, [])

  // 近 7 天逐日统计（今天在最右）
  const days: DayStat[] = useMemo(() => {
    const out: DayStat[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      const dayRecs = records.filter((r) => (r.created_at ?? "").slice(0, 10) === key)
      const scores = dayRecs.map((r) => r.suggested_score).filter((s) => s > 0)
      out.push({
        date: key,
        count: dayRecs.length,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      })
    }
    return out
  }, [records])

  const weekCount = days.reduce((n, d) => n + d.count, 0)
  const scored = records.filter((r) => r.suggested_score > 0 && (r.created_at ?? "").slice(0, 10) >= days[0].date)
  const weekAvg = scored.length ? Math.round(scored.reduce((n, r) => n + r.suggested_score, 0) / scored.length) : null

  // 最近读得最弱的 8 个词（近 30 天，分数 < 80 去重）
  const weakWords = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const m = new Map<string, number>()
    for (const r of records) {
      if (r.suggested_score <= 0 || (r.created_at ?? "").slice(0, 10) < cutoff) continue
      const key = (r.ref_text || "").replace(/\s+/g, "").slice(0, 8)
      if (!key) continue
      const prev = m.get(key)
      if (prev == null || r.suggested_score < prev) m.set(key, r.suggested_score)
    }
    return [...m.entries()].filter(([, s]) => s < 80).sort((a, b) => a[1] - b[1]).slice(0, 8)
  }, [records])

  const maxCount = Math.max(1, ...days.map((d) => d.count))

  return (
    <div className="page wordbook-page parent-report">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📈 家长周报</h1>
      </header>
      <p className="module-hint">近 7 天学习数据一览（数据来自本账号的评测与学习记录）。</p>

      {loading ? (
        <p className="empty">统计中…</p>
      ) : (
        <>
          <div className="report-cards">
            <div className="card report-card">
              <div className="report-num">{weekCount}</div>
              <div className="report-label">本周发音评测</div>
            </div>
            <div className="card report-card">
              <div className="report-num">{weekAvg ?? "—"}</div>
              <div className="report-label">本周平均分</div>
            </div>
            <div className="card report-card">
              <div className="report-num">{fbStats.correct}</div>
              <div className="report-label">已点亮字词</div>
            </div>
            <div className="card report-card">
              <div className="report-num">{words.length}</div>
              <div className="report-label">生词本收藏</div>
            </div>
          </div>

          <div className="card report-section">
            <h3>📅 每日评测次数</h3>
            <div className="report-bars">
              {days.map((d) => (
                <div key={d.date} className="report-bar-col">
                  <div className="report-bar-val">{d.count || ""}</div>
                  <div className="report-bar">
                    <div className="report-bar-fill" style={{ height: `${(d.count / maxCount) * 100}%` }} />
                  </div>
                  <div className="report-bar-day">{d.date.slice(8)}日</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card report-section">
            <h3>📖 识字状态</h3>
            <p className="report-line">
              认识 <b style={{ color: "#16a34a" }}>{fbStats.correct}</b> 个 · 不确定{" "}
              <b style={{ color: "#d97706" }}>{fbStats.unsure}</b> 个 · 还不会{" "}
              <b style={{ color: "#dc2626" }}>{fbStats.wrong}</b> 个
            </p>
          </div>

          {weakWords.length > 0 && (
            <div className="card report-section">
              <h3>🎯 需要多练的词（近 30 天最低分）</h3>
              <div className="report-weak">
                {weakWords.map(([w, s]) => (
                  <span key={w} className="report-weak-item">
                    {w} <b>{s}分</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="report-footer">生成时间 {new Date().toLocaleString("zh-CN")} · AiPhonix</p>
        </>
      )}
    </div>
  )
}
