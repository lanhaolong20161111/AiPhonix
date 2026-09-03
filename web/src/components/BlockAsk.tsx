/** 块级 AI 提问 — 就当前块/题文本提问 AI，一问一答一个记录；回答块带 TTS 播放
 *
 * 问答写入全局 qaStore（自动持久化 localStorage），输入页/结果页/「问答记录」浮窗统一可见。
 */

import { useState } from "react"
import { api } from "../services/api"
import { useTts } from "../hooks/useTts"
import { detailFromError } from "../services/auth"
import { useQaStore } from "../stores/qaStore"
import { TapCharText } from "./TapCharText"

interface BlockAskProps {
  /** 作为提问上下文的块/题文本 */
  text: string
  /** 全局唯一问答 key：`${scope}:${relKey}` */
  qaKey: string
}

interface TextAskResult {
  answer: string
  keywords?: string[]
  source_title?: string
}

export function BlockAsk({ text, qaKey }: BlockAskProps) {
  const { speaking, speak } = useTts()
  // 注意：selector 不能返回 `s.qa[qaKey] ?? []`——key 不存在时每次返回新空数组，
  // 会让 zustand useSyncExternalStore 判定结果恒变 → 无限重渲染（Maximum update depth exceeded）。
  // 正确做法：selector 只取稳定引用（数组或 undefined），默认值在组件内补。
  const rawList = useQaStore((s) => s.qa[qaKey])
  const list = rawList ?? []
  const appendQa = useQaStore((s) => s.appendQa)
  const [open, setOpen] = useState<boolean>(() => (useQaStore.getState().qa[qaKey]?.length ?? 0) > 0)
  const [question, setQuestion] = useState("")
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState("")

  const ask = async () => {
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setError("")
    try {
      const res = await api<TextAskResult>("/ai-chinese/text-ask", {
        method: "POST",
        body: { context: text.slice(0, 4000), question: q },
        timeoutMs: 60000,
      })
      const a = res.answer?.trim() || "（AI 没有给出回答）"
      appendQa(qaKey, { q, a })
      setQuestion("")
    } catch (err) {
      setError(`提问失败: ${detailFromError(err)}`)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="block-ask">
      <button
        className="block-ops-btn block-ask-btn"
        onClick={() => setOpen((o) => !o)}
        title={open ? "收起提问" : "向 AI 提问"}
        aria-label="向 AI 提问"
      >
        {open ? "✕" : "❓"}
        {list.length > 0 && <span className="block-ops-badge">{list.length}</span>}
      </button>
      {open && (
        <div className="block-ask-body">
          <textarea
            className="essay-textarea"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="就这段内容提问…（回车换行，点发送）"
          />
          <div className="ai-upload-row" style={{ marginTop: 6, marginBottom: 0 }}>
            <button className="btn-primary btn-sm" onClick={ask} disabled={asking || !question.trim()}>
              {asking ? "思考中…" : "发送"}
            </button>
          </div>
          {error && <p className="err" style={{ marginTop: 6 }}>{error}</p>}
          {list.length > 0 && (
            <div className="block-qa-list">
              {list.map((it, i) => (
                <div key={i} className="block-qa-item">
                  <div className="block-qa-q">🙋 {it.q}</div>
                  <div className="block-answer">
                    <div className="block-answer-head">
                      <span className="block-answer-label">🤖 AI 回答</span>
                      <button
                        className="block-speak-btn"
                        disabled={speaking}
                        onClick={() => void speak(it.a)}
                        title="朗读回答"
                      >
                        🔊
                      </button>
                    </div>
                    <div className="block-answer-text">
                      <TapCharText text={it.a} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
