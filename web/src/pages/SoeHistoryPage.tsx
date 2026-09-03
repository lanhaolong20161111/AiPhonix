/** 评测历史页 — 查看本账号每次发音评测结果（含音素明细） */

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { fetchSoeRecords, fetchFeedback, deleteSoeRecord, batchDeleteSoeRecords, type SoeRecord, type FeedbackItem } from "../services/soeRecords"
import { useAuthStore } from "../stores/authStore"
import { SoeDetail } from "../components/SoeDetail"
import type { SoeResult } from "../lib/soeApi"

function toSoeResult(r: SoeRecord): SoeResult {
  return {
    engine: r.engine,
    eval_mode: r.eval_type,
    pron_accuracy: r.total_accuracy,
    pron_fluency: r.total_fluency,
    pron_completion: r.total_completion,
    suggested_score: r.suggested_score,
    words: r.units ?? [],
  }
}

/** 评测类型中文标签：中/英 + 拼音/字/词/句/段。
 * 新记录 eval_type = scene（word/sentence/paragraph/pinyin）；
 * 旧记录只有 word/sentence，需结合 language 与 ref_text 推断。 */
function describeEvalType(r: SoeRecord): string {
  const lang = r.language === "zh" ? "中文" : "英文"
  const t = (r.eval_type || "").toLowerCase()
  if (t === "pinyin") return "中文 · 拼音"
  if (t === "paragraph") return `${lang} · 段落`
  if (t === "sentence") return `${lang} · 句子`
  // word 或旧记录：结合 ref_text 细化
  const text = r.ref_text || ""
  const hanziCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  if (r.language === "zh" || hanziCount > 0) {
    // 中文：无汉字但有数字声调（如 sang4）→ 拼音；单汉字 → 字；多字 → 词
    if (hanziCount === 0 && /[1-5]/.test(text)) return "中文 · 拼音"
    if (hanziCount <= 1) return "中文 · 字"
    return "中文 · 词"
  }
  // 英文：单词 / 句子（旧记录按空格数判断）
  if (t === "word") return "英文 · 单词"
  const wordCount = text.split(/\s+/).filter(Boolean).length
  return wordCount <= 1 ? "英文 · 单词" : "英文 · 句子"
}

export function SoeHistoryPage() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.session?.user.user_id ?? 0)
  const [records, setRecords] = useState<SoeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [openId, setOpenId] = useState<number | null>(null)
  // 学习状态模态框
  const [showStatus, setShowStatus] = useState(false)
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([])
  const [feedbackTotal, setFeedbackTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>("all") // all | correct | wrong | unsure

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm("确定删除这条评测记录？")) return
    try {
      await deleteSoeRecord(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
      setOpenId(null)
    } catch (err) {
      alert(`删除失败: ${String(err)}`)
    }
  }

  // 批量删除：选中集合 + 全选 + 批量删除
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const allSelected = records.length > 0 && selected.size === records.length
  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === records.length ? new Set() : new Set(records.map((r) => r.id))))
  }
  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`确定删除选中的 ${selected.size} 条评测记录？`)) return
    const ids = Array.from(selected)
    try {
      const deleted = await batchDeleteSoeRecords(ids)
      setRecords((prev) => prev.filter((r) => !selected.has(r.id)))
      setSelected(new Set())
      if (deleted < ids.length) alert(`已删除 ${deleted}/${ids.length} 条（部分可能不存在）`)
    } catch (err) {
      alert(`批量删除失败: ${String(err)}`)
    }
  }

  useEffect(() => {
    if (!showStatus || !userId) return
    void (async () => {
      try {
        const res = await fetchFeedback(userId)
        setFeedbacks(res.items ?? [])
        setFeedbackTotal(res.total ?? 0)
      } catch (e) {
        console.warn("加载反馈失败", e)
      }
    })()
  }, [showStatus, userId])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError("")
      try {
        const data = await fetchSoeRecords({ user_id: userId, limit: 200 })
        setRecords(data)
      } catch (e) {
        setError(`加载失败: ${String((e as Error)?.message ?? e)}`)
      } finally {
        setLoading(false)
      }
    })()
  }, [userId])

  return (
    <div className="page soe-history-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>📊 评测历史</h1>
        <button className="btn-secondary status-toggle-btn" onClick={() => setShowStatus(true)} title="查看学习状态(✓/×/?)">
          📋 学习状态
        </button>
      </header>
      <button
        className="btn-secondary"
        style={{ width: "100%", marginBottom: 8 }}
        onClick={() => navigate("/module/parent_report")}
      >
        📈 家长周报
      </button>
      <div className="soe-history-toolbar">
        <label className="soe-select-all">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
          全选
        </label>
        <span className="soe-selected-count">已选 {selected.size} 条</span>
        <button
          className="btn-danger soe-batch-delete"
          disabled={selected.size === 0}
          onClick={handleBatchDelete}
        >
          批量删除
        </button>
      </div>
      <p className="module-hint">每次发音评测结果（含音素）都记录在本账号下，点击可展开明细。</p>

      {loading ? (
        <p className="empty">加载中…</p>
      ) : error ? (
        <div className="card"><p className="err">{error}</p></div>
      ) : records.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "28px 16px" }}>
          <div style={{ fontSize: 36 }}>🎤</div>
          <p className="empty">还没有评测记录，先去「读一读」试试吧</p>
        </div>
      ) : (
        records.map((r) => (
          <div
            key={r.id}
            className="card soe-history-item"
            onClick={() => {
              const src = (r.source || "").trim()
              const q = (r.ref_text || "").trim()
              // 英文：按评测类型分流
              if (r.language === "en") {
                if ((r.eval_type || "").toLowerCase() === "sentence") {
                  // 英文句 → 英句跟读页，用 ref_text（整句）定位；source 可能只是单词
                  const focus = q || src
                  if (focus) navigate(`/module/char_image/practice?type=英句&focus=${encodeURIComponent(focus)}`)
                  return
                }
                // 英文词 → 发音练习页（按单词定位）
                const word = src || q
                if (word) navigate(`/module/pronounce/${encodeURIComponent(word)}`)
                return
              }
              // 中文：用来源字卡定位看图识字页
              const zhFocus = src || q
              if (zhFocus) navigate(`/module/char_image/practice?focus=${encodeURIComponent(zhFocus)}`)
            }}
          >
            <div className="soe-history-row">
              <input
                type="checkbox"
                className="soe-history-check"
                checked={selected.has(r.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelect(r.id)}
              />
              <div className="soe-history-main">
                <div className="soe-history-text">{r.ref_text || "（无文本）"}</div>
                <div className="soe-history-meta">
                  {describeEvalType(r)}
                  {" · "}
                  {r.created_at ? new Date(r.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                  {" · 点击定位到该字 ➜"}
                </div>
              </div>
              <div className="soe-history-score-wrap">
                <div className={`soe-history-score${r.suggested_score >= 80 ? " good" : r.suggested_score >= 60 ? " ok" : " bad"}`}>
                  {Math.round(r.suggested_score)}
                </div>
                <button
                  className="soe-history-toggle"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenId(openId === r.id ? null : r.id)
                  }}
                  title="展开/收起发音明细"
                >
                  {openId === r.id ? "▴ 明细" : "▾ 明细"}
                </button>
                <button
                  className="soe-history-delete"
                  onClick={(e) => handleDelete(r.id, e)}
                  title="删除此记录"
                >
                  🗑
                </button>
              </div>
            </div>
            {openId === r.id && (
              <div className="soe-history-detail">
                <SoeDetail result={toSoeResult(r)} />
              </div>
            )}
          </div>
        ))
      )}

      {/* 学习状态模态框 */}
      {showStatus && (
        <div className="status-modal-overlay" onClick={() => setShowStatus(false)}>
          <div className="status-modal" onClick={(e) => e.stopPropagation()}>
            <div className="status-modal-header">
              <h2>📋 学习状态（共 {feedbackTotal} 字）</h2>
              <button className="status-modal-close" onClick={() => setShowStatus(false)}>✕</button>
            </div>
            <div className="status-filters">
              {[
                { key: "all", label: "全部" },
                { key: "correct", label: "✓ 认识" },
                { key: "wrong", label: "× 不认识" },
                { key: "unsure", label: "? 不确定" },
              ].map((f) => (
                <button
                  key={f.key}
                  className={`status-filter-btn${statusFilter === f.key ? " active" : ""}`}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="status-list">
              {feedbacks.length === 0 ? (
                <p className="empty">暂无反馈记录</p>
              ) : (
                feedbacks
                  .filter((fb) => statusFilter === "all" || fb.learning_status === statusFilter)
                  .map((fb, i) => {
                    const icon = fb.learning_status === "correct" ? "✓" : fb.learning_status === "wrong" ? "×" : fb.learning_status === "unsure" ? "?" : "○"
                    return (
                      <div key={i} className="status-item">
                        <span className={`status-icon ${fb.learning_status || ""}`}>{icon}</span>
                        <span className="status-char">{fb.char}</span>
                        <span className="status-meta">{fb.grade}{fb.semester} · {fb.type === "认" ? "认字" : fb.type === "默" ? "默写" : fb.type === "词" ? "词语" : fb.type}</span>
                        <span className="status-time">{fb.timestamp ? new Date(fb.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
