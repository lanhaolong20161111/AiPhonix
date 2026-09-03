/** 碎碎念页 — 自由表达 → AI 语法纠错 → 正确句子朗读 + 录音测评
 *
 * 流程：
 *   1. 文本框输入 / 拍照 / 相册 / 粘贴图片 → OCR 导入文字
 *   2. 点「给 AI 审核」→ LLM 返回 JSON（错误区间 + 正确句子 + 说明）
 *   3. 原文用红色波浪线标出语法错误处
 *   4. 下方展示正确句子，可 TTS 朗读、可录音 SOE 测评
 */

import { useCallback, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { askLlm } from "../services/aiAsk"
import { parseImage } from "../services/aiImage"
import { useTts, useGlobalReading } from "../hooks/useTts"
import { useSoeScore } from "../hooks/useSoeScore"

/** 语法错误区间（字符索引，含头不含尾） */
interface ErrorSpan {
  start: number
  end: number
  message: string
}

interface ReviewResult {
  errors: ErrorSpan[]
  corrected: string
  notes: string
}

/** 构造审核提示词：要求 LLM 严格返回 JSON */
function buildReviewPrompt(raw: string): string {
  return `你是一位耐心的语文老师。请审核下面这段学生写的话，找出语法、用词、标点方面的错误，并给出改正后的完整句子。

学生原文：
${raw}

请严格按以下 JSON 格式回复，不要有任何多余文字，不要加 markdown 代码块标记：
{
  "errors": [
    {"start": 0, "end": 3, "message": "这里错在哪、应该怎么改"}
  ],
  "corrected": "改正后的完整句子",
  "notes": "对每个错误的简要解释，多个错误用换行分隔"
}

要求：
1. errors 里 start/end 是错误文字在原文中的字符下标，从 0 开始，含头不含尾
2. 一段话有多个错误就返回多个对象，按 start 从小到大排列
3. 如果没有错误，errors 返回空数组 []，corrected 原样返回原文
4. corrected 必须是改正后的完整句子，保留学生原本想表达的意思
5. 面向小学生，语气鼓励，解释简单易懂`
}

/** 解析 LLM 返回；失败时降级为「整段当正确句子」 */
function parseReview(raw: string, original: string): ReviewResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  try {
    const obj = JSON.parse(cleaned) as {
      errors?: Array<{ start?: number; end?: number; message?: string }>
      corrected?: string
      notes?: string
    }
    const spans: ErrorSpan[] = []
    for (const e of obj.errors ?? []) {
      const start = Number(e.start)
      const end = Number(e.end)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      // 安全裁剪，防止 LLM 给出越界下标
      const s = Math.max(0, Math.min(start, original.length))
      const t = Math.max(s, Math.min(end, original.length))
      spans.push({ start: s, end: t, message: e.message ?? "" })
    }
    spans.sort((a, b) => a.start - b.start)
    return {
      errors: spans,
      corrected: (obj.corrected ?? "").trim() || original,
      notes: (obj.notes ?? "").trim(),
    }
  } catch {
    // LLM 没按格式回：整段回复当正确句子，不标错误
    return { errors: [], corrected: cleaned || original, notes: "AI 返回格式异常，已直接展示 AI 回复" }
  }
}

/** 按错误区间把原文切成片段，供渲染波浪线 */
function splitSegments(text: string, spans: ErrorSpan[]) {
  const segs: Array<{ text: string; err: boolean }> = []
  let cursor = 0
  for (const sp of spans) {
    const s = Math.max(cursor, Math.min(sp.start, text.length))
    const e = Math.max(s, Math.min(sp.end, text.length))
    if (s > cursor) segs.push({ text: text.slice(cursor, s), err: false })
    if (e > s) segs.push({ text: text.slice(s, e), err: true })
    cursor = e
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor), err: false })
  return segs
}

export function MurmurPage() {
  const navigate = useNavigate()
  const { speaking, speak } = useTts()
  const reading = useGlobalReading()

  const [text, setText] = useState("")
  const [ocrBusy, setOcrBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState<ReviewResult | null>(null)
  const [error, setError] = useState("")

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const corrected = review?.corrected ?? ""

  // 录音测评：以「正确句子」为参考文本
  const soeOpts = useCallback(
    () => ({ refText: corrected, scene: "sentence", source: "碎碎念" }),
    [corrected],
  )
  const { state: soe, start: startRec, stop: stopRec } = useSoeScore(soeOpts)

  /** 图片 → OCR → 追加到文本框 */
  const importImage = useCallback(async (file: File | Blob) => {
    if (ocrBusy) return
    setOcrBusy(true)
    setError("")
    try {
      const res = await parseImage(file, "chinese")
      const blocks = res.blocks ?? []
      const recognized =
        (res.text ?? "").trim() ||
        (blocks.length ? blocks.map((b) => b.text).join("") : "")
      if (!recognized.trim()) {
        setError("没认出文字，换一张更清晰、正一点的照片试试")
        return
      }
      setText((prev) => (prev.trim() ? `${prev.trim()}\n${recognized}` : recognized))
      // 已有新内容，旧审核结果作废
      setReview(null)
    } catch (e) {
      setError(`图片识别失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOcrBusy(false)
    }
  }, [ocrBusy])

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 允许连续选同一张图
    e.target.value = ""
    if (file) void importImage(file)
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const it of e.clipboardData?.items ?? []) {
      if (it.type.startsWith("image/")) {
        const file = it.getAsFile()
        if (file) {
          e.preventDefault()
          void importImage(file)
          return
        }
      }
    }
  }

  /** 提交给 AI 审核 */
  const submitReview = async () => {
    const raw = text.trim()
    if (!raw || reviewing) return
    setReviewing(true)
    setError("")
    setReview(null)
    try {
      const reply = await askLlm(buildReviewPrompt(raw), "chinese")
      setReview(parseReview(reply, raw))
    } catch (e) {
      setError(`AI 审核失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setReviewing(false)
    }
  }

  const resetAll = () => {
    setText("")
    setReview(null)
    setError("")
  }

  const busy = ocrBusy || reviewing || speaking
  const segments = review ? splitSegments(text, review.errors) : []

  return (
    <div className="page murmur-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>💬 碎碎念</h1>
        {text.trim() && (
          <button className="btn-secondary btn-sm" onClick={resetAll} disabled={busy}>
            清空
          </button>
        )}
      </header>
      <p className="module-hint">随便说点什么 → AI 帮你纠错 → 学正确说法</p>

      {/* ── 输入区 ── */}
      <div className="card">
        <h2 className="section-title">✍️ 写下你想说的话</h2>
        <textarea
          className="essay-textarea"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          placeholder="今天发生了什么、你的想法、你的感受……也可以直接粘贴或拍摄图片，自动认字"
        />
        <div className="ai-upload-row" style={{ marginTop: 8 }}>
          <button
            className="btn-secondary"
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            title="调起相机拍照，自动识别文字"
          >
            📷 拍照
          </button>
          <button
            className="btn-secondary"
            onClick={() => galleryRef.current?.click()}
            disabled={busy}
          >
            🖼️ 相册
          </button>
          <button
            className="btn-primary"
            onClick={submitReview}
            disabled={busy || !text.trim()}
          >
            {reviewing ? "AI 审核中…" : ocrBusy ? "识别中…" : "✅ 给 AI 审核"}
          </button>
        </div>
        {/* 拍照：移动端直接调起后置相机；相册：普通选图 */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={onPickFile}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onPickFile}
        />
      </div>

      {ocrBusy && <p className="empty">正在识别图片文字…</p>}
      {reviewing && <p className="empty">AI 正在检查语法…</p>}
      {error && <p className="err">{error}</p>}

      {/* ── 审核结果 ── */}
      {review && (
        <>
          {/* 原文 + 红色波浪线 */}
          <div className="card murmur-original">
            <h2 className="section-title murmur-title-warn">📝 你的原文</h2>
            <p className="murmur-text">
              {segments.map((seg, i) =>
                seg.err ? (
                  <span key={i} className="murmur-err" title="语法有问题">{seg.text}</span>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </p>
            {review.errors.length > 0 ? (
              <p className="murmur-legend">
                红色波浪线 = 有问题的地方（共 {review.errors.length} 处）
              </p>
            ) : (
              <p className="murmur-legend ok">✓ 没有发现语法问题，写得很好！</p>
            )}
          </div>

          {/* 错误说明 */}
          {review.notes && (
            <div className="card murmur-notes">
              <div className="murmur-notes-header">
                <h2 className="section-title murmur-title-info">💡 错在哪、怎么改</h2>
                <button
                  className="btn-secondary btn-sm"
                  disabled={speaking || soe.recording}
                  onClick={() => void speak(review.notes)}
                >
                  {speaking ? "🔊 朗读中…" : "🔊 朗读解释"}
                </button>
              </div>
              <div className="murmur-notes-body">
                {review.notes.split(/\n+/).filter(Boolean).map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {/* 正确句子 + 朗读 + 测评 */}
          {corrected && (
            <div className="card murmur-corrected">
              <h2 className="section-title murmur-title-ok">✅ 正确的说法</h2>
              <p className="murmur-text murmur-corrected-text">
                {[...corrected].map((ch, i) => {
                  const isReading = reading?.text === corrected && reading.charIndex === i
                  return (
                    <span key={i} className={isReading ? "murmur-char reading" : "murmur-char"}>
                      {ch}
                    </span>
                  )
                })}
              </p>

              <div className="essay-actions">
                <button
                  className="btn-secondary"
                  disabled={speaking || soe.recording}
                  onClick={() => void speak(corrected)}
                >
                  {speaking ? "🔊 朗读中…" : "🔊 朗读"}
                </button>
                <button
                  className={soe.recording ? "btn-primary recording" : "btn-primary"}
                  disabled={speaking || soe.evaluating}
                  onClick={() => {
                    if (soe.recording) void stopRec()
                    else void startRec()
                  }}
                >
                  {soe.recording ? "⏹ 我读完了" : soe.evaluating ? "评分中…" : "🎤 我来读"}
                </button>
              </div>

              {soe.recording && (
                <div className="murmur-recording">
                  <span className="murmur-dot" />
                  正在听你读…读完后点「我读完了」
                  <span className="murmur-level">
                    <span className="murmur-level-bar" style={{ width: `${Math.round(soe.level * 100)}%` }} />
                  </span>
                </div>
              )}

              {soe.error && <p className="err">{soe.error}</p>}

              {soe.result && (
                <div className="murmur-score">
                  <div className="murmur-score-head">
                    <span>发音得分</span>
                    <b className={scoreClass(soe.score ?? 0)}>{soe.score ?? 0} 分</b>
                  </div>
                  <div className="murmur-chips">
                    <span className="murmur-chip">流利度 {pct(soe.result.pron_fluency)}</span>
                    <span className="murmur-chip">完整度 {pct(soe.result.pron_completion)}</span>
                  </div>
                  <p className="murmur-score-tip">{scoreTip(soe.score ?? 0)}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!review && !busy && !text.trim() && (
        <p className="empty">在上面写点什么，或拍张照片导入文字</p>
      )}
    </div>
  )
}

function pct(v: number): string {
  return `${Math.round((v ?? 0) * 100)}%`
}

function scoreClass(score: number): string {
  if (score >= 80) return "good"
  if (score >= 60) return "ok"
  return "bad"
}

function scoreTip(score: number): string {
  if (score >= 90) return "读得非常棒！🎉"
  if (score >= 80) return "读得很好，继续保持！👍"
  if (score >= 60) return "不错，再跟读几遍会更流利。"
  return "多听几遍朗读，再跟着读一次试试 💪"
}
