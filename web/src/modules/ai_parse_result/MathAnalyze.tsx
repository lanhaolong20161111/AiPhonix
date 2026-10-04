/** 数学「解析高亮」（审题标注）— 量数 / 关系词 / 问题句
 *
 *  背景：数学块此前直接复用语文的 `BlockHighlight`（`POST /ai-chinese/highlight-mark`），
 *  标的是「core 核心句 / beautiful 优美词句 / word 重点词」——**「优美词句」对数学题毫无意义**。
 *  改为走数学专用的 `POST /ai-homework/analyze`，把服务端已返回的 quantities / relations /
 *  questions 映射回原文做高亮，并附「审题」面板。
 *
 *  标注规则与纯逻辑见 `lib/mathAnalyze.ts`（可单测）；本组件只负责请求与渲染。
 */

import { useMemo, useState } from "react"
import { analyzeQuestion, type AnalyzeResult } from "./aiHomework"
import { mathAnalyzeSegments, relationText } from "../../lib/mathAnalyze"
import { useTts } from "../../hooks/useTts"
import { detailFromError } from "../../services/auth"

/**
 * 数学题块底部的「✨ 解析高亮」——点击后调 `/ai-homework/analyze`，
 * 把「量数 / 关系词 / 问题句」叠到原文，并展示数量、数量关系、所求、关键条件。
 *
 * @param text 该题的原始识别文本
 */
export function MathAnalyze({ text }: { text: string }) {
  const { speaking, speak } = useTts()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState("")

  const segs = useMemo(() => (data ? mathAnalyzeSegments(text, data) : []), [data, text])
  const keyPoints = useMemo(
    () => (data?.sentences ?? []).filter((s) => s.is_key && String(s.highlight ?? "").trim()),
    [data],
  )
  // 三类标记是否至少命中一个（都没命中时给个提示，免得用户以为坏了）
  const hitAny = useMemo(() => segs.some((s) => s.kind !== null), [segs])

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (data) return
    setLoading(true)
    setError("")
    try {
      const res = await analyzeQuestion(text)
      setData(res)
    } catch (err) {
      setError(`解析失败: ${detailFromError(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="block-highlight">
      <button
        className="block-ops-btn block-highlight-btn"
        onClick={toggle}
        disabled={loading}
        title={open ? "收起解析" : "解析高亮（审题：量数/关系词/问题句）"}
        aria-label="解析高亮"
      >
        {loading ? "…" : open ? "✕" : "✨"}
      </button>
      {open && (
        <div className="block-highlight-body">
          {error && <p className="err">{error}</p>}
          {data && (
            <>
              <div className="block-hl-text-head">
                <span className="block-hl-label">审题高亮</span>
                <button
                  className="block-speak-btn"
                  disabled={speaking}
                  onClick={() => void speak(text)}
                  title="朗读题目"
                >
                  🔊
                </button>
              </div>
              <div className="block-hl-text">
                {segs.map((s, i) =>
                  s.kind === "qty" ? (
                    <span key={i} className="mh-qty">{s.text}</span>
                  ) : s.kind === "rel" ? (
                    <span key={i} className="mh-rel">{s.text}</span>
                  ) : s.kind === "ask" ? (
                    <span key={i} className="mh-ask">{s.text}</span>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </div>

              {!hitAny && (
                <div className="mh-empty">未能在原文定位到量数/关系词，可用下方「数量关系」看提取结果。</div>
              )}

              <div className="mh-legend">
                <span className="mh-legend-item"><i className="mh-swatch mh-qty" />量数</span>
                <span className="mh-legend-item"><i className="mh-swatch mh-rel" />关系词</span>
                <span className="mh-legend-item"><i className="mh-swatch mh-ask" />问题句</span>
              </div>

              {(data.quantities?.length ?? 0) > 0 && (
                <div className="mh-panel">
                  <div className="mh-panel-label">📊 数量</div>
                  <div className="mh-panel-body">
                    {data.quantities.map((q, i) => (
                      <span key={i} className="mh-chip">
                        {q.name} {q.value == null ? "？（所求）" : `${q.value}${q.unit || ""}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(data.relations?.length ?? 0) > 0 && (
                <div className="mh-panel">
                  <div className="mh-panel-label">🔗 数量关系</div>
                  <div className="mh-panel-body">
                    {data.relations.map((r, i) => (
                      <div key={i} className="mh-line">{relationText(r)}</div>
                    ))}
                  </div>
                </div>
              )}

              {(data.questions?.length ?? 0) > 0 && (
                <div className="mh-panel">
                  <div className="mh-panel-label">❓ 所求</div>
                  <div className="mh-panel-body">
                    {data.questions.map((q, i) => (
                      <div key={i} className="mh-line">
                        {q.text}
                        {q.target ? ` → 求：${q.target}` : ""}
                        {q.hint ? `（${q.hint}）` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {keyPoints.length > 0 && (
                <div className="mh-panel">
                  <div className="mh-panel-label">🔑 关键条件</div>
                  <div className="mh-panel-body">
                    {keyPoints.map((s, i) => (
                      <div key={i} className="mh-line">· {s.highlight}</div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
