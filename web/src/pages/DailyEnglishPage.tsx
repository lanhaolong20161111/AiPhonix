/** 每日一练 · 英语子页
 * - 设置面板：手动输入今日单词/句子（逗号/分号/换行分隔），支持拍照/相册 OCR 导入，跨设备同步。
 * - 正文：单词卡（图片/无、单词 TTS+SOE 评测、中文释义、LLM 造 2 例句各带 TTS/评测/翻译）
 *        + 句子卡（图片/无、TTS+SOE 评测、中文翻译、LLM 生成常用中文场景）。
 * 图片来自 english_image_index（数据库里没有就不显示）。
 * 英文 TTS 由服务端百度 TTS 自动识别英文（lan=en）；SOE 用腾讯英文引擎 16k_en。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  fetchDailyEn,
  saveDailyEn,
  readLocalMirror,
  writeLocalMirror,
  fetchWordInfo,
  fetchSentenceInfo,
  fetchDailyImage,
  dailyEnImageUrl,
  type DailyEnConfig,
  type EnWordInfo,
  type EnSentenceInfo,
} from "../services/dailyEn"
import { useTts } from "../hooks/useTts"
import { useSoeScore } from "../hooks/useSoeScore"
import { OcrPickSheet } from "../components/OcrPickSheet"
import { useAuthStore } from "../stores/authStore"

const splitWords = (s: string): string[] =>
  s.split(/[,，、;\s]+/).map((x) => x.trim()).filter(Boolean)

const splitSentences = (s: string): string[] =>
  s.split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean)

// ── 通用：发音评测按钮（录音 → 停止评分 → 显示分数） ──
function SoeButton({ refText, scene, engine = "16k_en" }: { refText: string; scene: string; engine?: string }) {
  const soe = useSoeScore(
    useCallback(() => ({ refText, scene, engine }), [refText, scene, engine]),
  )
  const onToggle = useCallback(() => {
    if (soe.state.recording) void soe.stop()
    else void soe.start()
  }, [soe])
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
      <button
        className="btn-secondary btn-sm"
        onClick={onToggle}
        disabled={soe.state.evaluating}
        style={{ background: soe.state.recording ? "#fee2e2" : undefined, color: soe.state.recording ? "#dc2626" : undefined }}
      >
        {soe.state.recording ? "⏹ 停止并评分" : soe.state.evaluating ? "评分中…" : "🎤 评测发音"}
      </button>
      {soe.state.score != null && (
        <span style={{ fontSize: 13, color: soe.state.score >= 80 ? "#16a34a" : soe.state.score >= 60 ? "#b8860b" : "#dc2626" }}>
          得分 {soe.state.score}
        </span>
      )}
      {soe.state.error && (
        <span style={{ fontSize: 12, color: "#dc2626" }}>{soe.state.error}</span>
      )}
    </div>
  )
}

// ── 单词卡 ──
function DailyEnWordCard({ word }: { word: string }) {
  const { speaking, speak } = useTts()
  const [info, setInfo] = useState<EnWordInfo | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [wi, img] = await Promise.all([fetchWordInfo(word), fetchDailyImage(word, "word")])
        if (!cancelled) {
          setInfo(wi)
          setImage(img)
        }
      } catch {
        /* 容错：卡片仍可朗读/评测 */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [word])

  return (
    <div className="daily-en-card">
      <div className="daily-en-card-head">
        {image ? (
          <img className="daily-en-img" src={dailyEnImageUrl(image)} alt={word} loading="lazy" />
        ) : (
          <div className="daily-en-img daily-en-img-empty">🖼️</div>
        )}
        <div className="daily-en-word-main">
          <b className="daily-en-word">{word}</b>
          {info?.translation && <span className="daily-en-trans">{info.translation}</span>}
          {info?.meaning && <span className="daily-en-meaning">{info.meaning}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-primary btn-sm" disabled={speaking} onClick={() => void speak(word)} title="听发音">
          🔊 发音
        </button>
      </div>
      <SoeButton refText={word} scene="word" />

      {loading && <p className="module-hint" style={{ marginTop: 8, opacity: 0.7 }}>正在生成例句…</p>}

      {info?.sentences?.length ? (
        <div className="daily-en-examples">
          {info.sentences.map((s, i) => (
            <EnSentenceLine key={i} en={s.en} zh={s.zh} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── 例句行（含自身 TTS + SOE + 翻译） ──
function EnSentenceLine({ en, zh }: { en: string; zh: string }) {
  const { speaking, speak } = useTts()
  return (
    <div className="daily-en-example">
      <div className="daily-en-example-line">
        <span className="daily-en-example-en">{en}</span>
        <button className="btn-secondary btn-sm" disabled={speaking} onClick={() => void speak(en)} title="听发音">
          🔊
        </button>
      </div>
      {zh && <div className="daily-en-example-zh">{zh}</div>}
      <SoeButton refText={en} scene="sentence" />
    </div>
  )
}

// ── 句子卡 ──
function DailyEnSentenceCard({ sentence }: { sentence: string }) {
  const { speaking, speak } = useTts()
  const [info, setInfo] = useState<EnSentenceInfo | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [si, img] = await Promise.all([fetchSentenceInfo(sentence), fetchDailyImage(sentence, "sentence")])
        if (!cancelled) {
          setInfo(si)
          setImage(img)
        }
      } catch {
        /* 容错 */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sentence])

  return (
    <div className="daily-en-card">
      <div className="daily-en-card-head">
        {image ? (
          <img className="daily-en-img" src={dailyEnImageUrl(image)} alt={sentence} loading="lazy" />
        ) : (
          <div className="daily-en-img daily-en-img-empty">🖼️</div>
        )}
        <div className="daily-en-word-main">
          <b className="daily-en-word">{sentence}</b>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-primary btn-sm" disabled={speaking} onClick={() => void speak(sentence)} title="听发音">
          🔊 发音
        </button>
      </div>
      <SoeButton refText={sentence} scene="sentence" />

      {loading && <p className="module-hint" style={{ marginTop: 8, opacity: 0.7 }}>正在生成翻译/场景…</p>}

      {info?.translation && (
        <div className="daily-en-example"><div className="daily-en-example-zh">翻译：{info.translation}</div></div>
      )}
      {info?.scene && (
        <div className="daily-en-scene">常用场景：{info.scene}</div>
      )}
    </div>
  )
}

export function DailyEnglishPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.session?.access_token ?? "")

  const [cfg, setCfg] = useState<DailyEnConfig>(() => readLocalMirror())
  const [draft, setDraft] = useState<DailyEnConfig>(() => readLocalMirror())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // OCR 导入
  type OcrField = "words" | "sentences"
  const [ocrMsg, setOcrMsg] = useState("")
  const [pickFile, setPickFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const albumInputRef = useRef<HTMLInputElement>(null)
  const ocrTargetRef = useRef<OcrField | null>(null)

  const pickFor = useCallback((field: OcrField, source: "camera" | "album" = "camera") => {
    ocrTargetRef.current = field
    const el = source === "album" ? albumInputRef.current : fileInputRef.current
    el?.click()
  }, [])

  const onOcrFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !ocrTargetRef.current) return
    setOcrMsg("")
    setPickFile(file)
  }, [])

  const confirmOcr = useCallback(async (text: string) => {
    const field = ocrTargetRef.current
    setPickFile(null)
    if (!field) return
    ocrTargetRef.current = null
    const next: DailyEnConfig = { ...draft, [field]: text, updatedAt: new Date().toISOString() }
    setDraft(next)
    setCfg(next)
    writeLocalMirror(next)
    if (accessToken) {
      try {
        await saveDailyEn(next)
        setOcrMsg(`✅ 已导入并保存（${text.length} 字符，跨设备同步）`)
      } catch {
        setOcrMsg("✅ 已导入并保存到本机（联网同步失败，可在设置里点「保存」重试）")
      }
    } else {
      setOcrMsg("✅ 已导入并保存到本机（登录后可跨设备同步）")
    }
  }, [draft, accessToken])

  // 进入页面：拉取服务端配置（今日 or 最近一次预填）
  useEffect(() => {
    let cancelled = false
    if (!accessToken) {
      const local = readLocalMirror()
      setCfg(local)
      setDraft(local)
      return
    }
    setLoading(true)
    void (async () => {
      try {
        const res = await fetchDailyEn()
        if (cancelled) return
        const next = res.config ?? res.last ?? readLocalMirror()
        writeLocalMirror(next)
        setCfg(next)
        setDraft(next)
      } catch {
        const local = readLocalMirror()
        if (!cancelled) { setCfg(local); setDraft(local) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accessToken])

  const openSettings = useCallback(() => { setDraft(cfg); setSettingsOpen(true) }, [cfg])

  const save = useCallback(async () => {
    const next: DailyEnConfig = { ...draft, updatedAt: new Date().toISOString() }
    if (accessToken) {
      try { await saveDailyEn(next) } catch { /* 失败仍写本地镜像 */ }
    }
    writeLocalMirror(next)
    setCfg(next)
    setSettingsOpen(false)
  }, [draft, accessToken])

  const words = useMemo(() => splitWords(cfg.words), [cfg.words])
  const sentences = useMemo(() => splitSentences(cfg.sentences), [cfg.sentences])

  const todaySummary = useMemo(() => {
    const parts: string[] = []
    if (words.length) parts.push(`单词 ${words.length} 个`)
    if (sentences.length) parts.push(`句子 ${sentences.length} 条`)
    return parts.length ? parts.join(" · ") : "今日内容：家长还没有设置，点右上角 ⚙️ 设置"
  }, [words.length, sentences.length])

  return (
    <div className="page aipractice-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🏆 每日英语</h1>
        <button className="home-settings-btn" onClick={openSettings} title="设置今日单词/句子" aria-label="设置今日内容">
          ⚙️
        </button>
      </header>
      <p className="module-hint">{todaySummary}</p>
      {loading && <p className="module-hint" style={{ marginTop: -8, opacity: 0.7 }}>正在同步今日配置…</p>}

      {words.map((w) => <DailyEnWordCard key={w} word={w} />)}
      {sentences.map((s) => <DailyEnSentenceCard key={s} sentence={s} />)}

      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="每日英语设置">
            <div className="settings-sheet-head">
              <span className="settings-sheet-title">⚙️ 今日英语内容</span>
              <button className="btn-secondary btn-sm" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <div className="settings-sheet-body">
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onOcrFile} />
              <input ref={albumInputRef} type="file" accept="image/*" hidden onChange={onOcrFile} />
              {ocrMsg && (
                <p style={{ fontSize: 12, color: ocrMsg.startsWith("❌") ? "#dc2626" : "#16a34a", margin: "0 0 8px", padding: "6px 8px", background: ocrMsg.startsWith("❌") ? "#fef2f2" : "#f0fdf4", borderRadius: 6 }}>
                  {ocrMsg}
                </p>
              )}
              <div className="settings-row">
                <span className="settings-row-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>🔤 今天练的单词</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => pickFor("words", "camera")} disabled={!!pickFile} title="拍照识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#eef2ff", color: "#4f46e5", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>📷</button>
                    <button onClick={() => pickFor("words", "album")} disabled={!!pickFile} title="从相册选图识别"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>🖼️</button>
                  </span>
                </span>
                <textarea
                  className="daily-zh-textarea"
                  rows={3}
                  value={draft.words}
                  onChange={(e) => setDraft({ ...draft, words: e.target.value })}
                  placeholder="用逗号/空格分隔，如：apple, cat, dog, red"
                />
              </div>
              <div className="settings-row">
                <span className="settings-row-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>✏️ 今天练的句子</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => pickFor("sentences", "camera")} disabled={!!pickFile} title="拍照识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#eef2ff", color: "#4f46e5", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>📷</button>
                    <button onClick={() => pickFor("sentences", "album")} disabled={!!pickFile} title="从相册选图识别"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>🖼️</button>
                  </span>
                </span>
                <textarea
                  className="daily-zh-textarea"
                  rows={3}
                  value={draft.sentences}
                  onChange={(e) => setDraft({ ...draft, sentences: e.target.value })}
                  placeholder="用分号/换行分隔，如：I like apples.; She is a student."
                />
              </div>
              <div className="settings-row" style={{ borderBottom: "none", flexDirection: "row", justifyContent: "flex-end" }}>
                <button className="btn-secondary" onClick={() => setSettingsOpen(false)}>取消</button>
                <button className="btn-primary" onClick={save} style={{ marginLeft: 8 }}>保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pickFile && (
        <OcrPickSheet
          file={pickFile}
          title="📷 识别要导入的内容"
          stripPinyin={false}
          onClose={() => { setPickFile(null); ocrTargetRef.current = null }}
          onConfirm={confirmOcr}
        />
      )}
    </div>
  )
}
