/** ai陪我练 多轮引导对话服务 — DB 持久化状态机（对齐 Python services/ai_practice.py 的 LangGraph 图）
 *
 * 图结构等价：planner（生成引导计划）→ asker（首问/下一问）→ grader（评估+下一问+是否完成）
 * 用 ai_practice_sessions.planJson + ai_practice_turns 表持久化状态（替代 LangGraph checkpointer），
 * 跨会话学生画像复用 student_profiles 表（module="ai_practice"，按 user 隔离）。
 */
import { and, eq, asc } from "drizzle-orm"
import { chat } from "./deepseek.js"
import { getDb } from "../db/index.js"
import { aiPracticeSessions, aiPracticeTurns, studentProfiles } from "../db/schema.js"

const MAX_TURNS = 20

interface PlanStep {
  goal: string
  hint: string
}

interface Profile {
  session_count: number
  last_content: string
  mistakes: string[]
  mastered: string[]
}

// ── 跨会话画像（student_profiles，module="ai_practice"） ──

async function loadProfile(userId: number): Promise<Profile> {
  try {
    const row = await getDb()
      .select()
      .from(studentProfiles)
      .where(and(eq(studentProfiles.userId, userId), eq(studentProfiles.module, "ai_practice")))
      .get()
    if (!row) return { session_count: 0, last_content: "", mistakes: [], mastered: [] }
    return {
      session_count: row.sessionCount,
      last_content: row.lastContent,
      mistakes: safeParse(row.mistakes),
      mastered: safeParse(row.mastered),
    }
  } catch {
    return { session_count: 0, last_content: "", mistakes: [], mastered: [] }
  }
}

async function saveProfile(userId: number, profile: Profile): Promise<void> {
  try {
    const existing = await getDb()
      .select()
      .from(studentProfiles)
      .where(and(eq(studentProfiles.userId, userId), eq(studentProfiles.module, "ai_practice")))
      .get()
    const now = new Date().toISOString()
    if (existing) {
      await getDb().update(studentProfiles)
        .set({
          sessionCount: profile.session_count,
          lastContent: profile.last_content.slice(0, 200),
          mistakes: JSON.stringify(profile.mistakes),
          mastered: JSON.stringify(profile.mastered),
          updatedAt: now,
        })
        .where(eq(studentProfiles.id, existing.id))
        .run()
    } else {
      await getDb().insert(studentProfiles)
        .values({
          userId,
          module: "ai_practice",
          sessionCount: profile.session_count,
          lastContent: profile.last_content.slice(0, 200),
          mistakes: JSON.stringify(profile.mistakes),
          mastered: JSON.stringify(profile.mastered),
          updatedAt: now,
        })
        .run()
    }
  } catch {
    /* 画像失败不阻断主流程 */
  }
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function profilePrompt(profile: Profile): string {
  const parts: string[] = []
  if (profile.session_count) parts.push(`- 已完成练习次数：${profile.session_count}`)
  if (profile.last_content) parts.push(`- 上次练习主题：${profile.last_content}`)
  if (profile.mistakes.length) parts.push("- 常犯错误（新会话优先巩固）：" + profile.mistakes.slice(-8).join("；"))
  if (profile.mastered.length) parts.push("- 已掌握主题（可进阶跳过）：" + profile.mastered.slice(-5).join("；"))
  return parts.join("\n")
}

// ── LLM JSON 提取 ──

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  let candidate = m ? m[1].trim() : text.trim()
  const s = candidate.indexOf("{")
  const e = candidate.lastIndexOf("}")
  if (s >= 0 && e > s) candidate = candidate.slice(s, e + 1)
  try {
    const v = JSON.parse(candidate)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ── 提示词 ──

const PLANNER_SYSTEM = `你是小学英语 AI 陪练的设计师。根据学生导入的学习主题，设计一份循序渐进的引导对话计划。

规则：
1. 计划包含 3~5 个步骤，从易到难逐步引导，覆盖认读、理解、运用
2. 每个步骤给出该步骤的学习目标（goal）和给学生的引导提示（hint，一句话）
3. 步骤要具体、可执行，围绕导入内容本身设计，不要泛泛而谈
4. 只输出 JSON，格式：{"steps": [{"goal": "目标", "hint": "引导提示"}...]}`

const GRADER_SYSTEM = `你是小学英语 AI 陪练老师。学生正在按计划学习一个主题，你需要：
1. 评估学生最新一次回答是否达成当前步骤目标（对照学生年龄给出宽松、鼓励的评判）
2. 如果回答有明显错误，用学生能懂的语言给出简短纠正（中英结合，指出正确说法）
3. 如果回答基本正确，给出具体的表扬（指出好在哪，不要泛泛夸）
4. 给出下一步引导问题（围绕计划推进；若这是最后一步且学生已完成，done=true 并给出总结语）
5. 学生答对当前问题后应推进到下一步骤，不要停留在原地；所有步骤完成即结束对话（done=true）

只输出 JSON，格式：
{"correct": true/false, "feedback": "纠正或表扬，一句话", "next_question": "下一个问题或总结语", "done": true/false}`

const TYPE_NAMES: Record<string, string> = { char: "字", word: "词", sentence: "句子", article: "文章" }

function plannerPrompt(contentType: string, content: string, task: string): string {
  const typeName = TYPE_NAMES[contentType] ?? contentType
  return (
    `学习主题类型：${typeName}\n` +
    `学习内容：${content}\n` +
    `任务类型：${task || "（未指定，按该类型常见训练方式设计）"}\n` +
    "请输出引导计划。"
  )
}

function graderPrompt(content: string, plan: PlanStep[], history: { role: string; text: string }[], lastAnswer: string): string {
  const historyLines = history.slice(-8).map((h) => `${h.role === "ai" ? "老师" : "学生"}：${h.text}`)
  const planText = plan
    .map((s, i) => `第${i + 1}步(${i === 0 ? " 当前" : ""})：${s.goal} —— ${s.hint}`)
    .join("\n")
  return (
    `学习内容：${content}\n` +
    `引导计划：\n${planText}\n` +
    `对话历史：\n${historyLines.join("\n")}\n` +
    `学生最新回答：${lastAnswer}\n` +
    "请评估并给出下一步。"
  )
}

// ── 计划生成（planner） ──

async function buildPlan(contentType: string, content: string, task: string, userId: number): Promise<PlanStep[]> {
  const profile = await loadProfile(userId)
  let prompt = plannerPrompt(contentType, content, task)
  const profileText = profilePrompt(profile)
  if (profileText) {
    prompt +=
      "\n\n学生历史画像（来自之前练习，用于个性化计划）：\n" +
      profileText +
      "\n请结合画像：跳过学生已掌握的内容，优先巩固常犯错误，难度可循序渐进提高。"
  }
  const raw = await chat(PLANNER_SYSTEM, prompt, 1024, "ai_practice_planner")
  const data = extractJson(raw)
  const steps = Array.isArray(data?.steps) ? (data.steps as PlanStep[]) : []
  const clean = steps
    .map((s) => ({ goal: String(s?.goal ?? "").trim(), hint: String(s?.hint ?? "").trim() }))
    .filter((s) => s.goal)
  if (clean.length) return clean
  return [
    { goal: "认读内容", hint: "请先读一读" },
    { goal: "理解内容", hint: "说说你理解了什么" },
    { goal: "运用内容", hint: "用学到的说一句话" },
  ]
}

// ── 状态读取 ──

async function loadState(sessionId: number): Promise<{ plan: PlanStep[]; history: { role: string; text: string }[] }> {
  const session = await getDb().select().from(aiPracticeSessions).where(eq(aiPracticeSessions.id, sessionId)).get()
  const plan: PlanStep[] = session ? safeParsePlan(session.planJson) : []
  const turns = await getDb().select().from(aiPracticeTurns).where(eq(aiPracticeTurns.sessionId, sessionId)).orderBy(asc(aiPracticeTurns.id)).all()
  const history = turns.map((t) => ({ role: t.role, text: t.text }))
  return { plan, history }
}

function safeParsePlan(s: string): PlanStep[] {
  try {
    const v = JSON.parse(s)
    if (Array.isArray(v)) return v.map((x) => ({ goal: String(x?.goal ?? ""), hint: String(x?.hint ?? "") }))
  } catch {
    /* ignore */
  }
  return []
}

// ── 对外入口 ──

/** 创建会话：生成引导计划并返回第一个问题 */
export async function startSession(sessionId: number, userId: number, contentType: string, content: string, task: string): Promise<string> {
  const plan = await buildPlan(contentType, content, task, userId)
  await getDb().update(aiPracticeSessions)
    .set({ planJson: JSON.stringify(plan), updatedAt: new Date().toISOString() })
    .where(eq(aiPracticeSessions.id, sessionId))
    .run()
  const goal = plan[0]?.goal ?? "继续练习"
  const hint = plan[0]?.hint ?? ""
  return `我们开始吧！今天学习：${content}\n第一步目标：${goal}。${hint}`
}

/** 发送学生回答：评估 + 下一问 + 是否完成 */
export async function sendAnswer(
  sessionId: number,
  userId: number,
  answer: string
): Promise<{ correction: string; praise: string; question: string; done: boolean }> {
  const session = await getDb().select().from(aiPracticeSessions).where(eq(aiPracticeSessions.id, sessionId)).get()
  if (!session) throw new Error("会话不存在")

  const { plan, history } = await loadState(sessionId)
  const fullHistory: { role: string; text: string }[] = [...history, { role: "user", text: answer }]

  const raw = await chat(GRADER_SYSTEM, graderPrompt(session.content, plan, fullHistory, answer), 1024, "ai_practice_grade")
  const data = extractJson(raw) ?? {}
  const feedback = String(data.feedback ?? "很好！").trim()
  const nextQ = String(data.next_question ?? "").trim()
  const correct = data.correct !== false
  let done = Boolean(data.done) || fullHistory.length >= MAX_TURNS * 2

  const correction = correct ? "" : feedback
  const praise = correct ? feedback : ""

  // 写回画像
  try {
    const profile = await loadProfile(userId)
    if (correction) {
      if (!profile.mistakes.includes(correction)) profile.mistakes.push(correction)
      profile.mistakes = profile.mistakes.slice(-15)
    }
    if (done) {
      if (!profile.mastered.includes(session.content)) profile.mastered.push(session.content)
      profile.mastered = profile.mastered.slice(-10)
      profile.session_count += 1
    }
    profile.last_content = session.content
    await saveProfile(userId, profile)
  } catch {
    /* 画像失败不影响主流程 */
  }

  if (done || !nextQ) {
    const closing = nextQ || "太棒了！今天的练习完成啦 🎉"
    return { correction, praise, question: closing, done: true }
  }
  return { correction, praise, question: nextQ, done: false }
}
