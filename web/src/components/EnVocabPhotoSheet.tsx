/** 英语识图取词弹层 —— 拍照/相册选图 → **整页识别** → 抽出「所有单词 + 所有句子」→ 勾选后导入。
 *
 *  与 OcrPickSheet（手动拖框选）的区别：这里不框选，因为目标是「把这一页的词句都捞出来」，
 *  而不是精修某几行。识别原文可展开编辑（删掉页码/答案等噪声）→ 抽词实时重算。
 *
 *  抽词规则在 `lib/enVocabExtract.ts`（纯函数、有单测），本组件只负责展示与勾选。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { parseImage, type ParseStage } from "../services/aiImage"
import { extractEnglishVocab } from "../lib/enVocabExtract"
import { PhonicsText, PhonicsWord } from "./PhonicsWord"
import { ParseTimer } from "./ParseTimer"
import { OcrEnginePicker } from "./OcrEnginePicker"

interface EnVocabPhotoSheetProps {
  file: File
  onClose: () => void
  /** 导入已勾选的单词/句子（父级填入输入框，由用户点「开始对话」） */
  onDone: (words: string[], sentences: string[]) => void
}

export function EnVocabPhotoSheet({ file, onClose, onDone }: EnVocabPhotoSheetProps) {
  const [imgUrl, setImgUrl] = useState("")
  /** 识别阶段（非空 = 识别中，复用 ParseTimer 显示耗时） */
  const [stage, setStage] = useState<ParseStage | null>(null)
  /** 识别原文（可编辑，也是抽词的唯一数据源） */
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  /** 展开识别原文编辑器 */
  const [editOpen, setEditOpen] = useState(false)
  /** 抽词开关：是否保留 a/the/is 等虚词 */
  const [keepStop, setKeepStop] = useState(false)
  /** 被取消勾选的条目（用「词/句」本身而不是下标，重新识别后下标会变） */
  const [offWords, setOffWords] = useState<Set<string>>(() => new Set())
  const [offSentences, setOffSentences] = useState<Set<string>>(() => new Set())

  const busy = stage !== null

  // 预览 URL 生命周期
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const run = useCallback(
    async (noCache: boolean) => {
      setError("")
      setStage("preparing")
      setText("")
      setOffWords(new Set())
      setOffSentences(new Set())
      try {
        const res = await parseImage(file, "english", noCache, setStage)
        const t = ((res.text ?? "") || (res.blocks ?? []).map((b) => b.text).join("\n")).trim()
        if (!t) {
          setError("没识别到文字，换一张更清晰、更正的照片试试（别反光、别拍歪）")
          return
        }
        setText(t)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setStage(null)
      }
    },
    [file],
  )

  // 打开弹层立刻整页识别（无需用户再点一次）
  useEffect(() => {
    void run(false)
  }, [run])

  const vocab = useMemo(() => (text.trim() ? extractEnglishVocab(text, { keepStop }) : null), [text, keepStop])
  const selWords = useMemo(() => (vocab?.words ?? []).filter((w) => !offWords.has(w)), [vocab, offWords])
  const selSentences = useMemo(
    () => (vocab?.sentences ?? []).filter((s) => !offSentences.has(s)),
    [vocab, offSentences],
  )

  /** 切换虚词开关：词表整体变了，清空勾选状态重来 */
  const toggleKeepStop = () => {
    setKeepStop((v) => !v)
    setOffWords(new Set())
    setOffSentences(new Set())
  }

  const toggleWord = (w: string) =>
    setOffWords((s) => {
      const n = new Set(s)
      if (n.has(w)) n.delete(w)
      else n.add(w)
      return n
    })

  const toggleSentence = (s: string) =>
    setOffSentences((prev) => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })

  const selectAll = () => {
    setOffWords(new Set())
    setOffSentences(new Set())
  }
  const selectNone = () => {
    setOffWords(new Set(vocab?.words ?? []))
    setOffSentences(new Set(vocab?.sentences ?? []))
  }

  const canImport = selWords.length > 0 || selSentences.length > 0
  const stageText =
    stage === "preparing"
      ? "🖼️ 正在处理图片…"
      : stage === "uploading"
        ? "⬆️ 正在上传…"
        : "🔍 AI 正在识别整页文字（约 10~30 秒，请稍候）…"

  return (
    <div className="settings-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="settings-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="拍照识词"
        style={{ maxHeight: "90vh" }}
      >
        <div className="settings-sheet-head">
          <span className="settings-sheet-title">📷 拍照识词</span>
          <button className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>
        <div className="settings-sheet-body" style={{ overflow: "auto" }}>
          {imgUrl && (
            <img
              src={imgUrl}
              alt="待识别"
              style={{
                display: "block",
                width: "100%",
                maxHeight: 150,
                objectFit: "contain",
                borderRadius: 8,
                background: "#0f172a",
                marginBottom: 8,
              }}
            />
          )}

          {busy && (
            <p className="ai-parse-status">
              <ParseTimer active /> {stageText}
            </p>
          )}

          {error && <p className="err">{error}</p>}

          {!busy && error && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button className="btn-secondary" onClick={() => void run(true)}>🔄 重试</button>
            </div>
          )}

          {!busy && vocab && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>
                  ✅ 识别完成：{vocab.words.length} 个单词 · {vocab.sentences.length} 个句子
                </span>
                <button className="btn-secondary btn-sm" onClick={() => void run(true)}>🔄 重新识别</button>
              </div>

              <div className="envocab-engine" style={{ marginTop: 8 }}>
                <OcrEnginePicker showLabel={false} />
                <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>
                  换模型后点上方「🔄 重新识别」生效。
                </p>
              </div>

              {/* 识别原文（可编辑，删掉噪声行会实时重算词句） */}
              <button
                className="envocab-disclosure"
                onClick={() => setEditOpen((v) => !v)}
                aria-expanded={editOpen}
              >
                {editOpen ? "▾" : "▸"} 识别原文（{text.length} 字，可编辑后重算）
              </button>
              {editOpen && (
                <textarea
                  className="text-input"
                  style={{ width: "100%", minHeight: 110, fontSize: 12, marginTop: 4 }}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}

              {/* 虚词开关：词表变化 → 清空勾选 */}
              <label className="envocab-switch">
                <input type="checkbox" checked={keepStop} onChange={toggleKeepStop} />
                <span>包含虚词（a / the / is / and …）—— 默认已剔除，觉得漏词就勾上</span>
              </label>

              {/* 单词 */}
              <div className="envocab-section">
                <div className="envocab-sec-title">
                  <span>🔤 单词（已选 {selWords.length}/{vocab.words.length}）</span>
                  {vocab.wordsTruncated && <span style={{ color: "#d97706" }}>超出上限已截断</span>}
                </div>
                {vocab.words.length === 0 ? (
                  <p className="envocab-empty">没有抽出单词。</p>
                ) : (
                  <div className="envocab-chips">
                    {vocab.words.map((w) => {
                      const on = !offWords.has(w)
                      return (
                        <button
                          key={w}
                          type="button"
                          className={`envocab-chip${on ? " on" : ""}`}
                          onClick={() => toggleWord(w)}
                          aria-pressed={on}
                          title={on ? "点击取消这个单词" : "点击加回这个单词"}
                        >
                          <PhonicsWord word={w} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 句子 */}
              <div className="envocab-section">
                <div className="envocab-sec-title">
                  <span>✏️ 句子（已选 {selSentences.length}/{vocab.sentences.length}）</span>
                  {vocab.sentencesTruncated && <span style={{ color: "#d97706" }}>超出上限已截断</span>}
                </div>
                {vocab.sentences.length === 0 ? (
                  <p className="envocab-empty">没有抽出句子（图片里可能只有零散单词）。</p>
                ) : (
                  vocab.sentences.map((s) => {
                    const on = !offSentences.has(s)
                    return (
                      <label key={s} className={`envocab-sent${on ? " on" : ""}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleSentence(s)} />
                        <span><PhonicsText text={s} /></span>
                      </label>
                    )
                  })
                )}
              </div>

              <div className="envocab-foot">
                <span className="envocab-foot-hint">
                  {selWords.length || selSentences.length
                    ? `将导入：${selWords.length} 个单词、${selSentences.length} 个句子`
                    : "至少要留一个单词或句子"}
                </span>
                <button className="btn-secondary btn-sm" onClick={selectAll}>全选</button>
                <button className="btn-secondary btn-sm" onClick={selectNone}>全不选</button>
              </div>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button className="btn-secondary" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              className="btn-primary"
              disabled={!canImport}
              style={{ opacity: canImport ? 1 : 0.5 }}
              onClick={() => onDone(selWords, selSentences)}
            >
              ✓ 用这些词句出题
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
