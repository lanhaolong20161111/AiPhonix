/** 通用 API 请求封装 — JWT 注入 + 401 单飞刷新 + 冷启动退避重试 */

import { API_BASE } from "./config"
import { useAuthStore } from "../stores/authStore"
import { ApiError, tryRefreshFromStore } from "./auth"
import {
  MAX_ATTEMPTS,
  RETRY_BUDGET_MS,
  retryDelayMs,
  retryReason,
  type AttemptKind,
} from "../lib/apiRetry"
import { beginNet, endNet } from "../lib/netActivity"

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  /** 请求体；对象自动 JSON.stringify，FormData 原样传递 */
  body?: unknown
  /** 是否需要认证（默认 true） */
  auth?: boolean
  /** **单次尝试**的超时毫秒（默认无）；超时抛友好错误而非底层 "signal is aborted without reason" */
  timeoutMs?: number
  /** 响应类型：json（默认，解析 JSON）/ blob（返回 Blob，用于音频等二进制）/ response（返回原始 Response） */
  responseType?: "json" | "blob" | "response"
  /** 是否允许冷启动退避重试（默认 true）。确实不能重复提交的写操作可关掉。 */
  retry?: boolean
  /** `path` 是否已是完整路径（不再拼 `API_BASE`）。用于 `/health` 这类不在 `/api/v1` 下的端点。 */
  rawPath?: boolean
  /** 每次进入重试前的回调，便于上层展示「服务正在启动…」提示 */
  onRetry?: (info: RetryInfo) => void
}

/** 一次重试的上下文（供 UI 提示用） */
export interface RetryInfo {
  /** 这是第几次重试（从 1 开始） */
  attempt: number
  /** 最多重试几次 */
  maxAttempts: number
  /** 本次重试前至少会等多久（毫秒） */
  delayMs: number
  /** 失败原因（人话文案） */
  reason: string
}

/** 超时统一 reason 哨兵：fetch 被 abort 后 reject 的就是这个 Error，便于精准识别 */
const TIMEOUT_REASON = "AI_PHONIX_REQUEST_TIMEOUT"

/** 一次网络尝试的结果 */
type Attempt =
  | { kind: "response"; resp: Response }
  | { kind: "timeout"; err: Error }
  | { kind: "networkError"; err: unknown }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 发起一次网络尝试；自己管 AbortController 与超时计时器（每次重试都必须新建） */
async function attemptFetch(url: string, init: RequestInit, timeoutMs?: number): Promise<Attempt> {
  const controller = timeoutMs ? new AbortController() : undefined
  const timer = timeoutMs
    ? setTimeout(() => controller!.abort(new Error(TIMEOUT_REASON)), timeoutMs)
    : undefined
  // 登记「在飞」：SW 自动 reload 会等到网络静默才刷新（否则会把在飞请求掐死，
  // 实测中它销毁过一个已发出 23s 的 /health 预热请求 —— 见 lib/netActivity.ts）。
  beginNet()
  try {
    const resp = await fetch(url, { ...init, signal: controller?.signal })
    return { kind: "response", resp }
  } catch (e) {
    if (e instanceof Error && e.message === TIMEOUT_REASON) {
      return {
        kind: "timeout",
        // 超时 / 手动取消：统一转成友好提示，不再暴露底层 "signal is aborted without reason"
        err: new Error(
          "网络请求超时，请检查网络后重试（图片较大时可先压缩，或换一张更清晰、小一点的图）",
        ),
      }
    }
    return { kind: "networkError", err: e }
  } finally {
    if (timer) clearTimeout(timer)
    endNet()
  }
}

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

/**
 * 唤醒后端实例（幂等、无副作用）。**每个页面生命周期只做一次**，并发调用共享同一个 Promise。
 *
 * 为什么需要它：冷启动时网关会先挂住约 30s 再返回 503。若业务请求自带的小超时先触发
 * （本项目最小的只有 5s，见 `services/aichinese.ts`、`hooks/useBlockSpeaking.ts`），
 * 请求就被自己的 `timeoutMs` abort 掉了 —— 而 POST 出于「可能重复执行」不自动重试，
 * 于是这类请求**永远救不回来**。用一个 `GET /health` 把拉起时间提前吃掉即可。
 *
 * 失败不抛错（清空缓存允许下轮再试），交给业务请求自己的退避重试兜底。
 */
let awakePromise: Promise<void> | null = null
export function ensureBackendAwake(): Promise<void> {
  if (!awakePromise) {
    // 预热**全程**都算「不静默」：SW 自动 reload 会等它结束才刷新。
    // 否则一次 controllerchange 就能落进重试间隙（800ms）把已经热好的实例丢掉 ——
    // 2026-09-20 实测正是这样把 23s 的预热成果作废的。
    beginNet()
    awakePromise = api<void>("/health", {
      auth: false,
      // ⚠️ 必须是 `/health`（server_cf 的 app.get("/health")，**不在** /api/v1 下）。
      // 打 `/api/v1/health` 会落进带认证的路由拿 401，闸门 Promise 随即被清空、退化成"每次都重打一遍"。
      rawPath: true,
      timeoutMs: 60_000,
      responseType: "response",
    })
      .then(() => undefined)
      .catch(() => {
        awakePromise = null
      })
      .finally(() => {
        endNet()
      })
  }
  return awakePromise
}

/**
 * 发起 API 请求。
 * - 自动注入 Bearer token
 * - 收到 401 时尝试 refresh 一次后重试
 * - 单次尝试可设超时（AbortController）
 * - 冷启动（503 / 网关故障 / 网络失败）自动退避重试，策略见 `lib/apiRetry.ts`
 * - 返回解析后的 JSON
 */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    auth = true,
    timeoutMs,
    responseType = "json",
    retry = true,
    rawPath = false,
    onRetry,
  } = opts

  let token = useAuthStore.getState().session?.access_token ?? ""

  const headers: Record<string, string> = {}
  if (body instanceof FormData) {
    // 不手动设 Content-Type，浏览器自动带 boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json"
  }

  const initFor = (t: string): RequestInit => {
    const h = { ...headers }
    if (auth && t) h.Authorization = `Bearer ${t}`
    return {
      method,
      headers: h,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    }
  }

  const url = rawPath ? path : `${API_BASE}${path}`
  const canGate = retry && path !== "/health"

  // 与业务请求**并发**发起预热（不阻塞它）：热态下只是后台多一个廉价 GET，
  // 冷态下下面的重试逻辑会 await 它，把这 30~70s 认领掉。
  if (canGate) void ensureBackendAwake()

  const deadline = Date.now() + (retry ? RETRY_BUDGET_MS : 0)

  for (let attempt = 1; ; attempt++) {
    let a = await attemptFetch(url, initFor(token), timeoutMs)

    // 401 → 单飞刷新一次后原地重试（**不计入**冷启动重试次数）
    if (a.kind === "response" && a.resp.status === 401 && auth) {
      const newToken = await getRefreshedToken()
      if (newToken) {
        token = newToken
        a = await attemptFetch(url, initFor(newToken), timeoutMs)
      } else {
        // 刷新失败 → 登出
        useAuthStore.getState().logout()
      }
    }

    // —— 成功路径 ——
    if (a.kind === "response" && a.resp.ok) {
      const resp = a.resp
      if (resp.status === 204) return undefined as T
      if (responseType === "blob") return (await resp.blob()) as T
      if (responseType === "response") return resp as T
      return (await resp.json()) as T
    }

    // —— 失败：整理错误，判断要不要重试 ——
    let lastError: unknown
    let kind: AttemptKind
    let status = 0
    if (a.kind === "response") {
      // 必须读掉 body，否则连接不释放
      const text = await a.resp.text().catch(() => "")
      lastError = new ApiError(a.resp.status, text || `HTTP ${a.resp.status}`)
      kind = "response"
      status = a.resp.status
    } else {
      lastError = a.err
      kind = a.kind
    }

    const reason = retry ? retryReason(kind, status, method) : null
    if (!reason) throw lastError
    if (attempt >= MAX_ATTEMPTS) throw lastError

    const delayMs = retryDelayMs(attempt)
    if (Date.now() + delayMs >= deadline) throw lastError

    onRetry?.({ attempt, maxAttempts: MAX_ATTEMPTS - 1, delayMs, reason })
    console.warn(
      `[api] ${method} ${path} 失败（${reason}），` +
        `第 ${attempt}/${MAX_ATTEMPTS - 1} 次重试将在 ${delayMs}ms 后进行`,
    )

    // 冷启动真正要等的是「实例拉起」，不是固定退避 ⇒ 与预热闸门一起等（取较慢的那个）。
    // 热态下闸门早已 resolve，等价于纯退避。
    const gate = canGate ? ensureBackendAwake() : Promise.resolve()
    await Promise.all([gate, sleep(delayMs)])
  }
}
