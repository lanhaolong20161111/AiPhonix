/** 通用 API 请求封装 — JWT 注入 + 401 自动刷新重试一次 */

import { API_BASE } from "./config"
import { useAuthStore } from "../stores/authStore"
import { ApiError, tryRefreshFromStore } from "./auth"

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  /** 请求体；对象自动 JSON.stringify，FormData 原样传递 */
  body?: unknown
  /** 是否需要认证（默认 true） */
  auth?: boolean
  /** 超时毫秒（默认无）；超时抛友好错误而非底层 "signal is aborted without reason" */
  timeoutMs?: number
  /** 响应类型：json（默认，解析 JSON）/ blob（返回 Blob，用于音频等二进制）/ response（返回原始 Response，需自行读 headers/blob） */
  responseType?: "json" | "blob" | "response"
}

/** 超时统一 reason 哨兵：fetch 被 abort 后 reject 的就是这个 Error，便于精准识别 */
const TIMEOUT_REASON = "AI_PHONIX_REQUEST_TIMEOUT"

/**
 * 发起 API 请求。
 * - 自动注入 Bearer token
 * - 收到 401 时尝试 refresh 一次后重试
 * - 可选超时（AbortController）
 * - 返回解析后的 JSON
 */
// 单飞刷新锁：并发 401 时只发起一次 refresh，其余复用同一结果，
// 避免多个请求各自刷新导致 refresh_token 互相失效 / 误登出（经典惊群竞态）。
let refreshInFlight: Promise<string | null> | null = null
async function getRefreshedToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      return await tryRefreshFromStore()
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, timeoutMs, responseType = "json" } = opts

  let token = useAuthStore.getState().session?.access_token ?? ""
  const headers: Record<string, string> = {}
  if (body instanceof FormData) {
    // 不手动设 Content-Type，浏览器自动带 boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json"
  }
  if (auth && token) headers.Authorization = `Bearer ${token}`

  const controller = timeoutMs ? new AbortController() : undefined
  const timer = timeoutMs
    ? setTimeout(() => controller!.abort(new Error(TIMEOUT_REASON)), timeoutMs)
    : undefined
  const clearTimer = () => {
    if (timer) clearTimeout(timer)
  }

  const doFetch = async (t: string): Promise<Response> => {
    const h = { ...headers }
    if (auth && t) h.Authorization = `Bearer ${t}`
    try {
      return await fetch(`${API_BASE}${path}`, {
        method,
        headers: h,
        signal: controller?.signal,
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      })
    } catch (e) {
      // 超时 / 手动取消：统一转成友好提示，不再暴露底层 "signal is aborted without reason"
      if (e instanceof Error && e.message === TIMEOUT_REASON) {
        throw new Error(
          "网络请求超时，请检查网络后重试（图片较大时可先压缩，或换一张更清晰、小一点的图）",
        )
      }
      throw e
    } finally {
      clearTimer()
    }
  }

  let resp = await doFetch(token)

  // 401 → 单飞刷新一次后重试（并发 401 只刷新一次，其余复用结果）
  if (resp.status === 401 && auth) {
    const newToken = await getRefreshedToken()
    if (newToken) {
      token = newToken
      resp = await doFetch(newToken)
    } else {
      // 刷新失败 → 登出
      useAuthStore.getState().logout()
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new ApiError(resp.status, text || `HTTP ${resp.status}`)
  }

  // 204/空响应
  if (resp.status === 204) return undefined as T
  if (responseType === "blob") return (await resp.blob()) as T
  if (responseType === "response") return resp as T
  return (await resp.json()) as T
}
