/** 历史会话页 — 查看 AI 语文/数学/英语保存的识别/对话历史，按日期折叠分组，点击回看 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { loadHistory, removeHistory, type AiHistoryItem, type AiModule } from "../lib/aiHistory"
import { useParseSessionStore, newSessionId } from "../stores/parseSessionStore"
import { useQaStore } from "../stores/qaStore"

const MODULE_LABEL: Record<AiModule, string> = {
  chinese: "语文",
  math: "数学",
  english: "英语",
}

/** 时间戳 → 分组标签：今天 / 昨天 / 具体日期 */
function dateGroupLabel(ts: string | number): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (diffDays <= 0) return "今天"
  if (diffDays === 1) return "昨天"
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function AiHistoryPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const m = params.get("module")
  const module = (m === "math" || m === "english" ? m : "chinese") as AiModule
  const [items, setItems] = useState<AiHistoryItem[]>(() => loadHistory(module))

  useEffect(() => {
    setItems(loadHistory(module))
  }, [module])

  // 按日期分组（items 本身按最新在前，组顺序随首次出现顺序 = 最新日期在前）
  const groups = useMemo(() => {
    const map = new Map<string, AiHistoryItem[]>()
    for (const it of items) {
      const k = dateGroupLabel(it.createdAt)
      const list = map.get(k)
      if (list) list.push(it)
      else map.set(k, [it])
    }
    return [...map.entries()]
  }, [items])

  // 折叠状态：null = 初始（仅展开最新一组）
  const [openGroups, setOpenGroups] = useState<Set<string> | null>(null)
  const isOpen = (label: string, idx: number) => (openGroups ? openGroups.has(label) : idx === 0)
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const base = prev ?? new Set(groups.filter((_, i) => i === 0).map(([k]) => k))
      const next = new Set(base)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

  /** 会话型条目（绑定后端 session_id）→ 恢复到对话面板续聊；旧识别类条目 → 快照回看页 */
  const CHAT_PATH: Record<AiModule, string> = {
    chinese: "/module/ai_chinese",
    math: "/module/ai_homework",
    english: "/module/ai_english",
  }

  const open = (it: AiHistoryItem) => {
    if (it.sessionId) {
      // 对话线程：设为当前会话后进入对话页，挂载时自动从后端拉取历史续聊
      try {
        localStorage.setItem(`ai_chat_session_${it.module}`, it.sessionId)
      } catch {
        /* 忽略 */
      }
      navigate(CHAT_PATH[it.module])
      return
    }
    const sessionId = newSessionId()
    // 历史问答写入全局 QaStore（scope = 新的 sessionId），回看时可继续提问并自动持久化
    const qa = it.qa ?? {}
    const st = useQaStore.getState()
    for (const [k, list] of Object.entries(qa)) {
      if (list?.length) st.setQaList(`${sessionId}:${k}`, list)
    }
    useParseSessionStore.getState().setSession({
      sessionId,
      module: it.module,
      text: it.text,
      questions: it.questions,
      blocks: it.blocks,
      pageBounds: it.pageBounds,
      previewUrl: it.thumb,
      file: null,
      fromHistory: true, // 回看历史：不触发自动保存（避免重复记录）
      turns: it.turns,
      pos: it.pos, // 词性/要素标注随历史透传，回看页直接用（无需重新拉取）
      story: it.story,
    })
    navigate("/module/ai_parse_result")
  }

  const del = (id: string) => {
    removeHistory(module, id)
    setItems(loadHistory(module))
  }

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🗂 {MODULE_LABEL[module]} 历史会话</h1>
      </header>
      <p className="module-hint">识别与对话记录按日期折叠，点击组头展开，点击条目回看。</p>

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "28px 16px" }}>
          <div style={{ fontSize: 36 }}>🗂</div>
          <p className="empty">暂无历史会话</p>
        </div>
      ) : (
        groups.map(([label, list], gi) => (
          <div key={label} className="history-group">
            <button type="button" className="history-group-head" onClick={() => toggleGroup(label)} aria-expanded={isOpen(label, gi)}>
              <span className={`history-group-chevron${isOpen(label, gi) ? " open" : ""}`}>▸</span>
              <span>{label}</span>
              <span className="history-group-count">{list.length} 条</span>
            </button>
            {isOpen(label, gi) &&
              list.map((it) => (
                <div key={it.id} className="card history-card" style={{ cursor: "pointer" }} onClick={() => open(it)}>
                  <div className="history-row">
                    {it.thumb && <img className="history-thumb" src={it.thumb} alt="" />}
                    <div className="history-body">
                      <div className="history-meta">
                        {new Date(it.createdAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" · "}
                        {it.turns?.length
                          ? `对话 ${Math.ceil(it.turns.length / 2)} 轮`
                          : `${it.questions.length} ${MODULE_LABEL[module] === "数学" ? "道" : "段"}`}
                      </div>
                      <div className="history-text">{it.text.replace(/\s+/g, "").slice(0, 60)}</div>
                    </div>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        del(it.id)
                      }}
                      title="删除"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
          </div>
        ))
      )}
    </div>
  )
}
