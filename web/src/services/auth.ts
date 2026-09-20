/** Auth API 客户端 — 与 server_py/routes/auth.py + users.py 契约一致 */

import { API_BASE } from "./config"
import { useAuthStore } from "../stores/authStore"
import { MAX_ATTEMPTS, retryDelayMs, retryReason } from "../lib/apiRetry"
import { beginNet, endNet } from "../lib/netActivity"

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 单次尝试的超时（与 `api.ts` 同口径）。原来这里**没有超时**，连接挂住时会永久等待。 */
const ATTEMPT_TIMEOUT_MS = 60_000
const TIMEOUT_REASON = "AI_PHONIX_AUTH_TIMEOUT"

/**
 * 带**冷启动退避重试**的 POST。
 *
 * 为什么本模块不能只吃 `services/api.ts` 的重试：auth 的 login/register/refresh 走的是这个
 * 独立的 `postJson`，**完全不经过** `api()`。若不管它，云托管 `MinNum=0` 缩容到 0 之后，
 * 用户点「登录」会干等约 30s 再撞上 503（正文是一段 HTML），界面上直接报错 ——
 * 登录是进门第一道门，必须兜住。
 *
 * POST 在 **503** 下可以安全重发：503 由网关返回（"没有可用实例"），请求确定没到达应用。
 * 网络层失败 / 超时（POST 非幂等）仍然不重试，避免重复注册。
 */
async function postJson<T>(path: string, body: unknown, token = ""): Promise<T> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) }

  for (let attempt = 1; ; attempt++) {
    let resp: Response | null = null
    let netErr: unknown = null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(TIMEOUT_REASON)), ATTEMPT_TIMEOUT_MS)
    // 登记「在飞」：SW 自动 reload 会等网络静默后才刷新（见 lib/netActivity.ts）
    beginNet()
    try {
      resp = await fetch(url, { ...init, signal: controller.signal })
    } catch (e) {
      netErr =
        e instanceof Error && e.message === TIMEOUT_REASON
          ? new Error("网络请求超时，请检查网络后重试")
          : e
    } finally {
      clearTimeout(timer)
      endNet()
    }

    if (resp && resp.ok) return (await resp.json()) as T

    // 失败时也要读掉 body，否则连接不释放
    const text = resp ? await resp.text().catch(() => "") : ""
    const reason = resp
      ? retryReason("response", resp.status, "POST")
      : retryReason("networkError", 0, "POST")

    if (!reason || attempt >= MAX_ATTEMPTS) {
      if (netErr) throw netErr
      throw new ApiError(resp!.status, text || `HTTP ${resp!.status}`)
    }

    console.warn(`[auth] POST ${path} 失败（${reason}），第 ${attempt}/${MAX_ATTEMPTS - 1} 次重试…`)
    await sleep(retryDelayMs(attempt))
  }
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
