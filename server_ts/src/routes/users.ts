/** User 路由 — /api/v1/users/me（对齐 Python routes/users.py） */
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../db/index.js"
import { users } from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()

const toUserInfo = (u: { uuid: string; username: string; nickname: string; role: string; grade: string; age: number; learning_level: string }) => ({
  uuid: u.uuid,
  username: u.username,
  nickname: u.nickname,
  role: u.role,
  grade: u.grade,
  age: u.age,
  learning_level: u.learning_level,
})

// GET /api/v1/users/me
router.get("/me", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  return c.json({ user: toUserInfo(user!) })
})

// PUT /api/v1/users/me
router.put("/me", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => ({}))
  const updates: Partial<Record<string, string | number>> = {}
  if (body.nickname !== undefined && body.nickname !== null) updates.nickname = String(body.nickname)
  if (body.grade !== undefined && body.grade !== null) updates.grade = String(body.grade)
  if (body.age !== undefined && body.age !== null) updates.age = Number(body.age)
  updates.updatedAt = new Date().toISOString()
  if (Object.keys(updates).length > 1) {
    db.update(users).set(updates).where(eq(users.id, user!.id)).run()
  }
  const fresh = db.select().from(users).where(eq(users.id, user!.id)).get()
  if (!fresh) return c.json({ detail: "用户不存在" }, 404)
  return c.json({
    user: {
      uuid: fresh.uuid,
      username: fresh.username,
      nickname: fresh.nickname,
      role: fresh.role,
      grade: fresh.grade,
      age: fresh.age,
      learning_level: fresh.learningLevel,
    },
  })
})

export default router
