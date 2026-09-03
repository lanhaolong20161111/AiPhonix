/** 造句练习页 — 给一个词，孩子输入造句，AI 判对错并给更正（复用 ai-chat 纠错标签） */

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTts } from "../hooks/useTts"
import { askWithProfile } from "../services/aiAsk"
import { reviewQueue, type WordbookItem } from "../services/wordbook"
import { loadDailyZhSynced } from "../services/dailyZh"

/** 常用词池（词库不可用时的兜底） */
const FALLBACK_WORDS = ["春天", "朋友", "认真", "一起", "漂亮", "帮助", "发现", "快乐"]

export function SentencePracticePage() {
  const navigate = useNavigate()
  const { speaking, speak } = useTts()
  const [word, setWord] = useState("")
  const [sentence, setSentence] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ reply: string; corrected: string | null; wrongs: string[] } | null>(null)
  // 今日练句列表（家长设置，点选可直接练对应句型，不按固定顺序）
  const [todaySentences, setTodaySentences] = useState<string[]>([])
  // 今日句选句页：有今日配置时先展示句型列表，点选才进入造句练习
  const [pickOpen, setPickOpen] = useState(true)

  // 进入页面加载今日练句配置（服务端优先，跨设备同步）
  useEffect(() => {
    void (async () => {
      const cfg = await loadDailyZhSynced()
      const list = cfg.sentences
        .split(/\n+|(?<=[。；;])\s*/)// 按行/句号切分
        .map((x) => x.trim())
        .filter(Boolean)
      setTodaySentences(list)
    })()
  }, [])

  // 取下一个练习目标：今日练句随机 → 生词本到期 → 兜底词
  const pickWord = useCallback(async (): Promise<string> => {
    if (todaySentences.length > 0) {
      return todaySentences[Math.floor(Math.random() * todaySentences.length)]
    }
    try {
      const due: WordbookItem[] = await reviewQueue()
      if (due.length > 0) return due[Math.floor(Math.random() * due.length)].text
    } catch {
      /* 忽略 */
    }
    return FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)]
  }, [todaySentences])

  const next = useCallback(async () => {
    setResult(null)
    setSentence("")
    setWord(await pickWord())
  }, [pickWord])

  // 进入逻辑：今日有句子配置 → 停在选句页等用户点选；否则随机取词直接练
  useEffect(() => {
    if (todaySentences.length === 0) void next()
  }, [todaySentences, next])

  const submit = async () => {
    const s = sentence.trim()
    if (!s || busy || !word) return
    setBusy(true)
    setResult(null)
    try {
      const isTodayTask = todaySentences.includes(word)
      const prompt = isTodayTask
        ? `今天的造句练习要求是：${word}。我写的句子是：${s}。请检查是否正确完成了要求（用词、语法、语义），并简单讲解。`
        : `请检查我用「${word}」造的句子是否正确（用词、语法、语义），并简单讲解：${s}`
      const res = await askWithProfile(
        "chinese",
        prompt,
        "",
        "",
        "",
      )
      setResult({
        reply: res.reply ?? "",
        corrected: res.correction?.corrected ?? null,
        wrongs: res.correction?.wrongs ?? [],
      })
    } catch (e) {
      setResult({ reply: e instanceof Error ? e.message : "提交失败，请重试", corrected: null, wrongs: [] })
    } finally {
      setBusy(false)
    }
  }

  const wrongInSentence = (content: string): boolean =>
    (result?.wrongs ?? []).some((f) => f && content.includes(f))

  return (
    <div className="page wordbook-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>✏️ 造句练习</h1>
        <button className="btn-secondary btn-sm" onClick={() => void next()} title="换一个词">🔀 换词</button>
      </header>
      {pickOpen && todaySentences.length > 0 ? (
        <div>
          <p className="module-hint">点选要练的句型/句子👇</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "8px 6px" }}>
            {todaySentences.map((t, i) => (
              <button key={`${t}-${i}`} onClick={() => { setResult(null); setSentence(""); setWord(t); setPickOpen(false) }}
                title={`练：${t}`}
                style={{
                  minWidth: 120, padding: "10px 12px", fontSize: 14, lineHeight: 1.3, borderRadius: 14,
                  cursor: "pointer", border: "2px solid #93c5fd", background: "#eff6ff",
                  color: "#1e3a8a", boxShadow: "0 2px 6px rgba(59,130,246,.15)",
                  textAlign: "left",
                } as React.CSSProperties}>{t}</button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <p className="module-hint">用下面的词造一个句子，AI 老师来判断对不对，还会帮你改。</p>

          {/* 今日练句点选条：点谁直接练谁，不按固定顺序 */}
          {todaySentences.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "0 4px 10px" }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>今日练句（点选直接练）：</span>
              {todaySentences.map((t, i) => {
                const active = t === word
                return (
                  <button key={`${t}-${i}`} onClick={() => { setResult(null); setSentence(""); setWord(t); setPickOpen(false) }}
                    title={`练：${t}`}
                    style={{
                      padding: "4px 10px", fontSize: 12, maxWidth: "100%",
                      borderRadius: 8, cursor: "pointer",
                      border: `1.5px solid ${active ? "#3b82f6" : "#e2e8f0"}`,
                      background: active ? "#dbeafe" : "#fff",
                      color: active ? "#1d4ed8" : "#334155",
                      fontWeight: active ? 700 : 400,
                    } as React.CSSProperties}>{t}</button>
                )
              })}
            </div>
          )}

          <div className="card wordbook-card">
            <button className="wordbook-big" disabled={speaking} onClick={() => void speak(word)} title="点击听发音">
              {word}
            </button>
            <textarea
              className="sentence-input"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              placeholder={`用「${word}」写一句话…（输入法语音转文字也可以）`}
              rows={3}
              disabled={busy}
            />
            <div className="wordbook-btns">
              <button className="btn-primary" disabled={busy || !sentence.trim()} onClick={() => void submit()}>
                {busy ? "老师看句子中…" : "提交给 AI 老师"}
              </button>
            </div>
          </div>

          {result && (
            <div className="card sentence-result">
              {result.corrected && (
                <div className="ai-chat-fix" style={{ maxWidth: "100%" }}>
                  ✏️ {result.corrected}
                </div>
              )}
              <p className="sentence-reply">
                {[...result.reply].map((ch, i) => (
                  <span key={i} className={wrongInSentence(ch) ? "ai-chat-wrong" : undefined}>
                    {ch}
                  </span>
                ))}
              </p>
              <div className="ai-chat-actions">
            {result.corrected && (
              <button className="ai-chat-speak" disabled={speaking} onClick={() => void speak(result.corrected!)}>
                🔊 读更正句
              </button>
            )}
            <button className="ai-chat-speak" disabled={speaking} onClick={() => void speak(result.reply)}>
              🔊 读点评
            </button>
          </div>
        </div>
      )}
    </div>
  )}
</div>
)
}
