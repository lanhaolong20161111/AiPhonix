/** ai_homework 的闯关(quest)子路由 —— 按域自主路由拆出（路径/响应逐字节不变）。 */
import { Hono } from "hono"
import { db } from "../db/index.js"
import { questSessions } from "../db/schema.js"
import * as quest from "../lib/quest_graph.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { and, desc, eq } from "drizzle-orm"

const MAX_QUESTION_LEN = 2000

const router = new Hono()

router.post("/ai-homework/quest/start", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const question = String(body?.question ?? "").trim()
  if (!question) return c.json({ detail: "题目不能为空" }, 422)
  if (question.length > MAX_QUESTION_LEN) return c.json({ detail: "题目过长" }, 422)

  let sid: number
  try {
    const inserted = db.insert(questSessions).values({
      userId: user!.id, question, planJson: "", historyJson: "[]", stepIndex: 0,
      status: "active", subJson: "", subLevel: 0,
    }).run()
    sid = Number(inserted.lastInsertRowid)
  } catch (e) {
    console.warn("[quest/start] 会话保存失败:", (e as Error).message)
    return c.json({ detail: "会话保存失败，请重试" }, 500)
  }

  let result: quest.StartResult
  try {
    result = await quest.start(question, String(sid))
  } catch (e) {
    if ((e as { budget?: boolean }).budget) throw e
    console.warn("[quest/start] 计划生成失败:", (e as Error).message)
    return c.json({ detail: "闯关计划生成失败，请重试" }, 502)
  }
  return c.json({
    session_id: result.session_id, total_steps: result.total_steps, current_step: 0,
    steps: result.steps, question,
  })
})

router.post("/ai-homework/quest/step", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const sessionId = Number(body?.session_id)
  const answerIndex = Number(body?.answer_index ?? -1)
  if (!Number.isFinite(sessionId)) return c.json({ detail: "闯关会话不存在" }, 404)

  const row = db.select().from(questSessions)
    .where(and(eq(questSessions.id, sessionId), eq(questSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "闯关会话不存在" }, 404)

  let resp: quest.AnswerResponse
  try {
    resp = await quest.answer(String(sessionId), answerIndex)
  } catch (e) {
    if ((e as { budget?: boolean }).budget) throw e
    console.warn("[quest/step] 处理失败:", (e as Error).message)
    return c.json({ detail: "作答处理失败，请重试" }, 500)
  }
  // 同步 DB 进度
  try {
    db.update(questSessions)
      .set({ stepIndex: resp.current_step, status: resp.done ? "done" : "active", updatedAt: new Date().toISOString() })
      .where(eq(questSessions.id, sessionId)).run()
  } catch (e) {
    console.warn("[quest/step] 状态同步失败:", (e as Error).message)
  }
  return c.json(resp)
})

router.get("/ai-homework/quest/sessions", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const rows = db.select().from(questSessions)
    .where(and(eq(questSessions.userId, user!.id), eq(questSessions.status, "active")))
    .orderBy(desc(questSessions.id))
    .limit(5)
    .all()
  const items = rows.map((r) => ({
    session_id: r.id,
    question: r.question.slice(0, 80),
    current_step: r.stepIndex,
    total_steps: 0,
    created_at: r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }))
  return c.json({ items })
})

router.post("/ai-homework/quest/continue", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const sessionId = Number(body?.session_id)
  if (!Number.isFinite(sessionId)) return c.json({ detail: "闯关会话不存在" }, 404)
  const row = db.select().from(questSessions)
    .where(and(eq(questSessions.id, sessionId), eq(questSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "闯关会话不存在" }, 404)
  try {
    const resp = quest.resume(String(sessionId))
    return c.json(resp)
  } catch (e) {
    console.warn("[quest/continue] 续闯失败:", (e as Error).message)
    return c.json({ detail: "续闯失败，请重试" }, 500)
  }
})

router.post("/ai-homework/quest/retry-errors", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const sessionId = Number(body?.session_id)
  if (!Number.isFinite(sessionId)) return c.json({ detail: "闯关会话不存在" }, 404)
  const row = db.select().from(questSessions)
    .where(and(eq(questSessions.id, sessionId), eq(questSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "闯关会话不存在" }, 404)
  const question = row.question

  let seed: quest.QuestStep[]
  try {
    seed = quest.retryErrorsSeed(String(sessionId))
  } catch (e) {
    console.warn("[quest/retry-errors] 生成失败:", (e as Error).message)
    return c.json({ detail: "错题回练生成失败，请重试" }, 500)
  }
  if (!seed.length) return c.json({ detail: "没有答错的步骤，不需要回练" }, 422)

  let newId: number
  try {
    const inserted = db.insert(questSessions).values({
      userId: user!.id, question, planJson: "", historyJson: "[]", stepIndex: 0,
      status: "active", subJson: "", subLevel: 0,
    }).run()
    newId = Number(inserted.lastInsertRowid)
  } catch (e) {
    console.warn("[quest/retry-errors] 会话创建失败:", (e as Error).message)
    return c.json({ detail: "会话创建失败，请重试" }, 500)
  }

  let result: quest.StartResult
  try {
    result = await quest.startRetry(String(newId), question, seed)
  } catch (e) {
    if ((e as { budget?: boolean }).budget) throw e
    console.warn("[quest/retry-errors] 启动失败:", (e as Error).message)
    return c.json({ detail: "错题回练启动失败，请重试" }, 500)
  }
  return c.json({
    session_id: result.session_id, total_steps: result.total_steps, current_step: 0,
    steps: result.steps, question,
  })
})

router.get("/ai-homework/quest/report/:session_id", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const sessionId = Number(c.req.param("session_id"))
  if (!Number.isFinite(sessionId)) return c.json({ detail: "闯关会话不存在" }, 404)
  const row = db.select().from(questSessions)
    .where(and(eq(questSessions.id, sessionId), eq(questSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "闯关会话不存在" }, 404)
  try {
    const rep = quest.report(String(sessionId))
    return c.json(rep)
  } catch (e) {
    console.warn("[quest/report] 生成失败:", (e as Error).message)
    return c.json({ detail: "报告生成失败，请重试" }, 500)
  }
})

router.get("/ai-homework/quest/history/:session_id", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const sessionId = Number(c.req.param("session_id"))
  if (!Number.isFinite(sessionId)) return c.json({ detail: "闯关会话不存在" }, 404)
  const row = db.select().from(questSessions)
    .where(and(eq(questSessions.id, sessionId), eq(questSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "闯关会话不存在" }, 404)
  const items = quest.history(String(sessionId))
  return c.json({ session_id: sessionId, items })
})

router.post("/ai-homework/quest/replay", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const sessionId = Number(body?.session_id)
  const checkpointId = String(body?.checkpoint_id ?? "")
  if (!Number.isFinite(sessionId)) return c.json({ detail: "闯关会话不存在" }, 404)
  const row = db.select().from(questSessions)
    .where(and(eq(questSessions.id, sessionId), eq(questSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "闯关会话不存在" }, 404)
  if (!checkpointId) return c.json({ detail: "缺少 checkpoint_id" }, 422)
  try {
    const resp = quest.replay(String(sessionId), checkpointId)
    return c.json(resp)
  } catch (e) {
    console.warn("[quest/replay] 回溯失败:", (e as Error).message)
    return c.json({ detail: "回溯失败，请重试" }, 500)
  }
})

export default router
