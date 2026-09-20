/**
 * 网络在飞请求计数 —— 唯一目的：让「SW 自动 reload」**先等网络静默**再刷新。
 *
 * 为什么需要它（2026-09-20 实测）：`main.tsx` 里 30s 一次的 SW 更新轮询会触发
 * `reg.update()` → 新 SW 装上 → `SKIP_WAITING` → `clientsClaim` 接管 → `controllerchange`
 * → `location.reload()`。这次 reload 是**无条件的**，会掐掉当时所有在飞请求 ——
 * 实测中它把已经发出 23 秒的 `/health` 预热请求连同它的 60s 超时定时器一起销毁，
 * 于是预热白干、冷启动的 30~70s 代价被推迟到用户真正点击的那一刻。
 *
 * 注意：整页 reload 会销毁当前 JS 上下文，任何依赖「定时器」的兜底（超时、重试）都会一起消失 ——
 * 所以**只能"推迟 reload"，不能"reload 后补做"**。
 *
 * 计数方除了每次 `fetch`（`api.ts` 的 `attemptFetch`、`auth.ts` 的 `postJson`），
 * 还包括**整个预热过程**（`ensureBackendAwake` 全程持有）—— 否则一次 controllerchange
 * 就能落进预热重试之间的 800ms 空隙，把已经热好的实例丢掉。
 */

let inFlight = 0
const waiters = new Set<() => void>()

/** 一个请求开始（必须在 `finally` 里配对调用 `endNet`） */
export function beginNet(): void {
  inFlight += 1
}

/** 一个请求结束 */
export function endNet(): void {
  inFlight = Math.max(0, inFlight - 1)
  if (inFlight === 0) {
    const pending = [...waiters]
    waiters.clear()
    for (const w of pending) w()
  }
}

/** 当前在飞请求数（0 = 静默） */
export function netInFlight(): number {
  return inFlight
}

/**
 * 等到没有在飞请求为止；最多等 `timeoutMs`（默认 90s，超时同样 resolve，
 * 免得一直挂在长轮询页面上的用户永远拿不到新版本）。
 */
export function whenNetIdle(timeoutMs = 90_000): Promise<void> {
  if (inFlight === 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      waiters.delete(finish)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    waiters.add(finish)
  })
}
