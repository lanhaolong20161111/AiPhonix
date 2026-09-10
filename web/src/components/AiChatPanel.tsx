/** AI 多轮对话面板 — 微信式对话 + 角色扮演 + 音色切换 + 逐字点读即加生词本 + 跟读评分弱读高亮
 *
 * - 右侧定位条：长方形标签显示提问前 5 个字，点击定位轮次
 * - 气泡逐字：点读单字 → 朗读并自动加入生词本（SRS 复习）
 * - 朗读全文：卡拉OK逐字高亮；跟读后发音弱的字橙色波浪线标出
 * - 语文模块可切换 AI 角色（李白/悟空/Mike 外教/高老师），全局可切换 TTS 音色
 */

import { useEffect, useRef, useState, type ReactNode } from "react"
import type { ChatTurn, useAiChat } from "../hooks/useAiChat"
import { isSpeakableChar } from "../lib/chars"
import { useGlobalReading, useTts } from "../hooks/useTts"
import { useSoeScore } from "../hooks/useSoeScore"
import { ROLES, VOICES, useAiRole, useVoice } from "../lib/aiPrefs"
import { useTeacherScore } from "../lib/teacherScore"
import { addWordbook, addWordbookMany } from "../services/wordbook"

type ChatApi = ReturnType<typeof useAiChat>

interface AiChatPanelProps {
  chat: ChatApi
}

/** SOE 弱读阈值：单词 pron_accuracy 低于该值标记为弱读 */
const WEAK_THRESHOLD = 75

interface BubbleCtx {
  charIndex: number | null
  selectMode: boolean
  selected: Set<string>
  /** 点读回调：ch=被点字符；wbUnit=加入生词本的单位（汉字=该字，拉丁=所属整词） */
  onCharClick: (ch: string, wbUnit: string) => void
  onToggleSelect: (ch: string) => void
  weakChars: Set<string> | null
}

/** 选择模式切词：CJK 单字 / 连续拉丁(字母数字撇号)整词 / 其它(空白标点)原样分隔 */
function tokenizeForSelect(content: string): { text: string; kind: "cjk" | "latin" | "sep" }[] {
  const units: { text: string; kind: "cjk" | "latin" | "sep" }[] = []
  let buf = ""
  let bufKind: "cjk" | "latin" | null = null
  const flush = () => {
    if (buf) {
      units.push({ text: buf, kind: bufKind! })
      buf = ""
      bufKind = null
    }
  }
  for (const ch of [...content]) {
    let kind: "cjk" | "latin" | "sep"
    if (/[一-鿿㐀-䶿]/.test(ch)) kind = "cjk"
    else if (/[A-Za-z0-9']/.test(ch)) kind = "latin"
    else kind = "sep"
    if (kind === "sep") {
      flush()
      units.push({ text: ch, kind: "sep" })
    } else {
      if (bufKind !== kind) {
        flush()
        bufKind = kind
      }
      buf += ch
    }
  }
  flush()
  return units
}

/** 对话气泡逐字渲染：
 * - 普通模式：可发音字点击 → 朗读并自动加入生词本
 * - 选择模式：按「汉字单字 / 拉丁整词」切词，点词切换"已选"高亮；最后用底部条 addWordbookMany 批量加入
 * charIndex=朗读卡拉OK当前字；weakChars=跟读弱读字（值匹配）；wrongSet=纠错错误片段 */
function renderBubbleChars(t: ChatTurn, ctx: BubbleCtx): ReactNode {
  const content = t.content

  // 选择模式：中文按字、英文按整词，点词加入待选集合
  if (ctx.selectMode) {
    return tokenizeForSelect(content).map((unit, i) => {
      if (unit.kind === "sep") return <span key={i}>{unit.text}</span>
      const isSel = ctx.selected.has(unit.text)
      return (
        <span
          key={i}
          className={isSel ? "ai-char-selected" : undefined}
          style={{ cursor: "pointer" }}
          onClick={() => ctx.onToggleSelect(unit.text)}
          title={isSel ? "取消选择" : "选入生词本"}
        >
          {unit.text}
        </span>
      )
    })
  }

  const wrongSet = new Set<number>()
  if (t.correction?.wrongs) {
    for (const f of t.correction.wrongs) {
      if (!f) continue
      let idx = content.indexOf(f)
      while (idx >= 0) {
        for (let i = idx; i < idx + f.length; i++) wrongSet.add(i)
        idx = content.indexOf(f, idx + 1)
      }
    }
  }
  // 每个字符 → 加入生词本的单位：汉字=该字，拉丁字母=所属整词（点字母收整词），其它=空
  const chars = [...content]
  const wordAt: string[] = new Array(chars.length).fill("")
  {
    let off = 0
    for (const unit of tokenizeForSelect(content)) {
      if (unit.kind === "cjk") {
        // 单个汉字：逐字长度 1（CJK 无代理对），直接映射
        for (let k = 0; k < [...unit.text].length; k++) wordAt[off + k] = unit.text[k]
        off += [...unit.text].length
      } else if (unit.kind === "latin") {
        const len = unit.text.length
        for (let k = 0; k < len; k++) wordAt[off + k] = unit.text
        off += len
      } else {
        off += [...unit.text].length
      }
    }
  }
  return chars.map((ch, i) => {
    const cls = [
      ctx.charIndex === i ? "ai-char-reading" : "",
      wrongSet.has(i) ? "ai-chat-wrong" : "",
      ctx.weakChars?.has(ch) ? "ai-char-weak" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const clickable = isSpeakableChar(ch)
    if (!clickable) {
      return <span key={i} className={cls || undefined}>{ch}</span>
    }
    const wbUnit = wordAt[i] || ch
    return (
      <span
        key={i}
        className={cls || undefined}
        style={{ cursor: "pointer" }}
        onClick={() => ctx.onCharClick(ch, wbUnit)}
        title="点读自动加生词本"
      >
        {ch}
      </span>
    )
  })
}

export function AiChatPanel({ chat }: AiChatPanelProps) {
  const { turns, asking, error, ask, newChat, module } = chat
  const { speaking, speak } = useTts()
  const reading = useGlobalReading()
  const turnRefs = useRef<(HTMLDivElement | null)[]>([])
  const [draft, setDraft] = useState("")

  // 角色（仅语文模块显示切换）与音色
  const [role, setRole] = useAiRole(module)
  const teacherScore = useTeacherScore(module)
  const [voice, setVoice] = useVoice(module)

  // 生词本加入反馈 toast
  const [wbToast, setWbToast] = useState<string | null>(null)
  const wbToastTimer = useRef<number | null>(null)
  const showToast = (text: string) => {
    setWbToast(text)
    if (wbToastTimer.current) window.clearTimeout(wbToastTimer.current)
    wbToastTimer.current = window.setTimeout(() => setWbToast(null), 1800)
  }

  // 点读单个字：全局互斥（朗读中忽略），带当前音色；同时自动加入生词本（会话内去重，
  // 同一词只加一次；汉字收单字、英文收所属整词——由 renderBubbleChars 的 wbUnit 给出）
  const wbAddedRef = useRef<Set<string>>(new Set())
  const onCharClick = (ch: string, wbUnit: string) => {
    const unit = (wbUnit ?? "").trim()
    if (unit && isSpeakableChar(unit[0]) && !wbAddedRef.current.has(unit)) {
      wbAddedRef.current.add(unit)
      void addWordbook(unit, "", `chat_${module}`).then((ok) => {
        if (ok) showToast(`「${unit}」已加入生词本`)
      })
    }
    if (!speaking) void speak(ch, { speaker: voice })
  }

  // 选择模式：点字加入待选集合，底部条批量 addWordbookMany 同时加入生词本
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = (ch: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ch)) next.delete(ch)
      else next.add(ch)
      return next
    })
  }
  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }
  const confirmAddSelected = () => {
    const arr = [...selected]
    if (!arr.length) return
    void addWordbookMany(arr, `chat_${module}`).then((ok) => {
      showToast(ok ? `已加入 ${arr.length} 个生词` : "加入生词本失败，请重试")
      if (ok) setSelected(new Set())
    })
  }

  // ── 跟读 SOE：refText 由按钮点击时指定；评完提取弱读字 ──
  const followTextRef = useRef("")
  const followTurnIdxRef = useRef<number | null>(null)
  const [followTurnIdx, setFollowTurnIdx] = useState<number | null>(null)
  const [weakByTurn, setWeakByTurn] = useState<Record<number, Set<string>>>({})
  const soe = useSoeScore(() => ({
    refText: followTextRef.current,
    evalMode: "1",
    scene: "sentence",
    source: "chat_follow",
  }))

  // 评测完成 → 从 words 提取弱读字（accuracy < 阈值）挂到对应轮次
  useEffect(() => {
    const result = soe.state.result
    const idx = followTurnIdxRef.current
    if (!result || idx == null) return
    const weak = new Set<string>()
    for (const w of result.words ?? []) {
      if ((w.accuracy ?? 100) < WEAK_THRESHOLD) {
        for (const ch of w.word ?? "") if (/[\u4e00-\u9fff a-zA-Z]/i.test(ch)) weak.add(ch)
      }
    }
    if (weak.size > 0) setWeakByTurn((prev) => ({ ...prev, [idx]: weak }))
  }, [soe.state.result])

  const toggleFollow = async (idx: number, text: string) => {
    if (soe.state.recording) {
      await soe.stop()
      return
    }
    if (soe.state.evaluating || speaking) return
    followTextRef.current = text
    followTurnIdxRef.current = idx
    setFollowTurnIdx(idx)
    await soe.start()
  }

  const send = () => {
    const q = draft.trim()
    if (!q || asking) return
    setDraft("")
    void ask(q)
  }

  // 一个问答轮 = 一条用户提问（其后紧跟 AI 回答）。按用户消息定位到轮次起点。
  const userIndexes = turns
    .map((t, i) => ({ role: t.role, i }))
    .filter((x) => x.role === "user")
    .map((x) => x.i)

  const jumpTo = (userIdx: number) => {
    const el = turnRefs.current[userIdx]
    el?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // 微信式体验：新消息到达自动滚到底部
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, asking])

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-head">
        <h2 className="section-title">💬 对话</h2>
        {turns.length > 0 && (
          <button className="btn-secondary btn-sm" onClick={newChat} title="结束当前对话并保留在历史里，开一场新对话">
            ➕ 新对话
          </button>
        )}
      </div>

      {/* 角色扮演（仅语文模块）+ 音色切换 */}
      <div className="ai-chat-prefs">
        {module === "chinese" && (
          <div className="ai-chat-pref-group">
            <span className="ai-score-chip" title="小老师游戏累计得分">🏆 {teacherScore}</span>
            {ROLES.map((r) => (
              <button
                key={r.id || "default"}
                className={`ai-pref-chip${role === r.id ? " active" : ""}`}
                onClick={() => setRole(r.id)}
                title={r.id ? "切换 AI 角色" : "默认语文老师"}
              >
                {r.emoji} {r.label}
              </button>
            ))}
          </div>
        )}
        <div className="ai-chat-pref-group">
          {VOICES.map((v) => (
            <button
              key={v.id}
              className={`ai-pref-chip${voice === v.id ? " active" : ""}`}
              onClick={() => setVoice(v.id)}
              title="本模块默认朗读音色（可在首页⚙️设置里调整）"
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-chat-scroll">
        {/* 左侧：对话列表（微信式：AI 靠左白气泡，学生靠右绿气泡，头像分侧） */}
        <div className="ai-chat-list" ref={listRef}>
          {turns.map((t, i) => (
            <div
              key={i}
              ref={(el) => { turnRefs.current[i] = el }}
              className={`ai-chat-turn ${t.role === "user" ? "user" : "assistant"}`}
            >
              <div className="ai-chat-avatar">{t.role === "user" ? "🙋" : "🤖"}</div>
              <div className="ai-chat-bubble-wrap">
                <div className="ai-chat-bubble" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {renderBubbleChars(t, {
                    charIndex: reading && reading.text === t.content ? reading.charIndex : null,
                    selectMode,
                    selected,
                    onCharClick,
                    onToggleSelect: toggleSelect,
                    weakChars: weakByTurn[i] ?? null,
                  })}
                </div>
                {t.role === "user" && t.correction && (
                  <div className="ai-chat-fix" title="老师帮你改了一下这句话">
                    ✏️ {t.correction.corrected}
                  </div>
                )}
                {t.role === "user" && (
                  <div className="ai-chat-actions">
                    <button
                      className="ai-chat-speak"
                      disabled={speaking}
                      onClick={() => void speak(t.content, { speaker: voice })}
                      title="朗读提问"
                    >
                      🔊 朗读
                    </button>
                    {t.correction && (
                      <button
                        className="ai-chat-speak"
                        disabled={speaking}
                        onClick={() => void speak(t.correction!.corrected, { speaker: voice })}
                        title="朗读更正后的句子"
                      >
                        ✏️ 读更正
                      </button>
                    )}
                  </div>
                )}
                {t.role === "assistant" && t.content && (
                  <div className="ai-chat-actions">
                    <button
                      className="ai-chat-speak"
                      disabled={speaking}
                      onClick={() => void speak(t.content, { speaker: voice })}
                      title="朗读全文"
                    >
                      🔊 朗读全文
                    </button>
                    <button
                      className={`ai-chat-speak${followTurnIdx === i && soe.state.recording ? " recording" : ""}`}
                      disabled={soe.state.evaluating}
                      onClick={() => void toggleFollow(i, t.content)}
                      title="跟着读一遍，老师标出发音弱的字"
                    >
                      {soe.state.recording && followTurnIdx === i
                        ? "⏹ 停止跟读"
                        : soe.state.evaluating && followTurnIdx === i
                          ? "评分中…"
                          : soe.state.score != null && followTurnIdx === i
                            ? `🎤 ${soe.state.score}分 · 再读`
                            : "🎤 跟读"}
                    </button>
                  </div>
                )}
                {t.word && t.role === "assistant" && (
                  <div className="ai-chat-word">
                    📖 {t.word}
                  </div>
                )}
              </div>
            </div>
          ))}
          {asking && (
            <div className="ai-chat-turn assistant">
              <div className="ai-chat-avatar">🤖</div>
              <div className="ai-chat-bubble ai-chat-typing">思考中…</div>
            </div>
          )}
        </div>

        {/* 右侧：选择模式开关（常驻）+ 问答定位条（仅多轮时）— 选择模式点字可批量加生词本 */}
        <div className="ai-chat-scrub">
          <button
            type="button"
            className={`ai-chat-chip ai-chat-select-toggle${selectMode ? " active" : ""}`}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            title="选择模式：点字加入生词本，可多选后一起加入"
          >
            {selectMode ? "✓ 选词中" : "✚ 选词"}
          </button>
          {userIndexes.length > 1 &&
            userIndexes.map((ui, di) => {
              const q = turns[ui].content.replace(/^🖼️?\s*\[图片\]\s*/, "").replace(/\s+/g, "")
              const label = q.slice(0, 5) || `第${di + 1}轮`
              return (
                <button
                  key={di}
                  className="ai-chat-chip"
                  onClick={() => jumpTo(ui)}
                  title={turns[ui].content}
                  aria-label={`定位到第 ${di + 1} 轮问答`}
                >
                  {label}
                </button>
              )
            })}
        </div>

        {/* 底部常驻输入行：不用回页面顶部输入 */}
      </div>

      {soe.state.error && followTurnIdx != null && <p className="ai-chat-err">{soe.state.error}</p>}
      {error && <p className="ai-chat-err">{error}</p>}

      {/* 选择模式底部操作条：批量加入生词本 */}
      {selectMode && (
        <div className="ai-chat-selectbar">
          <span className="ai-chat-select-count">已选 {selected.size} 个</span>
          <button className="btn-secondary btn-sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            清空
          </button>
          <button className="btn-secondary btn-sm" onClick={exitSelect}>
            完成
          </button>
          <button className="btn-primary btn-sm" onClick={confirmAddSelected} disabled={selected.size === 0}>
            加入生词本 ({selected.size})
          </button>
        </div>
      )}

      <div className="ai-chat-inputrow">
        <input
          className="ai-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) send()
          }}
          placeholder="输入消息，继续对话…"
          disabled={asking}
          enterKeyHint="send"
        />
        <button className="ai-chat-send" disabled={asking || !draft.trim()} onClick={send}>
          发送
        </button>
      </div>

      {wbToast && <div className="ai-chat-toast">{wbToast}</div>}
    </div>
  )
}
