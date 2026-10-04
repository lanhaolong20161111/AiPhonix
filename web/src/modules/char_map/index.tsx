/** 汉字地图 — 3028 张字卡按年级铺成地图，学过的字点亮（✓绿 ?黄 ×红） */

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { listCharImages, type CharImageItem } from "../../services/charImages"
import { fetchFeedback } from "../../services/soeRecords"
import { useAuthStore } from "../../stores/authStore"

interface Cell {
  char: string
  status: "correct" | "wrong" | "unsure" | null
  grade: string
  semester: string
  type: string
}

const GRADE_ORDER = ["一年级上", "一年级下", "二年级上", "二年级下", "三年级上", "三年级下", "四年级上", "四年级下", "五年级上", "五年级下", "六年级上", "六年级下"]
const TYPE_LABEL: Record<string, string> = { 字: "识字", 词: "词语", 句: "句子", 英词: "英词", 英句: "英句" }

export function CharMapPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CharImageItem[]>([])
  const [statusMap, setStatusMap] = useState<Map<string, Cell["status"]>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const [list, userId] = [await listCharImages({ limit: 100000 }), useAuthStore.getState().session?.user.user_id ?? 0]
      setItems(list)
      try {
        const fb = await fetchFeedback(userId)
        const m = new Map<string, Cell["status"]>()
        for (const f of fb.items) {
          if (f.learning_status) m.set(f.char, f.learning_status as Cell["status"])
        }
        setStatusMap(m)
      } catch {
        /* 反馈拉取失败不影响地图展示 */
      }
      setLoading(false)
    })()
  }, [])

  // 按年级分组；同字取反馈状态（map 已是后写覆盖）
  const groups = useMemo(() => {
    const byGrade = new Map<string, CharImageItem[]>()
    for (const it of items) {
      const g = `${it.grade}${it.semester}`
      const list = byGrade.get(g)
      if (list) list.push(it)
      else byGrade.set(g, [it])
    }
    return [...byGrade.entries()].sort(
      (a, b) => (GRADE_ORDER.indexOf(a[0]) + 99) % 99 - ((GRADE_ORDER.indexOf(b[0]) + 99) % 99),
    )
  }, [items])

  const totalLit = groups.reduce(
    (n, [, list]) => n + list.filter((it) => statusMap.get(it.char) === "correct").length,
    0,
  )

  const open = (it: CharImageItem) => {
    const p = new URLSearchParams({ type: it.type, grade: it.grade, semester: it.semester, focus: it.char })
    navigate(`/module/char_image/practice?${p.toString()}`)
  }

  return (
    <div className="page wordbook-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🗺️ 汉字地图</h1>
      </header>
      <p className="module-hint">
        {loading ? "正在铺开地图…" : `共 ${items.length} 个字词，已点亮 ${totalLit} 个。点亮 = 评价过「认识 ✓」`}
      </p>

      {loading && <p className="empty">加载中…</p>}

      {groups.map(([grade, list]) => {
        const lit = list.filter((it) => statusMap.get(it.char) === "correct").length
        const pct = list.length ? Math.round((lit / list.length) * 100) : 0
        return (
          <div key={grade} className="charmap-group">
            <div className="charmap-grade-head">
              <span className="charmap-grade">{grade}</span>
              <div className="charmap-bar">
                <div className="charmap-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="charmap-pct">{lit}/{list.length}</span>
            </div>
            <div className="charmap-grid">
              {list.map((it, i) => {
                const st = statusMap.get(it.char) ?? null
                return (
                  <button
                    key={`${it.char}-${i}`}
                    className={`charmap-cell ${st ?? "none"}`}
                    onClick={() => open(it)}
                    title={`${it.char}（${TYPE_LABEL[it.type] ?? it.type}）去学习`}
                  >
                    {it.char}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
