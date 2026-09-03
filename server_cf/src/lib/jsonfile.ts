/**
 * JSON 文件读写 — Cloudflare 版：基于 R2（async，替代 node:fs 同步读写）。
 * 与原 jsonfile.ts 不同的是 readJson/writeJson 变为 async，调用点需加 await。
 */

import { readText, writeText, exists } from "./storage.js"

export function dataPath(...segments: string[]): string {
  return ["data", ...segments].join("/")
}

export async function readJson<T = unknown>(path: string, fallback: T): Promise<T> {
  try {
    if (!(await exists(path))) return fallback
    const text = await readText(path)
    return text != null && text !== "" ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, JSON.stringify(data, null, 2))
}

// ── 读-改-写串行化（P1-6）────────────────────────────────────────────
// 同一 key 的 RMW 在单 isolate 内互斥，避免并发请求在 await 处交错导致更新丢失
// （典型场景：chinese_practice 句缓存 / generatedDict / word_suggestions 缓存 / aiShared）。
// 注意：跨 isolate（多 Worker 实例）仍需外部分布式锁（Durable Objects/KV）；
// 当前这些键多为配置/缓存，单 isolate 内串行已覆盖最常见的竞态，且零外部依赖。
const keyLocks = new Map<string, Promise<unknown>>()

function withKeyLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(path) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  keyLocks.set(path, next)
  // 链结束且无后续排队时移除本节点，避免 Map 无限增长
  next.finally(() => {
    if (keyLocks.get(path) === next) keyLocks.delete(path)
  }).catch(() => {})
  return next
}

/**
 * 原子读-改-写：读取当前值 → 经 mutator 计算新值 → 写回；期间同 key 串行（P1-6）。
 * 调用点凡「read 当前 → 基于当前值计算 → write 回去」的 RMW，都应改用本函数。
 */
export async function updateJson<T = unknown>(
  path: string,
  mutator: (current: T) => T | Promise<T>,
  fallback: T,
): Promise<T> {
  return withKeyLock(path, async () => {
    const current = await readJson<T>(path, fallback)
    const updated = await mutator(current)
    await writeJson(path, updated)
    return updated
  })
}
