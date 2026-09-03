/** 数学闯关状态机 — 对齐 Python services/quest_graph.py（LangGraph 图 → 单步状态机）
 *
 * 图语义等价：generate_plan → ask → grade →（advance | degrade | concept_degrade | explain | back_to_original）
 * 状态持久化到 quest_sessions 表（planJson/historyJson/stepIndex/subJson/subLevel/status），
 * 替代 LangGraph checkpointer；thread_id = 会话 id（字符串）。
 */
import { eq } from "drizzle-orm"
import { chat } from "./deepseek.js"
import { db } from "../db/index.js"
import { questSessions } from "../db/schema.js"

// ── 类型 ──

export interface QuestStep {
  type: string // concept/understand/extract/relation/formula/summary
  question: string
  options: string[]
  answer_index: number
  explain: string
  concept: string
}

export interface SubQuestion {
  question: string
  options: string[]
  answer_index: number
  explain: string
}

export interface HistoryEntry {
  step: number
  answer: string
  correct: boolean
  kind?: string // "sub" 表示子问题作答
}

export interface QuestState {
  question: string
  plan: QuestStep[]
  step_index: number
  sub_level: number
  sub_json: SubQuestion | null
  history: HistoryEntry[]
  done: boolean
}

export interface PublicStep {
  index: number
  type: string
  question: string
  options: string[]
}

export interface AnswerResponse {
  correct: boolean
  done: boolean
  feedback: string
  concept_explain: string
  sub_question: PublicStep | null
  sub_back_to_original: boolean
  current_step: number
  total_steps: number
  next_step: PublicStep | null
}

export interface StartResult {
  session_id: number
  total_steps: number
  current_step: number
  steps: PublicStep[]
  question: string
}

// ── 提示词（与 Python 一致） ──

const QUEST_PLAN_PROMPT = `你是小学数学「闯关教练」。请根据题目生成一个闯关计划，引导学生一步步自己理解并解出这道题。
要求：
1) **步骤尽量多、尽量细（8~14 步）**，按顺序：概念确认（如本题有抽象概念）→ 读懂题 → 找关键数量 → 建数量关系 → 列算式 → 总结口诀。
   **宁可多拆小步，也不要跳步**；例如「读懂题」可拆成"讲的是谁的事？"和"最后问什么？"两步，
   「找关键数量」每个关键数量一步，「建关系」把方向/基准/数量关系各拆一步，「列算式」先问"先算什么"再问"算式怎么列"。
2) 每步一个问题（一句话说清），2~3 个选项（其中一个正确），选项要具体（用题目里的实体、数字、算式）。
3) 概念确认步骤：识别本题里学生可能不懂的抽象概念（如 速度/倍数/进率/工程效率/往返），问题如「你知道『几倍』是什么意思吗？」，
   选项固定为 ["知道","不确定","不知道"]，answer_index=0；
   concept 字段用一两句**大白话 + 具象生活例子**解释（如倍数→"你有2颗糖，我有你的3倍就是6颗"）。
4) 列算式步骤：选项是算式（如 "45×3"），不是最终结果；**不要在任何步骤给出最终答案**。
5) 每步 explain：学生答错时的引导话术（回指题目原文某句 / 生活类比 / 提示找哪个量），**不给答案**，30 字内。
6) 总结步骤：输出一句这类题的口诀（如「A是B的几倍→找到基准量B，A=B×倍数」），options 放口诀确认选项。

只输出 JSON（不要 markdown 包裹，无多余空格换行）：
{"steps":[{"type":"concept|understand|extract|relation|formula|summary","question":"问题","options":["..",".."],"answer_index":0,"explain":"引导","concept":"概念解释(仅concept步)"}]}
题目：`

const QUEST_SUB_PROMPT = `你是小学数学闯关教练。学生答错了闯关中的这一步。请生成一个【更简单 / 更具体】的子问题帮他建立理解。
规则：
1) 抽象概念 → 用具象生活例子提问（如 倍数→"你有2颗糖，我有你的3倍，我有几颗？"；速度→"1小时走60千米，2小时走多远？"）。
2) 综合步骤 → 拆成单一小步骤（只问其中一件事）。
3) 第 N 次降解（N 越大越简单，N>=2 时给"最简"问法，选项只剩 2 个、答案一目了然）。
4) 一个子问题，2~3 个选项，给出正确答案下标和简短讲解（30 字内）。
只输出 JSON（不要 markdown 包裹）：{"question":"...","options":["..",".."],"answer_index":0,"explain":"..."}
题目：
`

// ── JSON 提取 ──

function stripFence(s: string): string {
  let c = (s || "").trim()
  if (c.startsWith("```")) {
    c = c.replace(/^```(?:json)?\s*/i, "")
    c = c.replace(/\s*```\s*$/, "")
  }
  return c
}

function parseJsonObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(stripFence(s))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parsePlan(reply: string): QuestStep[] {
  const data = parseJsonObject(reply)
  const steps: QuestStep[] = []
  if (data && Array.isArray(data.steps)) {
    for (const s of data.steps) {
      if (!s || typeof s !== "object") continue
      const obj = s as Record<string, unknown>
      const q = String(obj.question ?? "").trim()
      const opts = Array.isArray(obj.options)
        ? obj.options.map((o) => String(o).trim()).filter((o) => o.length > 0)
        : []
      if (!q || opts.length < 2) continue
      let ai = Number(obj.answer_index ?? 0)
      if (!Number.isFinite(ai)) ai = 0
      ai = Math.max(0, Math.min(ai, opts.length - 1))
      steps.push({
        type: String(obj.type ?? "understand"),
        question: q,
        options: opts,
        answer_index: ai,
        explain: String(obj.explain ?? "").trim(),
        concept: String(obj.concept ?? "").trim(),
      })
    }
  }
  return steps
}

async function llmPlan(question: string): Promise<QuestStep[]> {
  const system = "你是一个只输出JSON的数学闯关教练。"
  const reply = await chat(system, QUEST_PLAN_PROMPT + question, 4096, "quest_plan", true)
  let steps = parsePlan(reply)
  if (!steps.length) {
    const reply2 = await chat(system, QUEST_PLAN_PROMPT + question, 8192, "quest_plan", true)
    steps = parsePlan(reply2)
  }
  return steps
}

async function llmSub(question: string, step: QuestStep, studentAnswer: string, level: number): Promise<SubQuestion> {
  const defaultSub: SubQuestion = {
    question: "再试一次：回到题目里找一找关键的那句话。",
    options: ["好的", "重新看题目"],
    answer_index: 0,
    explain: "提示：把题目再读一遍。",
  }
  try {
    const prompt =
      QUEST_SUB_PROMPT +
      question +
      `\n原步骤问题：${step.question}\n学生错选：${studentAnswer}\n本次是第 ${level} 次降解。`
    const reply = await chat("你是一个只输出JSON的数学闯关教练。", prompt, 1024, "quest_sub", true)
    const data = parseJsonObject(reply)
    if (!data) return defaultSub
    const q = String(data.question ?? "").trim()
    const opts = Array.isArray(data.options)
      ? data.options.map((o) => String(o).trim()).filter((o) => o.length > 0)
      : []
    if (q && opts.length >= 2) {
      let ai = Number(data.answer_index ?? 0)
      if (!Number.isFinite(ai)) ai = 0
      ai = Math.max(0, Math.min(ai, opts.length - 1))
      return { question: q, options: opts, answer_index: ai, explain: String(data.explain ?? "").trim() || "提示：再想想。" }
    }
  } catch (e) {
    console.warn("[quest] 子问题生成失败，用默认:", (e as Error).message)
  }
  return defaultSub
}

function praise(stepType: string): string {
  const map: Record<string, string> = {
    concept: "✓ 理解到位！",
    understand: "✓ 读懂了题意，很好！",
    extract: "✓ 数字找得准！",
    relation: "✓ 关系找对了，这是这类题最关键的一步！",
    formula: "✓ 算式列对了！",
    summary: "🎉 总结到位，闯关成功！",
  }
  return map[stepType] ?? "✓ 回答正确！"
}

function publicStep(plan: QuestStep[], idx: number): PublicStep | null {
  if (idx < 0 || idx >= plan.length) return null
  const s = plan[idx]
  return { index: idx, type: s.type, question: s.question, options: s.options }
}

// ── 状态持久化 ──

function parseSteps(json: string): QuestStep[] {
  try {
    const v = JSON.parse(json || "[]")
    if (!Array.isArray(v)) return []
    return v.map((x) => ({
      type: String(x?.type ?? "understand"),
      question: String(x?.question ?? ""),
      options: Array.isArray(x?.options) ? x.options.map(String) : [],
      answer_index: Number(x?.answer_index ?? 0),
      explain: String(x?.explain ?? ""),
      concept: String(x?.concept ?? ""),
    }))
  } catch {
    return []
  }
}

function parseHistory(json: string): HistoryEntry[] {
  try {
    const v = JSON.parse(json || "[]")
    if (!Array.isArray(v)) return []
    return v.map((h) => ({
      step: Number(h?.step ?? 0),
      answer: String(h?.answer ?? ""),
      correct: Boolean(h?.correct),
      kind: String(h?.kind ?? ""),
    }))
  } catch {
    return []
  }
}

function parseSub(json: string): SubQuestion | null {
  try {
    const v = JSON.parse(json || "null")
    if (!v || typeof v !== "object") return null
    return {
      question: String(v.question ?? ""),
      options: Array.isArray(v.options) ? v.options.map(String) : [],
      answer_index: Number(v.answer_index ?? 0),
      explain: String(v.explain ?? ""),
    }
  } catch {
    return null
  }
}

function loadState(threadId: string): QuestState | null {
  const row = db.select().from(questSessions).where(eq(questSessions.id, Number(threadId))).get()
  if (!row) return null
  return {
    question: row.question,
    plan: parseSteps(row.planJson),
    step_index: row.stepIndex,
    sub_level: row.subLevel ?? 0,
    sub_json: parseSub(row.subJson ?? ""),
    history: parseHistory(row.historyJson),
    done: row.status === "done",
  }
}

function saveState(threadId: string, st: QuestState): void {
  db.update(questSessions)
    .set({
      planJson: JSON.stringify(st.plan),
      historyJson: JSON.stringify(st.history),
      stepIndex: st.step_index,
      subJson: st.sub_json ? JSON.stringify(st.sub_json) : "",
      subLevel: st.sub_level,
      status: st.done ? "done" : "active",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(questSessions.id, Number(threadId)))
    .run()
}

// ── 对外入口 ──

export async function start(question: string, threadId: string): Promise<StartResult> {
  const plan = await llmPlan(question)
  if (!plan.length) throw new Error("闯关计划生成失败")
  const st: QuestState = { question, plan, step_index: 0, sub_level: 0, sub_json: null, history: [], done: false }
  saveState(threadId, st)
  return {
    session_id: Number(threadId),
    total_steps: plan.length,
    current_step: 0,
    steps: plan.map((_, i) => publicStep(plan, i) as PublicStep),
    question,
  }
}

export async function startRetry(threadId: string, question: string, seedPlan: QuestStep[]): Promise<StartResult> {
  const st: QuestState = { question, plan: seedPlan, step_index: 0, sub_level: 0, sub_json: null, history: [], done: false }
  saveState(threadId, st)
  return {
    session_id: Number(threadId),
    total_steps: seedPlan.length,
    current_step: 0,
    steps: seedPlan.map((_, i) => publicStep(seedPlan, i) as PublicStep),
    question,
  }
}

export async function answer(threadId: string, answerIndex: number): Promise<AnswerResponse> {
  const st = loadState(threadId)
  if (!st) throw new Error("闯关会话不存在")
  const { plan, step_index, sub_json } = st
  const step = plan[step_index]
  const opts = step?.options ?? []
  const ans = Math.max(0, Math.min(Number(answerIndex) || 0, opts.length - 1))
  const selected = opts[ans] ?? ""

  const history: HistoryEntry[] = [...st.history]
  let resp: AnswerResponse

  if (sub_json) {
    // 正在答子问题
    const subOk = ans === sub_json.answer_index
    history.push({ step: step_index, answer: selected, correct: subOk, kind: "sub" })
    st.history = history
    if (subOk) {
      st.sub_json = null
      st.sub_level = 0
      resp = {
        correct: false, done: false,
        feedback: "✓ 很好！你已经理解了这个概念。现在回到原来的问题，再试一次。",
        concept_explain: "",
        sub_question: null, sub_back_to_original: true,
        current_step: step_index, total_steps: plan.length, next_step: null,
      }
    } else if (st.sub_level >= 3) {
      const explainText = sub_json.explain || "提示：再想想，回题目里找一找。"
      st.sub_json = null
      st.sub_level = 0
      resp = {
        correct: false, done: false,
        feedback: explainText, concept_explain: explainText,
        sub_question: null, sub_back_to_original: false,
        current_step: step_index, total_steps: plan.length, next_step: null,
      }
    } else {
      st.sub_level += 1
      const sub = await llmSub(st.question, step, history[history.length - 1].answer, st.sub_level)
      st.sub_json = sub
      resp = {
        correct: false, done: false,
        feedback: "别急，先回答一个更简单的问题：",
        concept_explain: "",
        sub_question: { index: -1, type: "sub", question: sub.question, options: sub.options },
        sub_back_to_original: false,
        current_step: step_index, total_steps: plan.length, next_step: null,
      }
    }
  } else {
    // 原题作答
    const correct = ans === step.answer_index
    history.push({ step: step_index, answer: selected, correct })
    st.history = history
    if (correct) {
      const idx = step_index + 1
      const done = idx >= plan.length
      st.step_index = idx
      st.sub_json = null
      st.sub_level = 0
      st.done = done
      resp = {
        correct: true,
        done,
        feedback: done ? "🎉 闯关成功！" : praise(plan[idx - 1].type),
        concept_explain: "",
        sub_question: null, sub_back_to_original: false,
        current_step: done ? idx - 1 : Math.min(idx, plan.length - 1),
        total_steps: plan.length,
        next_step: done ? null : publicStep(plan, idx),
      }
    } else if (step.type === "concept") {
      const sub = await llmSub(st.question, step, selected, 1)
      st.sub_json = sub
      st.sub_level = 1
      resp = {
        correct: false, done: false,
        feedback: "没关系，先了解一下这个概念，再用生活里的例子确认：",
        concept_explain: step.concept || step.explain,
        sub_question: { index: -1, type: "sub", question: sub.question, options: sub.options },
        sub_back_to_original: false,
        current_step: step_index, total_steps: plan.length, next_step: null,
      }
    } else {
      const sub = await llmSub(st.question, step, selected, 1)
      st.sub_json = sub
      st.sub_level = 1
      resp = {
        correct: false, done: false,
        feedback: "别急，先回答一个更简单的问题：",
        concept_explain: "",
        sub_question: { index: -1, type: "sub", question: sub.question, options: sub.options },
        sub_back_to_original: false,
        current_step: step_index, total_steps: plan.length, next_step: null,
      }
    }
  }

  saveState(threadId, st)
  return resp
}

export function resume(threadId: string): AnswerResponse {
  const st = loadState(threadId)
  if (!st) throw new Error("闯关会话不存在")
  const { plan, step_index, done } = st
  if (done) {
    return {
      correct: true, done: true,
      feedback: "这个闯关已经完成啦，可以错题回练或开始新的。",
      concept_explain: "", sub_question: null, sub_back_to_original: false,
      current_step: step_index, total_steps: plan.length, next_step: null,
    }
  }
  return {
    correct: false, done: false,
    feedback: "↩ 上次闯到这里，继续吧！",
    concept_explain: "", sub_question: null, sub_back_to_original: false,
    current_step: step_index, total_steps: plan.length,
    next_step: publicStep(plan, step_index),
  }
}

export function rawState(threadId: string): QuestState | null {
  return loadState(threadId)
}

export function retryErrorsSeed(threadId: string): QuestStep[] {
  const st = loadState(threadId)
  if (!st) return []
  const wrongIdx = new Set<number>()
  for (const h of st.history) {
    if (!h.correct && h.kind !== "sub") wrongIdx.add(h.step)
  }
  return [...wrongIdx].sort((a, b) => a - b).filter((i) => i < st.plan.length).map((i) => st.plan[i])
}

export function replay(threadId: string, checkpointId: string): AnswerResponse {
  const st = loadState(threadId)
  if (!st) throw new Error("闯关会话不存在")
  const m = checkpointId.match(/(\d+)$/)
  let stepIdx = st.step_index
  if (m) stepIdx = Math.max(0, Math.min(Number(m[1]), st.plan.length - 1))
  st.step_index = stepIdx
  st.sub_json = null
  st.sub_level = 0
  st.done = false
  st.history = st.history.filter((h) => h.step < stepIdx)
  saveState(threadId, st)
  return {
    correct: false, done: false,
    feedback: "🔙 回到这里重做：再选一次，看看这次是不是答对了。",
    concept_explain: "", sub_question: null, sub_back_to_original: false,
    current_step: stepIdx, total_steps: st.plan.length,
    next_step: publicStep(st.plan, stepIdx),
  }
}

export interface HistoryItem {
  checkpoint_id: string
  step_index: number
  total_steps: number
  last_answer: string
  last_correct: boolean
  sub_used: boolean
  answer_count: number
}

export function history(threadId: string): HistoryItem[] {
  const st = loadState(threadId)
  if (!st) return []
  const steps = [...new Set(st.history.map((h) => h.step))].sort((a, b) => a - b)
  return steps.map((s) => {
    const entries = st.history.filter((h) => h.step === s)
    const last = entries[entries.length - 1]
    return {
      checkpoint_id: `cp_${s}`,
      step_index: s,
      total_steps: st.plan.length,
      last_answer: last.answer,
      last_correct: last.correct,
      sub_used: last.kind === "sub",
      answer_count: entries.length,
    }
  })
}

export interface ReportStep {
  index: number
  type: string
  question: string
  attempts: number
  wrong: number
  sub_used: number
  passed: boolean
}

export interface ReportResult {
  total_steps: number
  attempts: number
  passed_steps: number
  done: boolean
  summary: string
  wrong_steps: ReportStep[]
  steps: ReportStep[]
}

export function report(threadId: string): ReportResult {
  const st = loadState(threadId)
  if (!st) return { total_steps: 0, attempts: 0, passed_steps: 0, done: false, summary: "还没有作答记录。", wrong_steps: [], steps: [] }
  const perStep = new Map<number, { attempts: number; correct: number; wrong: number; sub_used: number; last_correct: boolean }>()
  for (const h of st.history) {
    const d = perStep.get(h.step) ?? { attempts: 0, correct: 0, wrong: 0, sub_used: 0, last_correct: false }
    d.attempts += 1
    if (h.kind === "sub") d.sub_used += 1
    if (h.correct) {
      d.correct += 1
      d.last_correct = true
    } else {
      d.wrong += 1
      d.last_correct = false
    }
    perStep.set(h.step, d)
  }
  const steps: ReportStep[] = st.plan.map((p, idx) => {
    const d = perStep.get(idx) ?? { attempts: 0, correct: 0, wrong: 0, sub_used: 0, last_correct: false }
    const passed = d.attempts === 0 || d.last_correct
    return {
      index: idx,
      type: p.type,
      question: p.question,
      attempts: d.attempts,
      wrong: d.wrong,
      sub_used: d.sub_used,
      passed,
    }
  })
  const wrongSteps = steps.filter((s) => !s.passed)
  const totalAttempts = steps.reduce((a, s) => a + s.attempts, 0)
  return {
    total_steps: st.plan.length,
    attempts: totalAttempts,
    passed_steps: st.plan.length - wrongSteps.length,
    done: st.done,
    summary: summaryText(steps),
    wrong_steps: wrongSteps,
    steps,
  }
}

function summaryText(steps: ReportStep[]): string {
  const passed = steps.filter((s) => s.passed).length
  const total = steps.length
  if (!steps.length) return "还没有作答记录。"
  if (passed === total) return "全部通过！每一步都能自己答对，这个题型掌握得很扎实。"
  if (total - passed <= 2) return "基本掌握！只有一小步还需要巩固，重做一遍就更稳了。"
  return `还需要多练：有 ${total - passed} 步第一次没答对，建议错题回练再走一遍。`
}
