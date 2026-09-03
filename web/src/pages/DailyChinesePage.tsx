/** 每日一练 · 语文子页 — 4 个固定练习入口 + 手动设置今日要练的字/词/句/作文主题
 *
 * 配置存储策略（2026-08-31 修复跨设备不同步）：
 * - 已登录：配置存入服务端数据库（按 账号 + 日期），任意设备读取同一天内容；
 *   当天未设时服务端返回最近一次内容供预填草稿，家长改后点保存即落今日库。
 * - 未登录：退回 localStorage 本地镜像（仅本机），并作为联网失败时的兜底。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getCharCountByTexts, getWordCountByTexts } from "../services/wordbank"
import {
  fetchDailyZh,
  saveDailyZh,
  readLocalMirror,
  writeLocalMirror,
  type DailyZhConfig,
} from "../services/dailyZh"
import { OcrPickSheet } from "../components/OcrPickSheet"
import { useAuthStore } from "../stores/authStore"

const splitText = (s: string): string[] =>
  s.split(/[,，、;\s]+/).map((x) => x.trim()).filter(Boolean)

export function DailyChinesePage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.session?.access_token ?? "")

  const [cfg, setCfg] = useState<DailyZhConfig>(() => readLocalMirror())
  const [draft, setDraft] = useState<DailyZhConfig>(() => readLocalMirror())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hitInfo, setHitInfo] = useState<{ chars: number; words: number } | null>(null)
  const [prefillHint, setPrefillHint] = useState(false)
  const [loading, setLoading] = useState(false)

  // ── 拍照识别自动导入（字/词/句） ──
  type OcrField = "chars" | "words" | "sentences"
  const [ocrMsg, setOcrMsg] = useState("")
  const [pickFile, setPickFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null) // 拍照（capture 强制相机）
  const albumInputRef = useRef<HTMLInputElement>(null) // 相册选图（不带 capture）
  const ocrTargetRef = useRef<OcrField | null>(null)
  // 当前 OCR 目标字段（用于决定导入到哪个字段，以及练字场景是否加空格）
  const [ocrField, setOcrField] = useState<OcrField>("chars")

  /** source: "camera" 拍照 / "album" 相册选图 */
  const pickFor = useCallback((field: OcrField, source: "camera" | "album" = "camera") => {
    ocrTargetRef.current = field
    setOcrField(field)
    const el = source === "album" ? albumInputRef.current : fileInputRef.current
    el?.click()
  }, [])

  // 拿到文件后先打开识别选择器（自由框选多个区域），确认后才填入
  const onOcrFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // 允许重复选择同一文件
    if (!file || !ocrTargetRef.current) return
    setOcrMsg("")
    setPickFile(file)
  }, [])

  // 拍照导入确认 → 填入并【立即自动保存】（服务端+本地镜像），无需再手动点保存，其他设备/重进都生效
  const confirmOcr = useCallback(async (text: string) => {
    const field = ocrTargetRef.current
    setPickFile(null)
    if (!field) return
    ocrTargetRef.current = null
    const next: DailyZhConfig = { ...draft, [field]: text, updatedAt: new Date().toISOString() }
    setDraft(next)
    setCfg(next)
    setPrefillHint(false)
    writeLocalMirror(next)
    if (accessToken) {
      try {
        await saveDailyZh(next)
        setOcrMsg(`✅ 已导入并保存（${text.length} 字，跨设备同步）`)
      } catch {
        setOcrMsg("✅ 已导入并保存到本机（联网同步失败，可在设置里点「保存」重试）")
      }
    } else {
      setOcrMsg("✅ 已导入并保存到本机（登录后可跨设备同步）")
    }
  }, [draft, accessToken])

  // 进入页面：已登录拉取服务端（今日 config 或最近一次 last 预填）；未登录用本地镜像
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
        const res = await fetchDailyZh()
        if (cancelled) return
        const next = res.config ?? res.last ?? readLocalMirror()
        writeLocalMirror(next)
        setCfg(next)
        setDraft(next)
        setPrefillHint(!res.config && !!res.last)
      } catch {
        // 联网失败 → 退回本地镜像
        const local = readLocalMirror()
        if (!cancelled) {
          setCfg(local)
          setDraft(local)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken])

  // 打开设置时同步草稿
  const openSettings = useCallback(() => {
    setDraft(cfg)
    setSettingsOpen(true)
  }, [cfg])

  // 统计今日字词在词库中的命中数（练字/练词页只能练词库有的）
  useEffect(() => {
    void (async () => {
      const chars = splitText(cfg.chars)
      const words = splitText(cfg.words)
      const [cn, wn] = await Promise.all([getCharCountByTexts(chars), getWordCountByTexts(words)])
      setHitInfo({ chars: cn, words: wn })
    })()
  }, [cfg.chars, cfg.words])

  const save = useCallback(async () => {
    const next: DailyZhConfig = { ...draft, updatedAt: new Date().toISOString() }
    if (accessToken) {
      try {
        await saveDailyZh(next)
      } catch {
        /* 服务端失败仍写本地镜像，保证本机可用 */
      }
    }
    writeLocalMirror(next)
    setCfg(next)
    setPrefillHint(false)
    setSettingsOpen(false)
  }, [draft, accessToken])

  const charsTotal = splitText(cfg.chars).length
  const wordsTotal = splitText(cfg.words).length
  const sentencesTotal = splitText(cfg.sentences).length

  const entry = (emoji: string, title: string, sub: string, to: string, badge?: string) => (
    <button className="english-mode-card" onClick={() => navigate(to)}>
      <span className="english-mode-icon">{emoji}</span>
      <span className="english-mode-body">
        <b>{title}{badge ? ` · ${badge}` : ""}</b>
        <span>{sub}</span>
      </span>
      <span className="english-mode-arrow">›</span>
    </button>
  )

  const todaySummary = useMemo(() => {
    const parts: string[] = []
    if (charsTotal) parts.push(`练字 ${charsTotal} 个${hitInfo != null ? `（词库命中 ${hitInfo.chars}）` : ""}`)
    if (wordsTotal) parts.push(`练词 ${wordsTotal} 个${hitInfo != null ? `（词库命中 ${hitInfo.words}）` : ""}`)
    if (sentencesTotal) parts.push(`练句 ${sentencesTotal} 条`)
    if (cfg.essayTopic.trim()) parts.push(`作文「${cfg.essayTopic.trim()}」`)
    return parts.length ? parts.join(" · ") : "今日内容：家长还没有设置，点右上角 ⚙️ 设置"
  }, [charsTotal, wordsTotal, sentencesTotal, cfg.essayTopic, hitInfo])

  return (
    <div className="page aipractice-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🏆 每日语文</h1>
        <button className="home-settings-btn" onClick={openSettings} title="设置今日字词句作文" aria-label="设置今日内容">
          ⚙️
        </button>
      </header>
      <p className="module-hint">{todaySummary}</p>
      {prefillHint && (
        <p className="module-hint" style={{ color: "#b8860b", marginTop: -8 }}>
          已带入最近一次内容，修改后点「保存」即生效为今日配置（跨设备同步）
        </p>
      )}
      {loading && <p className="module-hint" style={{ marginTop: -8, opacity: 0.7 }}>正在同步今日配置…</p>}

      {entry(
        "🔤",
        "练字",
        "看图认汉字，跟读发音",
        "/module/recognition",
        charsTotal ? `今日 ${charsTotal} 字` : undefined,
      )}
      {entry(
        "📚",
        "练词",
        "词语跟读与辨析",
        "/module/word_practice",
        wordsTotal ? `今日 ${wordsTotal} 词` : undefined,
      )}
      {entry("✏️", "练句", "给词造句，AI 老师批改", "/module/sentence_practice", sentencesTotal ? `今日 ${sentencesTotal} 条` : undefined)}
      {entry(
        "🖊️",
        "主题作文",
        "按主题口述/写作，AI 评分润色",
        "/module/oral_writing",
        cfg.essayTopic.trim() ? cfg.essayTopic.trim().slice(0, 8) : undefined,
      )}

      {/* 设置面板：手动输入今日内容 */}
      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="每日语文设置">
            <div className="settings-sheet-head">
              <span className="settings-sheet-title">⚙️ 今日语文内容</span>
              <button className="btn-secondary btn-sm" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <div className="settings-sheet-body">
              {/* 拍照识别入口（手机调相机，桌面选图片） */}
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onOcrFile} />
              {/* 相册选图入口（不带 capture，可打开系统相册/文件选择器） */}
              <input ref={albumInputRef} type="file" accept="image/*" hidden onChange={onOcrFile} />
              {ocrMsg && (
                <p style={{ fontSize: 12, color: ocrMsg.startsWith("❌") ? "#dc2626" : "#16a34a", margin: "0 0 8px", padding: "6px 8px", background: ocrMsg.startsWith("❌") ? "#fef2f2" : "#f0fdf4", borderRadius: 6 }}>
                  {ocrMsg}
                </p>
              )}
              <div className="settings-row">
                <span className="settings-row-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>🔤 今天练的字</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => pickFor("chars", "camera")} disabled={!!pickFile} title="拍照识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#eef2ff", color: "#4f46e5", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>
                      {pickFile ? "⏳" : "📷"}
                    </button>
                    <button onClick={() => pickFor("chars", "album")} disabled={!!pickFile} title="从相册选图识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>
                      🖼️
                    </button>
                  </span>
                </span>
                <textarea
                  className="daily-zh-textarea"
                  rows={2}
                  value={draft.chars}
                  onChange={(e) => setDraft({ ...draft, chars: e.target.value })}
                  placeholder="用逗号/空格分隔，如：日 月 水 火"
                />
              </div>
              <div className="settings-row">
                <span className="settings-row-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>📚 今天练的词</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => pickFor("words", "camera")} disabled={!!pickFile} title="拍照识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#eef2ff", color: "#4f46e5", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>
                      {pickFile ? "⏳" : "📷"}
                    </button>
                    <button onClick={() => pickFor("words", "album")} disabled={!!pickFile} title="从相册选图识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>
                      🖼️
                    </button>
                  </span>
                </span>
                <textarea
                  className="daily-zh-textarea"
                  rows={2}
                  value={draft.words}
                  onChange={(e) => setDraft({ ...draft, words: e.target.value })}
                  placeholder="如：春天，朋友，认真"
                />
              </div>
              <div className="settings-row">
                <span className="settings-row-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>✏️ 今天练的句子/句型</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => pickFor("sentences", "camera")} disabled={!!pickFile} title="拍照识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#eef2ff", color: "#4f46e5", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>
                      {pickFile ? "⏳" : "📷"}
                    </button>
                    <button onClick={() => pickFor("sentences", "album")} disabled={!!pickFile} title="从相册选图识别，自动填入"
                      style={{ border: "1px solid #e2e8f0", background: pickFile ? "#f1f5f9" : "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: pickFile ? "wait" : "pointer" }}>
                      🖼️
                    </button>
                  </span>
                </span>
                <textarea
                  className="daily-zh-textarea"
                  rows={2}
                  value={draft.sentences}
                  onChange={(e) => setDraft({ ...draft, sentences: e.target.value })}
                  placeholder="如：用「因为…所以…」造句；用「有的…有的…」写一段话"
                />
              </div>
              <div className="settings-row">
                <span className="settings-row-label">🖊️ 作文主题</span>
                <textarea
                  className="daily-zh-textarea"
                  rows={2}
                  value={draft.essayTopic}
                  onChange={(e) => setDraft({ ...draft, essayTopic: e.target.value })}
                  placeholder="如：我的好朋友 / 难忘的一天"
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

      {/* 拍照识别选择器：自由框选多个区域，按顺序拼接后导入 */}
      {pickFile && (
        <OcrPickSheet
          file={pickFile}
          title="📷 识别要导入的内容（自动去除拼音）"
          stripPinyin
          spaceChars={ocrField === "chars"}
          onClose={() => { setPickFile(null); ocrTargetRef.current = null }}
          onConfirm={confirmOcr}
        />
      )}
    </div>
  )
}
