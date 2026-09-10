/** AI Chat 路由 — /api/v1/ai-chat/ask（带画像多模态会话）+ /api/v1/llm/chat（纯文本）
 * 对齐 Python routes/ai_chat.py；会话历史存 ai_chat_sessions 表（断点续聊）
 * Cloudflare 版：db → await getDb()（D1）；web/public/chinese_wordbank.json 与 uploads/ → R2。
 */
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { and, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { studentProfiles, aiChatSessions } from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { getArk, multimodalModel } from "../lib/ark.js"
import { chat as deepseekChat } from "../lib/deepseek.js"
import { getConfig, getEnv } from "../env.js"
import { exists } from "../lib/storage.js"
import type { Bindings } from "../bindings.js"

const router = new Hono()
const MAX_MISTAKES = 15
const MAX_MASTERED = 10
const WORDBANK_KEY = "data/chinese_wordbank.json" // web/public/chinese_wordbank.json 上传到 R2 的位置

function learnerOfUser(user: { id: number }): string {
  return `u_${user.id}`
}

/** 带超时的 Promise 包装：超时抛 timedOut 标记错误（对齐 PY asyncio.wait_for TimeoutError → 504） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error("超时") as Error & { timedOut?: boolean }
      e.timedOut = true
      reject(e)
    }, ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

const MODULE_LABEL: Record<string, string> = { chinese: "语文", math: "数学", english: "英语" }
const SYSTEM_BY_MODULE: Record<string, string> = {
  chinese: "你是一位温柔、耐心的小学语文老师。请用简体中文、用小学生能懂的话回答问题，适当鼓励，可以举例。",
  math: "你是一位小学（低年级）数学老师。请用简体中文、简单易懂的方式讲解数学题，可以板书思路、一步步引导，多鼓励。",
  english: "你是一位儿童英语老师。请用简体中文为主、适当夹带英文，用 6-12 岁孩子能懂的方式讲解英语，注意发音和简单词句。",
}

interface Profile {
  session_count: number
  last_content: string
  mistakes: string[]
  mastered: string[]
}

async function loadProfile(userId: number, module: string): Promise<Profile> {
  try {
    const row = await getDb().select().from(studentProfiles).where(and(eq(studentProfiles.userId, userId), eq(studentProfiles.module, module))).get()
    if (!row) return { session_count: 0, last_content: "", mistakes: [], mastered: [] }
    let mistakes: string[] = []
    let mastered: string[] = []
    try { mistakes = JSON.parse(row.mistakes || "[]") } catch { mistakes = [] }
    try { mastered = JSON.parse(row.mastered || "[]") } catch { mastered = [] }
    return { session_count: row.sessionCount, last_content: row.lastContent, mistakes, mastered }
  } catch {
    return { session_count: 0, last_content: "", mistakes: [], mastered: [] }
  }
}

async function saveProfile(userId: number, module: string, profile: Profile): Promise<void> {
  const existing = await getDb().select().from(studentProfiles).where(and(eq(studentProfiles.userId, userId), eq(studentProfiles.module, module))).get()
  const now = new Date().toISOString()
  if (existing) {
    await getDb().update(studentProfiles)
      .set({ sessionCount: profile.session_count, lastContent: profile.last_content.slice(0, 200), mistakes: JSON.stringify(profile.mistakes), mastered: JSON.stringify(profile.mastered), updatedAt: now })
      .where(eq(studentProfiles.id, existing.id))
      .run()
  } else {
    await getDb().insert(studentProfiles)
      .values({ userId, module, sessionCount: profile.session_count, lastContent: profile.last_content.slice(0, 200), mistakes: JSON.stringify(profile.mistakes), mastered: JSON.stringify(profile.mastered), updatedAt: now })
      .run()
  }
}

function mergeProfile(profile: Profile, message: string, newMistakes: string[], newMastered: string[]): Profile {
  const mistakes = [...new Set([...profile.mistakes, ...newMistakes])].slice(-MAX_MISTAKES)
  const mastered = [...new Set([...profile.mastered, ...newMastered])].slice(-MAX_MASTERED)
  return { session_count: profile.session_count + 1, last_content: message.slice(0, 200), mistakes, mastered }
}

function profilePrompt(profile: Profile): string {
  if (!profile || profile.session_count === 0) return ""
  const lines: string[] = []
  if (profile.mistakes.length) lines.push(`易错：${profile.mistakes.slice(0, 8).join("、")}`)
  if (profile.mastered.length) lines.push(`掌握：${profile.mastered.slice(0, 6).join("、")}`)
  if (lines.length) lines.push(`共对话 ${profile.session_count} 轮`)
  return lines.join("；")
}

function parseProfileTags(reply: string): [string, string[], string[]] {
  const m = reply.match(/【画像】\s*([\s\S]*)$/)
  if (!m) return [reply, [], []]
  const tag = m[1]
  const clean = reply.slice(0, m.index).trim()
  const mistakes: string[] = []
  const mastered: string[] = []
  const errMatch = tag.match(/易错[:：]\s*(.+)/)
  const masMatch = tag.match(/掌握[:：]\s*(.+)/)
  if (errMatch) mistakes.push(...errMatch[1].split(/[；;、，,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4))
  if (masMatch) mastered.push(...masMatch[1].split(/[；;、，,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4))
  return [clean, mistakes, mastered]
}

function parseToolTags(
  reply: string,
): [string, string, string, { corrected: string; wrongs: string[] } | null, number | null] {
  let speak = ""
  let word = ""
  let correction: { corrected: string; wrongs: string[] } | null = null
  let judge: number | null = null
  for (const m of reply.matchAll(/【朗读】\s*([^\n【】]+)/g)) speak = (speak + " " + m[1].trim()).trim()
  for (const m of reply.matchAll(/【查词】\s*([^\n【】]+)/g)) word = m[1].trim()
  const cm = reply.match(/【改错】\s*([^\n【】]+)/)
  if (cm) {
    const [corrected, wrongsRaw] = cm[1].split(/｜|\|/)
    const wrongs = (wrongsRaw ?? "")
      .split(/[、，,;；]/)
      .map((w) => w.trim())
      .filter(Boolean)
    if (corrected.trim()) correction = { corrected: corrected.trim(), wrongs }
  }
  const jm = reply.match(/【判对】\s*([01])/)
  if (jm) judge = Number(jm[1])
  // 【出题】只删标签保留题目文本（整行删会连题目一起删空）；其余标签整行删除
  const clean = reply
    .replace(/【(朗读|查词|改错|判对|画像)】[^\n]*\n?/g, "")
    .replace(/【出题】/g, "")
    .trim()
  return [clean, speak, word, correction, judge]
}

async function lookupWord(q: string): Promise<string> {
  try {
    const raw = await exists(WORDBANK_KEY) ? await (await import("../lib/storage.js")).readText(WORDBANK_KEY) : ""
    if (!raw) return ""
    const data = JSON.parse(raw)
    const hits: string[] = []
    for (const w of data.words ?? []) {
      if (q && String(w.text ?? "").includes(q)) {
        hits.push(w.pinyin ? `${w.text}（${w.pinyin}）` : String(w.text))
        if (hits.length >= 5) break
      }
    }
    return hits.join("、")
  } catch {
    return ""
  }
}

function autoSpeakText(reply: string, wordQ: string): string {
  if (wordQ && wordQ.trim()) return wordQ.trim()
  if (!reply) return ""
  const first = reply.split(/[。！？?\n]+/)[0].trim()
  const cleaned = first.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^[\s#\-·0-9.]+/, "")
  if (!cleaned) return ""
  return cleaned.slice(0, 40)
}

async function resolveUploadKey(imageUrl: string): Promise<string> {
  const name = imageUrl.split("/").pop() || ""
  if (!name || name.includes("..") || name.includes("/")) return ""
  const key = `data/uploads/${name}`
  return (await exists(key)) ? key : ""
}

// ── 会话读写（ai_chat_sessions 表，对齐 PY _load_chat_messages/_touch_chat_session） ──

interface ChatMsg {
  role: string
  content: string
}

async function loadChatMessages(sessionId: string, userId: number): Promise<{ module: string | null; messages: ChatMsg[] }> {
  try {
    const row = await getDb()
      .select()
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.sessionId, sessionId), eq(aiChatSessions.userId, userId)))
      .get()
    if (!row) return { module: null, messages: [] }
    let msgs: ChatMsg[] = []
    try {
      msgs = JSON.parse(row.messages || "[]")
    } catch {
      msgs = []
    }
    return { module: row.module || null, messages: msgs }
  } catch (e) {
    console.warn(`[ai-chat] 读会话失败 session=${sessionId}: ${(e as Error).message}`)
    return { module: null, messages: [] }
  }
}

async function touchChatSession(sessionId: string, userId: number, module: string, messages: ChatMsg[]): Promise<void> {
  try {
    const now = new Date().toISOString()
    const payload = JSON.stringify(messages.slice(-30)) // 最多保留 30 条（对齐 PY）
    const existing = await getDb()
      .select()
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.sessionId, sessionId), eq(aiChatSessions.userId, userId)))
      .get()
    if (existing) {
      await getDb().update(aiChatSessions)
        .set({ module, messages: payload, updatedAt: now })
        .where(eq(aiChatSessions.id, existing.id))
        .run()
    } else {
      await getDb().insert(aiChatSessions)
        .values({ sessionId, userId, module, messages: payload, createdAt: now, updatedAt: now })
        .run()
    }
  } catch (e) {
    console.warn(`[ai-chat] 保存会话失败 session=${sessionId}: ${(e as Error).message}`)
  }
}

// GET /api/v1/ai-chat/session?session_id=xxx（恢复历史会话消息，仅本人会话）
router.get("/ai-chat/session", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  if (!user) return c.json({ detail: "未登录" }, 401)
  const sessionId = c.req.query("session_id") ?? ""
  if (!sessionId) return c.json({ messages: [], session_id: "", module: "" })
  const sess = await loadChatMessages(sessionId, user.id)
  return c.json({ session_id: sessionId, module: sess.module ?? "", messages: sess.messages })
})

// ── ask 上下文准备（/ai-chat/ask 与 /ai-chat/ask-stream 共用）──
// 2026-09-10 P1 顺手项：会话与画像两次 D1 读改并行（原串行两个往返）。
interface AskContext {
  module: string
  roleKey: string
  message: string
  imageUrl: string
  sessionId: string
  historyMessages: ChatMsg[]
  profile: Profile
  system: string
  userPrompt: string
  imagePath: string
}

type AuthUser = NonNullable<Awaited<ReturnType<typeof resolveCurrentUser>>>

async function prepareAsk(user: AuthUser, body: Record<string, unknown> | null): Promise<AskContext> {
  // 角色扮演：body.role 指定则替换默认老师人设（会话/画像仍归所属模块）
  const roleKey = String(body?.role ?? "").trim()
  const message = String(body?.message ?? "").trim()
  const imageUrl = String(body?.image_url ?? "").trim()
  let module = String(body?.module ?? "chinese")
  if (!MODULE_LABEL[module]) module = "chinese"
  const sessionId = String(body?.session_id ?? "").trim() || `ai_${user.id}_${module}_${crypto.randomUUID().slice(0, 10)}`

  // 0) 会话 + 画像并行读（断点续聊）；无会话历史则用请求携带的 history 兜底
  const [sess, profile] = await Promise.all([
    loadChatMessages(sessionId, user.id),
    loadProfile(user.id, module),
  ])
  if (sess.module) module = sess.module
  const historyMessages: ChatMsg[] = sess.messages.length
    ? sess.messages
    : (Array.isArray(body?.history)
        ? (body.history as unknown[])
            .map((h: unknown) => ({
              role: String((h as { role?: string })?.role ?? ""),
              content: String((h as { content?: string })?.content ?? ""),
            }))
            .filter((h: ChatMsg) => h.content)
        : [])

  const historyLines = historyMessages.slice(-10).map((m) => `${m.role === "user" ? "学生" : "老师"}：${m.content}`)
  const context = historyLines.join("\n")
  const userPrompt = context ? `${context}\n学生：${message}` : `学生：${message}`

  const profileText = profilePrompt(profile)

  let system = SYSTEM_BY_MODULE[module] || SYSTEM_BY_MODULE.chinese
  if (roleKey && ROLE_PROMPTS[roleKey]) system = ROLE_PROMPTS[roleKey]
  if (profileText) system += `\n\n【该学生的历史画像】\n${profileText}\n请结合画像个性化解答：巩固易错点、可适当进阶、避免重复已掌握的低阶问题。`
  if (imageUrl) system += "\n\n【本轮附带一张图片】请先看图，再结合学生的问题/对话给出讲解。"
  system += `\n\n【输出约定】在回答末尾若能识别学生的薄弱点或掌握点，另起一行按格式输出（没有可不输出）：\n【画像】易错：知识点1；掌握：知识点2\n若回答涉及需要发音/朗读的内容，请在回答中单独输出一行：【朗读】要朗读的文本（10 字以内最佳）。\n若学生问到某个词语的意思/拼音/用法，可在回答末尾输出一行：【查词】词语。\n若学生的提问存在语法、用词或语义错误，必须在回答的第一行单独输出一行：【改错】修改后的完整句子｜原句错误片段1、错误片段2（竖线左边是保持学生原意、只修正错误的完整句子；右边是原句中的错误片段，多个用、分隔）。示例：学生说"我去学校的时候看见一个很好看的画画"，你回答的第一行必须是【改错】我去学校的时候看见一朵很好看的花｜一个很好看的画画。没有错误则不要输出该行。`

  const imagePath = imageUrl ? await resolveUploadKey(imageUrl) : ""
  return { module, roleKey, message, imageUrl, sessionId, historyMessages, profile, system, userPrompt, imagePath }
}

// POST /api/v1/ai-chat/ask
router.post("/ai-chat/ask", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  if (!user) return c.json({ detail: "未登录" }, 401)
  const body = await c.req.json().catch(() => null)
  const ctx = await prepareAsk(user, body)
  const { module, message, sessionId, historyMessages, profile, system, userPrompt } = ctx
  let raw = ""
  if (ctx.imagePath) {
    // 多模态 90s 超时 → 504（对齐 PY asyncio.wait_for timeout=90）
    try {
      raw = await withTimeout(
        // 2026-09-10：识图回退路径同样关思维链（豆包 seed 系列默认开 thinking，白耗数秒）
        getArk().chat({ prompt: userPrompt, system_prompt: system, image_paths: [ctx.imagePath], max_tokens: 1024, model_override: multimodalModel(), disable_thinking: true }),
        90000
      )
    } catch (e) {
      const err = e as Error & { timedOut?: boolean }
      if (err.timedOut) return c.json({ detail: "AI 响应超时，请稍后重试" }, 504)
      console.warn(`ai_chat 多模态调用失败（module=${module}）: ${err.message}`)
      return c.json({ detail: `AI 调用失败：${err.message}` }, 502)
    }
  } else {
    try {
      // 2026-09-10 P0：补 disableThinking=true — 豆包默认带思维链，对话白耗 5~15s（补多音字任务已验证此坑）
      raw = await deepseekChat(system, userPrompt, 1024, `ai_chat_${module}`, true)
    } catch (e) {
      const anyE = e as { budget?: boolean }
      if (anyE.budget) throw e
      raw = ""
    }
  }

  // 解析
  const [cleanReply, newMistakes, newMastered] = parseProfileTags(raw)
  const [replyText, speakTextRaw, wordQ, correction, judge] = parseToolTags(cleanReply)
  const reply = replyText.trim() || "（AI 暂时没有回应，请再试一次）"
  const wordInfo = wordQ ? await lookupWord(wordQ) : ""
  const speakText = speakTextRaw.trim() || autoSpeakText(reply, wordQ)

  // 回写画像 + 会话
  const updated = mergeProfile(profile, message || "（看图）", newMistakes, newMastered)
  await saveProfile(user!.id, module, updated)
  const newMessages = [...historyMessages, { role: "user", content: message || "（图片）" }, { role: "assistant", content: reply }]
  await touchChatSession(sessionId, user!.id, module, newMessages)

  // 小豆判卷兜底：弱模型常跳过【判对】步骤。若上一条 AI 消息是出题（小豆模式每条都是题），
  // 用一次独立的 1/0 判卷调用（简单二分任务，弱模型也能稳定完成）。
  let finalJudge = judge
  if (finalJudge == null && ctx.roleKey === "student") {
    const lastAssistant = [...historyMessages].reverse().find((m) => m.role === "assistant")
    const prevQ = lastAssistant?.content.trim()
    if (prevQ && message) {
      try {
        const jr = await deepseekChat(
          "你是判卷器。对比学生的原句和老师的纠正：如果纠正指出了原句中的用词/语法错误并给出了正确的替换说法，输出 1；否则输出 0。只输出一个数字。",
          `学生小豆的原句：${prevQ}\n老师的纠正：${message}\n纠正是否正确？`,
          200,
          "ai_chat_judge",
          true
        )
        const digit = jr.match(/[10]/)?.[0]
        finalJudge = digit === "1" ? 1 : 0
        console.warn(`[ai-chat] 判卷: prevQ=${prevQ} msg=${message} judge=${finalJudge} raw=${jr.slice(0, 60)}`)
      } catch (e) {
        console.warn(`[ai-chat] 判卷调用失败: ${(e as Error).message}`)
        finalJudge = null
      }
    }
  }

  return c.json({
    reply,
    session_id: sessionId,
    tts_url: speakText,
    word_info: wordInfo,
    ...(correction ? { correction } : {}),
    ...(finalJudge != null ? { judge: finalJudge } : {}),
  })
})

// POST /api/v1/ai-chat/ask-stream — SSE 流式问答（2026-09-10 P0）
// 事件格式（data: JSON）：meta{session_id} → delta{text}… → done{reply,tts_url,word_info,correction,judge,session_id} / error{detail}
// 仅走免费 Ark（豆包 turbo + 关思维链）流式；Ark 失败发 error，前端回退 /ai-chat/ask（完整兜底链）。
router.post("/ai-chat/ask-stream", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  if (!user) return c.json({ detail: "未登录" }, 401)
  const body = await c.req.json().catch(() => null)
  const ctx = await prepareAsk(user, body)
  return streamSSE(c, async (stream) => {
    const send = (payload: Record<string, unknown>) =>
      stream.writeSSE({ data: JSON.stringify(payload) })
    let full = ""
    try {
      await send({ type: "meta", session_id: ctx.sessionId })
      const iter = getArk().chatStream({
        prompt: ctx.userPrompt,
        system_prompt: ctx.system,
        ...(ctx.imagePath ? { image_paths: [ctx.imagePath] } : {}),
        max_tokens: 1024,
        disable_thinking: true,
        timeout_ms: 90_000,
      })
      for await (const delta of iter) {
        if (!delta) continue
        full += delta
        await send({ type: "delta", text: delta })
      }
    } catch (e) {
      console.warn(`[ai-chat] ask-stream 流式失败(module=${ctx.module}, 已出${full.length}字): ${(e as Error).message}`)
      if (!full) {
        // 一个字都没出：让前端回退非流式完整链路
        await send({ type: "error", detail: `流式调用失败：${(e as Error).message}` })
        return
      }
      // 已有部分输出：按已有内容正常收尾，不让前端白等
    }

    // 结束：与非流式一致的标签解析/判卷/回写
    const [cleanReply, newMistakes, newMastered] = parseProfileTags(full)
    const [replyText, speakTextRaw, wordQ, correction, judge] = parseToolTags(cleanReply)
    const reply = replyText.trim() || full.trim() || "（AI 暂时没有回应，请再试一次）"
    const wordInfo = wordQ ? await lookupWord(wordQ) : ""
    const speakText = speakTextRaw.trim() || autoSpeakText(reply, wordQ)

    let finalJudge = judge
    if (finalJudge == null && ctx.roleKey === "student") {
      const lastAssistant = [...ctx.historyMessages].reverse().find((m) => m.role === "assistant")
      const prevQ = lastAssistant?.content.trim()
      if (prevQ && ctx.message) {
        try {
          const jr = await deepseekChat(
            "你是判卷器。对比学生的原句和老师的纠正：如果纠正指出了原句中的用词/语法错误并给出了正确的替换说法，输出 1；否则输出 0。只输出一个数字。",
            `学生小豆的原句：${prevQ}\n老师的纠正：${ctx.message}\n纠正是否正确？`,
            200,
            "ai_chat_judge",
            true
          )
          const digit = jr.match(/[10]/)?.[0]
          finalJudge = digit === "1" ? 1 : 0
        } catch (e) {
          console.warn(`[ai-chat] ask-stream 判卷失败: ${(e as Error).message}`)
          finalJudge = null
        }
      }
    }

    await send({
      type: "done",
      reply,
      session_id: ctx.sessionId,
      tts_url: speakText,
      word_info: wordInfo,
      ...(correction ? { correction } : {}),
      ...(finalJudge != null ? { judge: finalJudge } : {}),
    })

    // 回写画像 + 会话：挪到响应后（waitUntil），不阻塞 done 事件下发
    try {
      const updated = mergeProfile(ctx.profile, ctx.message || "（看图）", newMistakes, newMastered)
      const newMessages = [...ctx.historyMessages, { role: "user", content: ctx.message || "（图片）" }, { role: "assistant", content: reply }]
      c.executionCtx.waitUntil(
        Promise.all([
          saveProfile(user.id, ctx.module, updated),
          touchChatSession(ctx.sessionId, user.id, ctx.module, newMessages),
        ]).catch((e) => console.warn(`[ai-chat] ask-stream 回写失败: ${(e as Error).message}`))
      )
    } catch (e) {
      console.warn(`[ai-chat] ask-stream waitUntil 挂载失败: ${(e as Error).message}`)
    }
  })
})

// POST /api/v1/llm/chat（旧路径纯文本问答，无画像；对齐 PY routes/llm.py：无鉴权、prompt 自定义、quiz 4096）
router.post("/llm/chat", async (c) => {
  const body = await c.req.json().catch(() => null)
  const message = String(body?.message ?? "").trim()
  const mode = String(body?.mode ?? "")
  if (!message) return c.json({ detail: "消息不能为空" }, 422)

  const cfg = getConfig()
  const customPrompt = String(body?.prompt ?? "").trim()
  let system = customPrompt
  if (!system) {
    const promptMap: Record<string, string> = {
      chinese: cfg.llm_prompts.chinese_teaching,
      quiz: cfg.llm_prompts.quiz_generate,
      english: cfg.llm_prompts.english_teaching,
    }
    system = promptMap[mode] ?? cfg.llm_prompts.default
  }
  const maxTokens = mode === "quiz" ? 4096 : 2048

  try {
    const reply = await deepseekChat(system, message, maxTokens, mode || "chat")
    return c.json({ reply })
  } catch (e) {
    const anyE = e as { budget?: boolean }
    if (anyE.budget) throw e // 预算守卫 → 全局 429
    return c.json({ detail: `LLM 调用失败: ${(e as Error).message}` }, 500)
  }
})

export default router

// ── AI 角色扮演（body.role 选择；提示词覆盖默认老师人设） ──
const ROLE_PROMPTS: Record<string, string> = {
  libai: "你是唐代大诗人李白本人，穿越到现代与小学生在微信上聊天。说话豪迈洒脱、爱用比喻，聊到月亮酒和远方就兴致勃勃。用小学生能听懂的中文，回答不超过 4 句话，可以随口吟一句自己的诗。回答末尾若发现学生的薄弱点或掌握点，另起一行输出：【画像】易错：知识点1；掌握：知识点2。若回答涉及需要朗读的内容，单独输出一行：【朗读】要朗读的文本（10 字以内最佳）。",
  wukong: "你是齐天大圣孙悟空，护送唐僧取经路过现代，和一个小学生聊天。说话活泼跳脱，自称俺老孙，爱用'俺'、'嘿'，动不动提金箍棒和筋斗云，豪爽讲义气。用小学生能听懂的中文，回答不超过 4 句话。回答末尾若发现学生的薄弱点或掌握点，另起一行输出：【画像】易错：知识点1；掌握：知识点2。若回答涉及需要朗读的内容，单独输出一行：【朗读】要朗读的文本（10 字以内最佳）。",
  foreigner: "你是来自美国的 friendly 外教 Mike，正在和小学生练习英语口语。你会说简单的中文，但鼓励孩子用英语回答，孩子用英语说时温柔纠正（先夸再说正确说法）。回答不超过 4 句话，中英混排。回答末尾若发现学生的薄弱点或掌握点，另起一行输出：【画像】易错：知识点1；掌握：知识点2。若回答涉及需要朗读的内容，单独输出一行：【朗读】要朗读的文本（10 字以内最佳）。",
  student: "你在玩『小老师』游戏：你是学得慢的一年级学生小豆，对方是你的老师。每轮严格两步。第1步（出题）：以【出题】开头，写一句含一个错误的话（一年级的错别字或量词错误，如'小猴子跑着树枝荡秋千'）。第2步（判卷）：老师回应后，如果老师指出了错误并给出正确说法，先承认错误（如'哦！原来要用抓着！'），第二行输出【判对】1，然后以【出题】开头出下一题；如果老师没说对，输出【判对】0，说还是不懂并再给一个提示。老师没改错时绝不说'答对啦'。示例：老师'不对，是抓着树枝' → 你回'哦！原来要用抓着！我记住啦。【判对】1【出题】小兔子跑着胡萝卜真可爱。'。现在立刻执行第1步。除【出题】【判对】外不超过 2 句话。",
  teacher_gao: "你是严谨又温柔的高老师，一位有 20 年教龄的小学语文特级教师。你说话条理清晰，善于用提问引导孩子思考而不是直接给答案，表扬具体、批评委婉。用小学生能听懂的中文，回答不超过 5 句话。回答末尾若发现学生的薄弱点或掌握点，另起一行输出：【画像】易错：知识点1；掌握：知识点2。若回答涉及需要朗读的内容，单独输出一行：【朗读】要朗读的文本（10 字以内最佳）。",
}