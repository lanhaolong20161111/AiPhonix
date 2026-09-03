/** Auth API 客户端 — 与 server_py/routes/auth.py + users.py 契约一致 */

import { API_BASE } from "./config"
import { useAuthStore } from "../stores/authStore"

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user_id: number
}

export interface MeResponse {
  uuid: string
  username: string
  nickname: string
  role: string
  grade: string
  age: number
  learning_level: string
}

async function postJson<T>(path: string, body: unknown, token = ""): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new ApiError(resp.status, text || `HTTP ${resp.status}`)
  }
  return (await resp.json()) as T
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 解析 FastAPI 错误响应 body（如 {"detail": "用户名或密码错误"}） */
export function detailFromError(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const d = JSON.parse(e.message)
      if (typeof d?.detail === "string") return d.detail
    } catch {
      /* 非 JSON，用原文 */
    }
    return e.message
  }
  return e instanceof Error ? e.message : String(e)
}

export async function login(username: string, password: string): Promise<TokenResponse> {
  return postJson("/auth/login", { username, password, device_info: "web" })
}

export async function register(
  username: string,
  password: string,
  nickname: string,
  grade: string,
  age: number,
): Promise<TokenResponse> {
  return postJson("/auth/register", { username, password, nickname, grade, age })
}

export async function refresh(refreshToken: string): Promise<TokenResponse> {
  return postJson("/auth/refresh", { refresh_token: refreshToken })
}

export async function fetchMe(token: string): Promise<MeResponse> {
  const resp = await fetch(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new ApiError(resp.status, `HTTP ${resp.status}`)
  const data = (await resp.json()) as { user: MeResponse }
  return data.user
}

/** 从 store 取 token 做一次刷新（供 401 重试链路使用） */
export async function tryRefreshFromStore(): Promise<string | null> {
  const next = await useAuthStore.getState().refreshTokens()
  return next?.access_token ?? null
}
