/** AI 多轮对话 hook — 后端会话（断点续聊）+ 学生画像 + 图文多模态，自动保存历史
 *
 * - 后端按 session_id 持久化对话（localStorage 存 session_id，刷新可续聊）。
 * - askWithImage(text, file)：上传图片后带图调用，后端走多模态模型看图+问题。
 * - assistant 消息可附带 speak（朗读文本）与 word（查词结果），由面板渲染。
 * - 对话自动保存到 localStorage 历史（整个对话存一条，追加轮次）。
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  askWithProfile,
  askWithProfileStream,
  fetchChatSession,
  uploadPhoto,
  type AskProfileResult,
} from "../services/aiAsk"
import { getAiRole } from "../lib/aiPrefs"
import { addTeacherScore } from "../lib/teacherScore"
import {
  addHistory,
  loadHistory,
  updateHistory,
  type AiModule,
  type ChatTurn,
} from "../lib/aiHistory"

export type { ChatTurn }

const MODE_TO_MODULE: Record<string, AiModule> = {
  chinese: "chinese",
  english: "english",
  math: "math",
}

function sessionKey(module: AiModule): string {
  return `ai_chat_session_${module}`
}

export function useAiChat(mode: "chinese" | "english" | "math" | "") {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState("")
  const module = MODE_TO_MODULE[mode] ?? "chinese"
  // 后端会话 id（localStorage 持久化，断点续聊）；页面内用 ref 避免重复触发
  const [sessionId, setSessionId] = useState<string>(() => {
    try {
      return localStorage.getItem(sessionKey(module)) ?? ""
    } catch {
      return ""
    }
  })
  // 当前对话对应的本地历史条目 id（页面内持续，整段对话存一条）
  const historyIdRef = useRef<string | null>(null)

  // 进入页面时恢复历史会话消息（后端按 session_id 存了最近 30 条），UI 即刻呈现完整多轮对话
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void fetchChatSession(sessionId)
      .then((sess) => {
        if (cancelled || !sess.messages?.length) return
        setTurns((prev) => {
          if (prev.length > 0) return prev // 已有本轮对话（如快速返回），不覆盖
          const restored: ChatTurn[] = sess.messages
            .filter((m) => m.content)
            .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
          if (restored.length === 0) return prev
          // 会话 ↔ 历史条目绑定：已有该会话的条目则续写，没有则在 persist 时新建
          const entry = loadHistory(module).find((e) => e.sessionId === sessionId)
          historyIdRef.current = entry?.id ?? null
          persist(restored)
          return restored
        })
      })
      .catch(() => {
        /* 历史拉取失败不阻塞新对话 */
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  /** 保存对话到本地历史（首次创建，之后追加轮次；摘要用首问） */
  const persist = useCallback(
    (curTurns: ChatTurn[]) => {
      if (curTurns.length === 0) return
      const firstUser = curTurns.find((t) => t.role === "user")?.content ?? ""
      const summary = firstUser.slice(0, 50)
      if (!historyIdRef.current) {
        const entry = addHistory({
          module,
          text: summary,
          questions: [],
          blocks: [],
          pageBounds: null,
          thumb: "",
          turns: curTurns,
          ...(sessionId ? { sessionId } : {}),
        })
        historyIdRef.current = entry.id
      } else {
        updateHistory(module, historyIdRef.current, { text: summary, turns: curTurns, ...(sessionId ? { sessionId } : {}) })
      }
    },
    [module, sessionId],
  )

  /** 结果落盘（流式 done / 非流式返回共用）：纠错挂 user 气泡、assistant 附带工具结果、判分、persist */
  const applyResult = useCallback(
    (res: AskProfileResult) => {
      if (res.session_id) {
        setSessionId(res.session_id)
        try {
          localStorage.setItem(sessionKey(module), res.session_id)
        } catch {
          /* 忽略 */
        }
      }
      const reply = res.reply ?? ""
      const speakText = (res.tts_url ?? "").trim()
      const wordInfo = (res.word_info ?? "").trim()
      setTurns((prev) => {
        let base = prev
        // 提问纠错：挂到本轮的 user 消息上（气泡内高亮错误片段 + 下方显示更正句）
        if (res.correction) {
          base = [...prev]
          for (let i = base.length - 1; i >= 0; i--) {
            if (base[i].role === "user") {
              base[i] = { ...base[i], correction: res.correction }
              break
            }
          }
        }
        const next = [
          ...base,
        ]
        const finalTurn = {
          role: "assistant" as const,
          content: reply,
          ...(speakText ? { speak: speakText } : {}),
          ...(wordInfo ? { word: wordInfo } : {}),
          ...(res.judge != null ? { judge: res.judge } : {}),
        }
        // 流式场景最后一个已是逐字累积的 assistant 气泡 → 原地替换为干净回复；否则追加
        const lastTurn = next[next.length - 1]
        if (lastTurn && lastTurn.role === "assistant") next[next.length - 1] = finalTurn
        else next.push(finalTurn)
        if (res.judge != null && res.judge > 0) addTeacherScore(module, 1)
        persist(next)
        return next
      })
    },
    [module, persist],
  )

  const doAsk = useCallback(
    async (q: string, imageUrl: string) => {
      setAsking(true)
      setError("")
      const userContent = imageUrl ? `🖼️ [图片] ${q}` : q
      setTurns((prev) => [...prev, { role: "user", content: userContent }])

      // ── 流式优先（2026-09-10 P0）：assistant 占位气泡实时追加，首字 1~2s 出现 ──
      let streamed = false
      try {
        const res = await askWithProfileStream(
          mode || "chinese",
          q,
          sessionId,
          imageUrl,
          getAiRole(module),
          (delta) => {
            streamed = true
            setTurns((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + delta }
              } else {
                next.push({ role: "assistant", content: delta })
              }
              return next
            })
          },
        )
        if (res) {
          // done 事件：用标签解析后的干净回复替换逐字累积的原始文本
          applyResult(res)
          setAsking(false)
          return
        }
        // null 且已出过部分字：连接中断，保留已有内容并提示，不回退（回退会重复提问）
        if (streamed) {
          setError("回答中断，请重试")
          setAsking(false)
          return
        }
        // null 且未出字（服务端未升级/失败）：静默回退非流式
      } catch {
        if (streamed) {
          setError("回答中断，请重试")
          setAsking(false)
          return
        }
        /* 落入非流式兜底 */
      }

      // ── 兜底：非流式（旧行为，完整等回答） ──
      try {
        const res = await askWithProfile(mode || "chinese", q, sessionId, imageUrl, getAiRole(module))
        applyResult(res)
      } catch (e) {
        setError(e instanceof Error ? e.message : "提问失败")
        setTurns((prev) => prev.filter((t) => !(t.role === "user" && t.content === userContent)))
      } finally {
        setAsking(false)
      }
    },
    [mode, module, sessionId, applyResult],
  )

  const ask = useCallback(
    (text: string) => {
      const q = text.trim()
      if (!q || asking) return Promise.resolve()
      return doAsk(q, "")
    },
    [asking, doAsk],
  )

  const askWithImage = useCallback(
    async (text: string, file: File | Blob) => {
      if (asking) return
      const q = text.trim()
      setAsking(true)
      setError("")
      try {
        const imageUrl = await uploadPhoto(file)
        await doAsk(q || "请讲解这张图片", imageUrl)
      } catch (e) {
        setError(e instanceof Error ? e.message : "图片上传或提问失败")
        setAsking(false)
      }
    },
    [asking, doAsk],
  )

  /** 开新对话：清空当前面板，旧对话完整保留在历史里（微信式显式新线程） */
  const newChat = useCallback(() => {
    setTurns([])
    setError("")
    setAsking(false)
    setSessionId("")
    try {
      localStorage.removeItem(sessionKey(module))
    } catch {
      /* 忽略 */
    }
    historyIdRef.current = null
  }, [module])

  /** 从历史恢复某场对话为当前会话（清空面板 → 挂载 effect 拉取后端历史续聊） */
  const switchToSession = useCallback(
    (sid: string) => {
      if (!sid || sid === sessionId) return
      setTurns([])
      setError("")
      setSessionId(sid)
      try {
        localStorage.setItem(sessionKey(module), sid)
      } catch {
        /* 忽略 */
      }
      historyIdRef.current = null
    },
    [sessionId, module],
  )

  return { turns, asking, error, ask, askWithImage, newChat, switchToSession, module }
}
