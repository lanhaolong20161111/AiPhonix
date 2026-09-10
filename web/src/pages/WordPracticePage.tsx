/** 词语练习页 — 一词造三句例句：句内高亮目标词语，每句可 🔊 TTS 朗读 + 🎤 跟读测评（SOE）；
 *  点词语/例句里的字可听发音。无默写（旧 █ 遮罩/自动朗读循环/核对页已移除）。 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { useNavigate } from "react-router-dom"
import { queryWords, queryWordsByGrades, queryWordsByTexts, type WordBankEntry } from "../services/wordbank"
import { useTts } from "../hooks/useTts"
import { useSoeScore } from "../hooks/useSoeScore"
import { useFeatureGrades } from "../hooks/useTrainingConfig"
import { loadDailyZhSynced } from "../services/dailyZh"
import { JoyStoryCard } from "../components/JoyStoryCard"
import { api } from "../services/api"

const SENTENCE_COUNT = 3

/** 词语结构规律（后端 /llm/word-structure 返回）：pattern=结构名，roles=逐字角色（与字序一一对应），summary=一句话讲解 */
interface WordStructure {
  pattern: string
  roles: { char: string; role: string }[]
  summary: string
}

interface WordItem {
  entry: WordBankEntry
  sentences: string[]
  /** 最近一次生成是否失败（用于展示「重试」而非永远「生成中」） */
  failed?: boolean
  /** 结构规律（AI 分析；null=已尝试但无结果） */
  structure?: WordStructure | null
  /** 结构分析状态：undefined=未开始；loading=进行中；done=完成；failed=请求失败（下次进入重试） */
  structureState?: "loading" | "done" | "failed"
}

/** 把句中出现的目标词语切成 {text, hit} 段（hit 段渲染为高亮，出现几次高亮几次） */
function splitByWord(sentence: string, word: string): { text: string; hit: boolean }[] {
  if (!sentence) return []
  if (!word) return [{ text: sentence, hit: false }]
  const segs: { text: string; hit: boolean }[] = []
  let rest = sentence
  let idx = rest.indexOf(word)
  while (idx >= 0) {
    if (idx > 0) segs.push({ text: rest.slice(0, idx), hit: false })
    segs.push({ text: word, hit: true })
    rest = rest.slice(idx + word.length)
    idx = rest.indexOf(word)
  }
  if (rest) segs.push({ text: rest, hit: false })
  return segs
}

const scoreColor = (score: number) => (score >= 80 ? "#2e7d32" : score >= 60 ? "#f9a825" : "#b71c1c")

// ── 结构高亮：角色 → 浅色底（文字纯黑，符合全局高对比规范） ──
const ROLE_BG: Record<string, string> = {
  动词: "#FFE0B2", // 橙
  名词: "#BBDEFB", // 蓝
  形容词: "#C8E6C9", // 绿
  副词: "#E1BEE7", // 紫
  数词: "#FFECB3", // 黄
  量词: "#F8BBD0", // 粉
  代词: "#D1C4E9", // 紫罗兰
  连词: "#B2DFDB", // 青
  助词: "#CFD8DC", // 蓝灰
  重叠: "#FFF9C4", // 米黄
  修饰: "#B3E5FC", // 浅蓝
  补充: "#DCEDC8", // 浅绿
  主体: "#FFCCBC", // 浅橙
}
const DEFAULT_ROLE_BG = "#EEF2F7"
/** 角色名归一：去掉括号/间隔号后的说明（如 "名词·身体部位" → "名词"），用于取色和图例 */
const normalizeRole = (role: string) => role.split(/[（(·、]/)[0].trim()
const roleBg = (role: string) => ROLE_BG[normalizeRole(role)] ?? ROLE_BG[role] ?? DEFAULT_ROLE_BG

/** 结构规律卡片：逐字按角色着色高亮 + 结构名徽章 + 角色图例 + AI 一句话讲解。
 *  点单个字可听发音；无结构数据且非加载中时整卡不渲染。 */
function StructureCard({ word, structure, loading }: { word: string; structure?: WordStructure | null; loading?: boolean }) {
  const { speakChar } = useTts()
  const chars = [...word]
  const roles = structure?.roles ?? []
  const legend: { name: string; bg: string }[] = []
  for (const r of roles) {
    const name = normalizeRole(r.role)
    if (name && !legend.some((x) => x.name === name)) legend.push({ name, bg: roleBg(r.role) })
  }
  if (!loading && (!structure?.pattern || !structure?.summary)) return null
  return (
    <div style={{ marginTop: 12, borderRadius: 14, padding: "12px 14px", background: "#F8FAFC", border: "1.5px dashed #c7d2fe" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#000000", marginBottom: 6 }}>🧩 结构规律</div>
      <div className="tap-char" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.7, letterSpacing: 3, textAlign: "center" }}>
        {chars.map((ch, i) => {
          const role = roles[i]?.role ?? ""
          return (
            <span
              key={i}
              className="tap-char-item"
              onClick={() => void speakChar(ch)}
              style={{ background: role ? roleBg(role) : DEFAULT_ROLE_BG, borderRadius: 8, padding: "2px 5px", margin: "0 2px", color: "#000000" }}
            >
              {ch}
            </span>
          )
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {structure?.pattern && (
          <span style={{ background: "#e0e7ff", color: "#000000", fontWeight: 700, fontSize: 13, borderRadius: 999, padding: "2px 10px" }}>
            {structure.pattern}
          </span>
        )}
        {legend.map((x) => (
          <span
            key={x.name}
            style={{ background: x.bg, color: "#000000", fontSize: 12, borderRadius: 999, padding: "2px 10px", border: "1px solid rgba(15,23,42,.15)" }}
          >
            {x.name}
          </span>
        ))}
      </div>
      {structure?.summary && (
        <p style={{ fontSize: 14, color: "#000000", margin: "10px 2px 0", lineHeight: 1.75 }}>💡 {structure.summary}</p>
      )}
      {loading && (
        <p style={{ fontSize: 12, color: "#64748b", textAlign: "center", marginTop: 8 }}>
          <span className="wp-spinner" /> AI 正在分析词语结构…
        </p>
      )}
    </div>
  )
}

/** 单条例句：句内高亮目标词（逐字可点读）+ 🔊 朗读 + 🎤 跟读测评（scene=sentence，中文引擎自动） */
function SentenceLine({ sentence, word }: { sentence: string; word: string }) {
  const { speaking, speak, speakChar } = useTts()
  const soe = useSoeScore(
    useCallback(() => ({ refText: sentence, scene: "sentence", source: word }), [sentence, word]),
  )
  const onToggle = useCallback(() => {
    if (soe.state.recording) void soe.stop()
    else void soe.start()
  }, [soe])
  const segs = splitByWord(sentence, word)
  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "10px 12px", marginTop: 10, background: "#fff" }}>
      <div className="tap-char" style={{ fontSize: 21, lineHeight: 1.9, color: "#000000" }}>
        {segs.map((seg, si) => (
          <span
            key={si}
            style={
              seg.hit
                ? { background: "#FFF3D6", borderRadius: 6, padding: "1px 2px", fontWeight: 700 }
                : undefined
            }
          >
            {[...seg.text].map((ch, ci) => (
              <span key={ci} className="tap-char-item" onClick={() => void speakChar(ch)}>
                {ch}
              </span>
            ))}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
        <button
          className="btn-secondary btn-sm"
          style={{ width: "auto" }}
          disabled={speaking}
          onClick={() => void speak(sentence)}
        >
          🔊 朗读
        </button>
        <button
          className="btn-secondary btn-sm"
          style={{
            width: "auto",
            background: soe.state.recording ? "#fee2e2" : undefined,
            color: soe.state.recording ? "#b71c1c" : undefined,
          }}
          disabled={soe.state.evaluating}
          onClick={onToggle}
        >
          {soe.state.recording ? "⏹ 停止并评分" : soe.state.evaluating ? "评分中…" : "🎤 测评"}
        </button>
        {soe.state.score != null && (
          <span style={{ fontSize: 14, fontWeight: 700, color: scoreColor(soe.state.score) }}>
            得分 {soe.state.score}
          </span>
        )}
        {soe.state.error && <span style={{ fontSize: 12, color: "#b71c1c" }}>{soe.state.error}</span>}
      </div>
    </div>
  )
}

export function WordPracticePage() {
  const navigate = useNavigate()
  const { speak } = useTts()
  const [items, setItems] = useState<WordItem[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  // 今日练词列表（家长设置；选词宫格用）
  const [todayWords, setTodayWords] = useState<string[]>([])
  // 今日配置原文（供记忆快乐本卡片展示/生成）
  const [todayRawWords, setTodayRawWords] = useState("")
  // 今日词选词宫格：有今日配置时先展示宫格选词，点击某词才进入练习
  const [pickOpen, setPickOpen] = useState(true)

  const grades = useFeatureGrades("word_practice")

  /** 调后端造句（count=3 一次拿三句；后端有缓存则秒回，冷缓存调 LLM 较慢）。原地写 item.sentences。 */
  const fillSentences = async (item: WordItem): Promise<boolean> => {
    if (item.sentences.length >= SENTENCE_COUNT) return true
    item.failed = false
    try {
      const res = await api<{ sentence?: string; sentence2?: string; sentences?: string[] }>(
        "/llm/sentence-generate",
        {
          method: "POST",
          body: { word: item.entry.text, count: SENTENCE_COUNT },
          timeoutMs: 60000, // 冷缓存要调 LLM（首次较慢），放宽到 60s，避免 15s 掐断 → 永远「生成中」
        },
      )
      const got = (Array.isArray(res.sentences) && res.sentences.length > 0
        ? res.sentences
        : [res.sentence, res.sentence2]
      )
        .map((s) => String(s ?? "").trim())
        .filter(Boolean)
      if (got.length > 0) {
        item.sentences = Array.from(new Set(got)).slice(0, SENTENCE_COUNT)
        return true
      }
      item.failed = true
      return false
    } catch {
      item.failed = true
      return false
    }
  }

  /** 调后端分析词语结构规律（命中缓存秒回；冷缓存调 LLM）。原地写 item.structure / structureState。 */
  const fillStructure = async (item: WordItem): Promise<void> => {
    if (item.structureState === "loading" || item.structureState === "done") return
    item.structureState = "loading"
    try {
      const res = await api<{ structure?: WordStructure | null }>("/llm/word-structure", {
        method: "POST",
        body: { word: item.entry.text },
        timeoutMs: 45000, // 冷缓存要调 LLM
      })
      item.structure = res?.structure ?? null
      item.structureState = "done"
    } catch {
      item.structure = null
      item.structureState = "failed" // 下次进入该词时重试
    }
  }

  const loadQuiz = async () => {
    setLoading(true)
    setMessage("加载题目...")
    try {
      // 每日一练指定了今日词 → 优先按手打列表过滤（词库命中才练）；否则按年级/全部
      // loadDailyZhSynced：已登录走服务端（跨设备同步），失败退本地镜像
      const dailyCfg = await loadDailyZhSynced()
      setTodayRawWords(dailyCfg.words ?? "")
      const dailyTexts = (dailyCfg.words ?? "").split(/[,，、;\s]+/).map((x) => x.trim()).filter(Boolean)
      setTodayWords(dailyTexts)
      let all: WordBankEntry[] = []
      if (dailyTexts.length > 0) {
        const hits = await queryWordsByTexts(dailyTexts)
        const hitSet = new Set(hits.map((e) => e.text))
        const misses = dailyTexts.filter((t) => !hitSet.has(t))
        // 词库没有的词 → 合成词条，例句由 /llm/sentence-generate 统一造（不再走 ensureGenerated）
        const genEntries: WordBankEntry[] = misses.map((t) => ({
          text: t,
          pinyin: "",
          tags: ["词语"],
          type: "word",
          ipa: "",
          ipa_uk: "",
          letter: "",
          phonemes: [],
          phonemes_uk: [],
          emoji: "",
          difficulty: 0,
          translation: "",
        }))
        all = [...hits, ...genEntries]
        if (all.length === 0) {
          setMessage(`词语库中没有这些词，请检查每日设置：${dailyTexts.join("、")}`)
          setLoading(false)
          return
        }
      } else {
        all = grades.length > 0 ? await queryWordsByGrades(grades) : await queryWords("词语")
      }
      if (all.length === 0) {
        setMessage(grades.length > 0 ? "所选年级暂无词语，请家长调整范围" : "词语库为空")
        setLoading(false)
        return
      }
      const selected = [...all].sort(() => Math.random() - 0.5)
      const words: WordItem[] = selected.map((entry) => ({ entry, sentences: [] }))
      setItems(words)
      setIndex(0)
      setPickOpen(dailyTexts.length > 0)
      setMessage(dailyTexts.length > 0 ? `今日练词：${dailyTexts.join("、")}` : "")
      setLoading(false)
      // 首屏只预生成前 2 个词（服务端缓存命中秒回；冷缓存调 LLM），其余词进入时 goTo 懒生成。
      // 只预取 2 个，避免并发打爆 LLM 配额/限流导致整体更慢。
      await Promise.allSettled(words.slice(0, 2).map((item) => fillSentences(item)))
      // 第 1 词（index=0 当前显示）并行预取结构规律；其余词进入时 goTo 懒分析。
      if (words[0]) {
        void fillStructure(words[0]).then(() => setItems((prev) => [...prev]))
      }
      setItems((prev) => [...prev]) // fillSentences 原地改了 item.sentences，换数组引用触发重渲染
    } catch (e) {
      setMessage(`加载失败: ${String((e as Error)?.message ?? e)}`)
      setLoading(false)
    }
  }

  // grades（家长配置）变化或首次进入 → 重新加载题目（StrictMode 双挂载防重复）
  const loadedGradesRef = useRef<string | null>(null)
  useEffect(() => {
    const key = grades.join(",")
    if (loadedGradesRef.current === key) return
    loadedGradesRef.current = key
    void loadQuiz()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades])

  /** 切到某个词（并懒生成它的两句例句 + 结构规律；循环切换，永远不会卡在首尾） */
  const goTo = (idx: number) => {
    const target = Math.max(0, Math.min(items.length - 1, idx))
    const item = items[target]
    if (item && item.sentences.length < SENTENCE_COUNT) {
      item.failed = false // 先回到「生成中」态，再异步填充
      void fillSentences(item).then(() => setItems((prev) => [...prev]))
    }
    if (item && item.structureState !== "loading" && item.structureState !== "done") {
      void fillStructure(item).then(() => setItems((prev) => [...prev]))
    }
    setIndex(target)
  }

  const retrySentences = () => {
    const item = items[index]
    if (!item) return
    item.failed = false
    setItems((prev) => [...prev]) // 立即回到「生成中」态，给出反馈
    void fillSentences(item).then(() => setItems((prev) => [...prev]))
  }

  if (loading && items.length === 0) {
    return (
      <div className="page center-page">
        <p className="empty">加载题目…</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="page center-card">
        <p className="empty">{message || "词语库为空"}</p>
      </div>
    )
  }

  // 今日词选词宫格（保留）：不直接进入某个词的练习，点击某词才开始练
  if (pickOpen && todayWords.length > 0) {
    return (
      <div className="page word-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>词语练习</h1>
          <span className="module-level">今日 {todayWords.length} 词</span>
        </header>
        <p className="module-hint">点选要练的词👇</p>
        <JoyStoryCard chars="" words={todayRawWords} scope="word" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "8px 6px" }}>
          {todayWords.map((t, i) => {
            const idx = items.findIndex((it) => it.entry.text === t)
            const hit = idx >= 0
            return (
              <button key={`${t}-${i}`} disabled={!hit}
                onClick={() => { setPickOpen(false); goTo(idx) }}
                title={hit ? `练「${t}」` : "词语库未命中该词"}
                style={{
                  width: 88, minHeight: 48, fontSize: 18, lineHeight: 1.2, borderRadius: 14,
                  cursor: hit ? "pointer" : "not-allowed",
                  border: `2px solid ${hit ? "#93c5fd" : "#e2e8f0"}`,
                  background: hit ? "#eff6ff" : "#f8fafc",
                  color: hit ? "#1e3a8a" : "#cbd5e1",
                  boxShadow: hit ? "0 2px 6px rgba(59,130,246,.15)" : "none",
                } as CSSProperties}>{t}</button>
            )
          })}
        </div>
        {todayWords.some((t) => !items.some((it) => it.entry.text === t)) && (
          <p style={{ fontSize: 11, color: "#94a3b8", padding: "0 6px" }}>
            置灰的词不在词语库中，无法练习（可在每日设置里调整）
          </p>
        )}
      </div>
    )
  }

  const current = items[index]
  const word = current.entry.text
  const pinyin = current.entry.pinyin ?? ""

  return (
    <div className="page word-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>词语练习</h1>
        {todayWords.length > 0 ? (
          <button className="btn-secondary btn-sm" onClick={() => setPickOpen(true)} title="返回选词">☰ 选词</button>
        ) : (
          <span className="module-level">第 {index + 1}/{items.length} 词</span>
        )}
      </header>
      <p className="module-hint">一词两句例句：黄色高亮的就是本词。词语下方会标出结构规律（如：动宾+动宾、ABAC），点字可听发音。</p>

      <div className="card" style={{ padding: 14 }}>
        {/* 词语大字：点击听发音 */}
        <div style={{ textAlign: "center" }}>
          <button
            onClick={() => void speak(word, { pinyin })}
            title="听词语发音"
            style={{
              width: "auto", background: "none", border: "none", boxShadow: "none",
              padding: "4px 10px", margin: "0 auto", display: "inline-block",
              fontSize: 36, fontWeight: 700, color: "#000000", lineHeight: 1.3, cursor: "pointer",
            } as CSSProperties}
          >
            {word} 🔊
          </button>
          <div style={{ fontSize: 12, color: "#64748b" }}>点击词语听发音</div>
        </div>

        {/* 结构规律卡片：逐字按角色高亮 + 结构名 + AI 一句话讲解（无数据且非加载中时不渲染） */}
        <StructureCard word={word} structure={current.structure} loading={current.structureState === "loading"} />

        {/* 两句例句：句内高亮词语，每句可朗读 + 跟读测评 */}
        {current.sentences.length === 0 ? (
          <div style={{ textAlign: "center", padding: "14px 0 6px" }}>
            {current.failed ? (
              <>
                <p className="msg" style={{ color: "#b71c1c" }}>例句生成失败（可能是网络或 AI 额度问题）</p>
                <button className="btn-secondary btn-sm" style={{ width: "auto" }} onClick={retrySentences}>
                  ↻ 重试
                </button>
              </>
            ) : (
              <>
                <span className="wp-spinner" />
                <p className="msg">🤖 AI 正在造句…首次约需 10~30 秒，之后秒开</p>
              </>
            )}
          </div>
        ) : (
          current.sentences.map((s, i) => (
            <SentenceLine key={`${word}-${i}`} sentence={s} word={word} />
          ))
        )}
      </div>

      <div className="nav-row" style={{ marginTop: 12 }}>
        <button className="btn-secondary" style={{ width: "auto" }} onClick={() => goTo((index - 1 + items.length) % items.length)}>
          ← 上一个
        </button>
        <button className="btn-secondary" style={{ width: "auto" }} onClick={() => goTo((index + 1) % items.length)}>
          下一个 →
        </button>
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: "#64748b", marginTop: 6 }}>
        第 {index + 1} / {items.length} 词
      </p>
      {message && <p className="msg">{message}</p>}
    </div>
  )
}
