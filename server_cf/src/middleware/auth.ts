/** 认证 — Cloudflare 版：jose JWT + env 注入密钥 + D1 查用户
 *
 * 与 server_ts 差异：
 * - JWT 密钥只从 env.JWT_SECRET 读取（wrangler secret put JWT_SECRET）。
 *   未配置时退化为本次 isolate 随机密钥（重启/多实例 token 互不兼容），部署时必须配置。
 * - 密钥 lazy 初始化：Workers 在模块加载期拿不到 env，只能在首个请求到达时解析。
 * - 用户查询走 D1（async）。
 */
import { SignJWT, jwtVerify } from "jose"
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { users } from "../db/schema.js"
import { getEnv } from "../env.js"

export const ACCESS_TOKEN_EXPIRE_MINUTES = 120
export const REFRESH_TOKEN_EXPIRE_DAYS = 30

/** 32 字节随机 hex（Web Crypto，替代 node:crypto randomBytes） */
function randomHex32(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
}

let _secretKey: Uint8Array | null = null
let _secretSource = "" // 当前密钥来源（"" = 未配置 JWT_SECRET 的随机回退）

function secretKey(): Uint8Array {
  const fromEnv = getEnv().JWT_SECRET?.trim()
  if (fromEnv) {
    // 有配置：仅当 JWT_SECRET 实际变化时重建——secret 轮换后立即生效（getEnv 每请求已更新）
    if (!_secretKey || _secretSource !== fromEnv) {
      _secretKey = new TextEncoder().encode(fromEnv)
      _secretSource = fromEnv
    }
    return _secretKey
  }
  // 未配置：一次性随机密钥，isolate 生命周期内稳定（若按 60s 轮换会导致全部 token 每 60s 失效）
  if (!_secretKey) {
    console.warn("[auth] 未配置 JWT_SECRET（wrangler secret put JWT_SECRET），本次使用临时随机密钥，重启后需重新登录")
    _secretKey = new TextEncoder().encode(randomHex32())
  }
  return _secretKey
}

export function createAccessToken(userId: number, username: string, role: string): Promise<string> {
  return new SignJWT({ username, role, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_EXPIRE_MINUTES}m`)
    .sign(secretKey())
}

export function createRefreshToken(): string {
  return randomHex32()
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
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] })
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
 */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const user = await resolveCurrentUser(c.req.header("Authorization"))
    if (!user) return c.json({ detail: "需要登录" }, 401)
    await next()
  }
}

/**
 * 角色门卫：requireRole("admin") 仅允许管理员访问。
 * 用于管理端点（全站 LLM 日志 / 运维日志 / 清空审计）——普通（儿童）账号不可读全站 prompt 或清日志。
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

  const row = await getDb().select().from(users).where(eq(users.id, userId)).get()
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
