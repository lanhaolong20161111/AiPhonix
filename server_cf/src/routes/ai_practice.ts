/** ai陪我练 路由 — POST/GET /api/v1/ai-practice/sessions（对齐 Python routes/ai_practice.py，需登录）
 * Cloudflare 版：db → await getDb()（D1），语义对齐 server_ts。
 */
import { Hono } from "hono"
import { and, count, desc, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { aiPracticeSessions, aiPracticeTurns } from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import * as aiSvc from "../lib/ai_practice.js"

const router = new Hono()
const CONTENT_TYPES = new Set(["char", "word", "sentence", "article"])
const MAX_CONTENT_LEN = 2000

// POST /api/v1/ai-practice/sessions
router.post("/ai-practice/sessions", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const content = String(body?.content ?? "").trim()
  if (!content) return c.json({ detail: "学习内容不能为空" }, 422)
  if (content.length > MAX_CONTENT_LEN) return c.json({ detail: `学习内容过长（最多 ${MAX_CONTENT_LEN} 字）` }, 422)
  const contentType = String(body?.content_type ?? "sentence")
  if (!CONTENT_TYPES.has(contentType)) return c.json({ detail: "content_type 必须是 char/word/sentence/article 之一" }, 422)
  const task = String(body?.task ?? "").trim().slice(0, 32)

  const inserted = await getDb()
    .insert(aiPracticeSessions)
    .values({
      userId: user!.id,
      contentType,
      content,
      task,
      planJson: "",
      status: "active",
    })
    .run()
  const sessionId = Number((inserted.meta as { last_row_id?: number | bigint }).last_row_id)

  let question = ""
  try {
    question = await aiSvc.startSession(sessionId, user!.id, contentType, content, task)
  } catch (e) {
    await getDb().delete(aiPracticeSessions).where(eq(aiPracticeSessions.id, sessionId)).run()
    return c.json({ detail: `AI 初始化失败：${(e as Error).message}` }, 502)
  }

  await getDb().insert(aiPracticeTurns)
    .values({ sessionId, role: "ai", text: question, correction: "", praise: "", audioPath: "" })
    .run()

  return c.json({ session_id: sessionId, content, content_type: contentType, task, question })
})

// POST /api/v1/ai-practice/sessions/{session_id}/chat
router.post("/ai-practice/sessions/:id/chat", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const sessionId = Number(c.req.param("id"))
  if (Number.isNaN(sessionId)) return c.json({ detail: "会话不存在" }, 404)
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "").trim()
  if (!text) return c.json({ detail: "回答不能为空" }, 422)
  if (text.length > MAX_CONTENT_LEN) return c.json({ detail: "回答过长" }, 422)

  const row = await getDb()
    .select()
    .from(aiPracticeSessions)
    .where(and(eq(aiPracticeSessions.id, sessionId), eq(aiPracticeSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "会话不存在" }, 404)
  if (row.status !== "active") return c.json({ detail: "会话已结束" }, 409)

  let result: { correction: string; praise: string; question: string; done: boolean }
  try {
    result = await aiSvc.sendAnswer(sessionId, user!.id, text)
  } catch (e) {
    return c.json({ detail: `AI 响应失败：${(e as Error).message}` }, 502)
  }

  await getDb().insert(aiPracticeTurns)
    .values({
      sessionId,
      role: "user",
      text,
      correction: result.correction,
      praise: result.praise,
      audioPath: "",
    })
    .run()
  await getDb().insert(aiPracticeTurns)
    .values({ sessionId, role: "ai", text: result.question, correction: "", praise: "", audioPath: "" })
    .run()
  if (result.done) {
    await getDb().update(aiPracticeSessions).set({ status: "done", updatedAt: new Date().toISOString() }).where(eq(aiPracticeSessions.id, sessionId)).run()
  }

  return c.json({
    correction: result.correction,
    praise: result.praise,
    question: result.question,
    done: result.done,
  })
})

// GET /api/v1/ai-practice/sessions
router.get("/ai-practice/sessions", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const rows = await getDb()
    .select()
    .from(aiPracticeSessions)
    .where(eq(aiPracticeSessions.userId, user!.id))
    .orderBy(desc(aiPracticeSessions.id))
    .limit(100)
    .all()
  const sessions = await Promise.all(
    rows.map(async (r) => {
      const cnt = await getDb().select({ n: count() }).from(aiPracticeTurns).where(eq(aiPracticeTurns.sessionId, r.id)).get()
      return {
        session_id: r.id,
        content: r.content,
        content_type: r.contentType,
        task: r.task,
        status: r.status,
        turn_count: cnt?.n ?? 0,
        created_at: r.createdAt ? new Date(r.createdAt).toISOString() : "",
      }
    })
  )
  return c.json({ sessions })
})

// GET /api/v1/ai-practice/sessions/{session_id}
router.get("/ai-practice/sessions/:id", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const sessionId = Number(c.req.param("id"))
  if (Number.isNaN(sessionId)) return c.json({ detail: "会话不存在" }, 404)
  const row = await getDb()
    .select()
    .from(aiPracticeSessions)
    .where(and(eq(aiPracticeSessions.id, sessionId), eq(aiPracticeSessions.userId, user!.id)))
    .get()
  if (!row) return c.json({ detail: "会话不存在" }, 404)

  const turns = await getDb()
    .select()
    .from(aiPracticeTurns)
    .where(eq(aiPracticeTurns.sessionId, sessionId))
    .orderBy(aiPracticeTurns.id)
    .all()
  return c.json({
    session_id: row.id,
    content: row.content,
    content_type: row.contentType,
    task: row.task,
    status: row.status,
    plan: row.planJson,
    turns: turns.map((t) => ({
      role: t.role,
      text: t.text,
      correction: t.correction,
      praise: t.praise,
      audio_path: t.audioPath,
      created_at: t.createdAt ? new Date(t.createdAt).toISOString() : "",
    })),
  })
})

export default router
