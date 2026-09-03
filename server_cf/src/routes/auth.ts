/** Auth 路由 — Cloudflare 版：D1 async（对齐 server_ts/routes/auth.ts 语义） */
import { Hono } from "hono"
import bcrypt from "bcryptjs"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { users, refreshTokens } from "../db/schema.js"
import {
  createAccessToken,
  createRefreshToken,
  hashToken,
  REFRESH_TOKEN_EXPIRE_DAYS,
  resolveCurrentUser,
} from "../middleware/auth.js"

const router = new Hono()

const nowIso = () => new Date().toISOString()

// POST /api/v1/auth/register
router.post("/register", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ detail: "请求体为空" }, 422)
  const { username, password, nickname, grade = "", age = 0 } = body
  if (!username || !password || !nickname) return c.json({ detail: "缺少必填字段" }, 422)

  const exists = await getDb().select({ id: users.id }).from(users).where(eq(users.username, username)).get()
  if (exists) return c.json({ detail: "用户名已存在" }, 400)

  const passwordHash = bcrypt.hashSync(password, 10)
  const uuid = randomUUID()
  const role = "student"
  const now = nowIso()
  const user = await getDb()
    .insert(users)
    .values({
      uuid,
      username,
      passwordHash,
      nickname,
      role,
      grade,
      age,
      learningLevel: "",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get()

  const accessToken = await createAccessToken(user.id, username, role)
  const refreshToken = createRefreshToken()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600 * 1000).toISOString()
  await getDb()
    .insert(refreshTokens)
    .values({ userId: user.id, tokenHash: hashToken(refreshToken), deviceInfo: "", expiresAt, createdAt: now })
    .run()

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 120 * 60,
    user_id: user.id,
  })
})

// POST /api/v1/auth/login
router.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ detail: "请求体为空" }, 422)
  const { username, password, device_info = "" } = body
  if (!username || !password) return c.json({ detail: "用户名或密码错误" }, 401)

  const user = await getDb().select().from(users).where(eq(users.username, username)).get()
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return c.json({ detail: "用户名或密码错误" }, 401)
  }

  const accessToken = await createAccessToken(user.id, user.username, user.role)
  const refreshToken = createRefreshToken()
  const now = nowIso()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600 * 1000).toISOString()
  await getDb()
    .insert(refreshTokens)
    .values({ userId: user.id, tokenHash: hashToken(refreshToken), deviceInfo: device_info, expiresAt, createdAt: now })
    .run()

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 120 * 60,
    user_id: user.id,
  })
})

// POST /api/v1/auth/refresh
router.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.refresh_token) return c.json({ detail: "Refresh token 无效或已过期" }, 401)
  const tokenHash = hashToken(body.refresh_token)
  const rt = await getDb().select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).get()
  if (!rt) return c.json({ detail: "Refresh token 无效或已过期" }, 401)
  const expTime = new Date(String(rt.expiresAt)).getTime()
  if (Number.isNaN(expTime) || expTime < Date.now()) {
    return c.json({ detail: "Refresh token 无效或已过期" }, 401)
  }

  // 删除旧 refresh token
  await getDb().delete(refreshTokens).where(eq(refreshTokens.id, rt.id)).run()

  const user = await getDb().select().from(users).where(eq(users.id, rt.userId)).get()
  if (!user) return c.json({ detail: "用户不存在" }, 401)

  const accessToken = await createAccessToken(user.id, user.username, user.role)
  const newRefresh = createRefreshToken()
  const now = nowIso()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600 * 1000).toISOString()
  await getDb()
    .insert(refreshTokens)
    .values({ userId: user.id, tokenHash: hashToken(newRefresh), deviceInfo: "", expiresAt, createdAt: now })
    .run()

  return c.json({
    access_token: accessToken,
    refresh_token: newRefresh,
    token_type: "bearer",
    expires_in: 120 * 60,
    user_id: user.id,
  })
})

// POST /api/v1/auth/logout（需认证）
router.post("/logout", async (c) => {
  const auth = c.req.header("Authorization")
  const user = await resolveCurrentUser(auth)
  const body = await c.req.json().catch(() => null)
  if (body?.refresh_token) {
    const tokenHash = hashToken(body.refresh_token)
    await getDb()
      .delete(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.userId, user!.id)))
      .run()
  }
  return c.json({ message: "已注销" })
})

export default router
