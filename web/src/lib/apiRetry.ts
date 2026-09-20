/**
 * 冷启动退避重试的**纯策略** —— 零依赖，便于单测。
 *
 * 场景（2026-09-20 实测，见 skill `aiphonix-cloudbase-migrate`）：
 * CloudBase 云托管 `MinNum=0` 缩容到 0 后，网关没有实例可转发，会把请求挂住约 30s
 * 再返回 **503**；实例在后台继续拉起，实测要第 3 次才拿到 200：
 *
 *    ① 30.3s → 503   ② 10.0s → 503   ③ 30.3s → 200（累计约 71s）
 *
 * 而静态外壳走 CDN、冷启动期间照样秒回 ⇒ 不重试的话用户看到的是
 * 「页面打开飞快，一点功能就报错」。
 */

/** 一次网络尝试的结果分类 */
export type AttemptKind = "response" | "timeout" | "networkError"

/** 最多尝试几次（含首次） */
export const MAX_ATTEMPTS = 5
/** 每次重试前的等待：第 1 次重试等 800ms，以此类推；超出末位则重复末位 */
export const RETRY_DELAYS_MS = [800, 2000, 4000, 6000]
/** 单次调用的重试总预算；超了就放弃，避免用户无限等待 */
export const RETRY_BUDGET_MS = 120_000

/** 幂等方法：失败可以无副作用地重发 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"])

/** 该方法是否幂等（POST 不在内 —— 重发有重复执行风险） */
export function isIdempotent(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase())
}

/**
 * 判断这次失败是否值得重试；返回**人话原因**，`null` 表示不重试。
 *
 * 保守程度按「有没有可能在服务端产生副作用」分档：
 * - **503** = 网关「没有可用实例」，请求确定没到应用 ⇒ **任何方法**都可安全重发；
 * - **502/504** = 上游异常，可能已到达应用 ⇒ 只重发幂等方法；
 * - **网络层失败 / 超时** 同样只重发幂等方法。
 *
 * 其余状态码一律不重试：4xx 是确定性错误，500 通常是应用自身异常，
 * 重试只会让用户多等一遍同样的失败。
 */
export function retryReason(kind: AttemptKind, status: number, method: string): string | null {
  if (kind === "response") {
    if (status === 503) return "HTTP 503（后端实例未就绪）"
    if ((status === 502 || status === 504) && isIdempotent(method)) {
      return `HTTP ${status}（网关瞬时故障）`
    }
    return null
  }
  if (!isIdempotent(method)) return null
  return kind === "timeout" ? "请求超时" : "网络连接失败"
}

/** 第 `retryNo` 次重试（从 1 开始）之前的等待毫秒数 */
export function retryDelayMs(retryNo: number): number {
  const i = Math.max(0, Math.min(retryNo - 1, RETRY_DELAYS_MS.length - 1))
  return RETRY_DELAYS_MS[i]
}
