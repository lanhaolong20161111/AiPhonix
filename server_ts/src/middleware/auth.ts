/** 认证 — jose JWT（与 Python PyJWT HS256 互认）+ 当前用户解析 */
import { SignJWT, jwtVerify } from "jose"
import { createHash, randomBytes } from "node:crypto"
import { join } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { eq } from "drizzle-orm"
import { db, sqlite } from "../db/index.js"
import { users, refreshTokens } from "../db/schema.js"
import { DATA_DIR } from "../env.js"

/**
 * 解析 JWT 密钥：优先 env；否则首次启动生成随机密钥持久化到 data/jwt_secret.key。
 * 不再用源码里的公开默认值——知道源码即可伪造任意用户的 token。
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
  if (fromEnv) return fromEnv
  const keyFile = join(DATA_DIR, "jwt_secret.key")
  try {
    if (existsSync(keyFile)) {
      const saved = readFileSync(keyFile, "utf8").trim()
      if (saved) return saved
    }
    const generated = randomBytes(32).toString("hex")
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(keyFile, generated + "\n", "utf8")
    console.log("[auth] 已生成新 JWT 密钥 data/jwt_secret.key（旧 token 失效，需重新登录）")
    return generated
  } catch (e) {
    // data 目录不可写时退化为进程内随机密钥：本次运行可用，重启后需重新登录
    console.warn(`[auth] JWT 密钥文件不可用(${(e as Error).message})，使用临时随机密钥`)
    return randomBytes(32).toString("hex")
  }
}

export const JWT_SECRET = resolveJwtSecret()
export const ACCESS_TOKEN_EXPIRE_MINUTES = 120
export const REFRESH_TOKEN_EXPIRE_DAYS = 30

const secretKey = new TextEncoder().encode(JWT_SECRET)

export function createAccessToken(userId: number, username: string, role: string): Promise<string> {
  return new SignJWT({ username, role, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_EXPIRE_MINUTES}m`)
    .sign(secretKey)
}

export function createRefreshToken(): string {
  return randomBytes(32).toString("hex")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export interface JwtPayload {
  sub?: string
  username?: string
  role?: string
  type?: string
}

export async function decodeAccessToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] })
    if (payload.type !== "access") return null
    return payload as JwtPayload
  } catch {
    return null
  }
}

export interface CurrentUser {
  id: number
  uuid: string
  username: string
  nickname: string
  role: string
  grade: string
  age: number
  learning_level: string
}

import type { MiddlewareHandler } from "hono"

/**
 * 写接口鉴权门卫：挂在敏感的 POST/PUT/DELETE 路由上（GET 静态资源保持开放）。
 * 前端 services/api.ts 默认对所有请求注入 Bearer 且 401 自动刷新，登录态下无感。
 */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const user = await resolveCurrentUser(c.req.header("Authorization"))
    if (!user) return c.json({ detail: "需要登录" }, 401)
    await next()
  }
}

/**
 * 角色门卫：requireRole("admin") 仅允许管理员访问（管理端点 / 全站日志 / 清空审计）。
 */
export function requireRole(role: string): MiddlewareHandler {
  return async (c, next) => {
    const user = await resolveCurrentUser(c.req.header("Authorization"))
    if (!user) return c.json({ detail: "需要登录" }, 401)
    if (user.role !== role) return c.json({ detail: "权限不足" }, 403)
    await next()
  }
}

/** 管理员快捷门卫 */
export function requireAdmin(): MiddlewareHandler {
  return requireRole("admin")
}

/** 从 Authorization header 解析当前用户；isOptional=true 时失败返回 null */
export async function resolveCurrentUser(authorization: string | undefined, optional = false): Promise<CurrentUser | null> {
  const fail = () => {
    if (optional) return null
    const e = new Error("认证失败") as Error & { status?: number }
    e.status = 401
    throw e
  }
  if (!authorization) {
    if (optional) return null
    const e = new Error("未提供认证信息") as Error & { status?: number }
    e.status = 401
    throw e
  }
  const parts = authorization.split(/\s+/)
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    const e = new Error("认证格式错误") as Error & { status?: number }
    e.status = 401
    throw e
  }
  const payload = await decodeAccessToken(parts[1])
  if (!payload || payload.sub === undefined) return fail()
  const userId = Number(payload.sub)
  if (Number.isNaN(userId)) return fail()

  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) {
    if (optional) return null
    const e = new Error("用户不存在") as Error & { status?: number }
    e.status = 401
    throw e
  }
  return {
    id: row.id,
    uuid: row.uuid,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    grade: row.grade,
    age: row.age,
    learning_level: row.learningLevel,
  }
}

export { sqlite }
