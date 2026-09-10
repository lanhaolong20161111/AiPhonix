/** 记忆快乐本 · 今日字词趣味文段卡片（认字页/练词页共用，scope 区分缓存：认字页只传字、练词页只传词）
 *
 * - 进页面自动 generate（后端按 账号+日期+scope 幂等：当天已有直接返回缓存，不重复烧 LLM）
 * - 展示：小标题 + 文段（今日字/词高亮）+ 目标字词 chips + 🔊朗读 + 🔄换一段 + 📖去快乐本
 * - chars/words 为空 → 空态引导去「每日语文」设置今日字词
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTts } from "../hooks/useTts"
import { generateJoy, highlightJoyText, type JoyEntry } from "../services/joy"

export function JoyStoryCard({
  chars,
  words,
  scope = "all",
  onGenerated,
}: {
  /** 今日汉字原文（逗号/顿号分隔，可空） */
  chars: string
  /** 今日词语原文（逗号/顿号分隔，可空） */
  words: string
  /** 缓存条目类型：认字页传 "char"、练词页传 "word"，两边各自生成互不影响 */
  scope?: "all" | "char" | "word"
  /** 生成成功后回调（页面可收起 loading 提示等） */
  onGenerated?: (e: JoyEntry | null) => void
}) {
  const navigate = useNavigate()
  const { speaking, speak, stop } = useTts()
  const [entry, setEntry] = useState<JoyEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const reqRef = useRef(0)

  const hasTargets = (chars || "").trim().length > 0 || (words || "").trim().length > 0

  const load = useCallback(
    async (force: boolean) => {
      if (!hasTargets) return
      const my = ++reqRef.current
      setBusy(true)
      setErr("")
      try {
        const res = await generateJoy(chars ?? "", words ?? "", force, undefined, scope)
        if (my !== reqRef.current) return // 已发起新请求，丢弃旧结果
        setEntry(res.entry)
        onGenerated?.(res.entry)
      } catch {
        if (my === reqRef.current) setErr("生成失败，请检查网络后重试")
      } finally {
        if (my === reqRef.current) setBusy(false)
      }
    },
    [chars, words, scope, onGenerated],
  )

  // 进页面自动生成/取缓存（仅一次；targets 变化时重新取）
  useEffect(() => {
    setEntry(null)
    if (hasTargets) void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars, words])

  const segs = entry ? highlightJoyText(entry.text, entry.chars || chars, entry.words || words) : []
  const targetList = [
    ...(words || "").split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean),
    ...(chars || "").split(/[,，、;；\s]+/).map((s) => s.trim()).filter((s) => s.length === 1),
  ]

  if (!hasTargets) {
    return (
      <div className="card joy-card" style={{ marginBottom: 8, padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <b style={{ fontSize: 14 }}>🌟 记忆快乐本</b>
          <button className="btn-secondary btn-sm" onClick={() => navigate("/module/memory_joy")}>
            📖 打开快乐本
          </button>
        </div>
        <p className="module-hint" style={{ margin: "6px 0 0" }}>
          家长还没有设置今日字/词。去「每日一练 · 语文」⚙️ 设置后，这里会自动编一段小故事帮你记住它们。
        </p>
      </div>
    )
  }

  return (
    <div className="card joy-card" style={{ marginBottom: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <b style={{ fontSize: 14 }}>🌟 记忆快乐本{entry ? ` · ${entry.title || ""}` : ""}</b>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {entry && !speaking && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => void speak(entry.text, {})}
              title="朗读文段"
              aria-label="朗读文段"
            >
              🔊
            </button>
          )}
          {entry && speaking && (
            <button className="btn-secondary btn-sm" onClick={() => stop()} title="停止">
              ⏹
            </button>
          )}
          <button className="btn-secondary btn-sm" disabled={busy} onClick={() => void load(true)} title="重新编一段">
            🔄
          </button>
          <button className="btn-secondary btn-sm" onClick={() => navigate("/module/memory_joy")}>
            📖
          </button>
        </div>
      </div>

      {busy && !entry && <p className="module-hint" style={{ margin: "8px 0 0" }}>小故事编写中…（约几秒）</p>}
      {err && <p className="err" style={{ margin: "8px 0 0" }}>{err}</p>}
      {!busy && !entry && !err && <p className="module-hint" style={{ margin: "8px 0 0" }}>今日还没有文段。</p>}

      {entry && (
        <>
          <p style={{ margin: "8px 0 4px", fontSize: 16, lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
            {segs.map((s, i) =>
              s.hit ? (
                <mark key={i} style={{ background: "#fde68a", color: "#92400e", borderRadius: 3, padding: "0 1px" }}>
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
          {targetList.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {targetList.map((t) => (
                <span key={t} style={{ fontSize: 12, background: "#f1f5f9", color: "#475569", borderRadius: 10, padding: "2px 8px" }}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
