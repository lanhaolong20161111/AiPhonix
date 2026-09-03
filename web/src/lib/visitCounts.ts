/** 首页入口访问频次统计
 * - 登录态：计数持久化到服务端、按账户隔离（跨设备 / 跨浏览器保留，跟随账户）
 * - 未登录态：回退本地 localStorage（保证功能仍可用）
 */

import { useEffect, useState } from "react"
import { api } from "../services/api"
import { useAuthStore } from "../stores/authStore"

export type VisitCounts = Record<string, number>

const LS_KEY = "aiphonix:visit:counts"

function readLocal(): VisitCounts {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed ? (parsed as VisitCounts) : {}
  } catch {
    return {}
  }
}

function writeLocal(counts: VisitCounts): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(counts))
  } catch {
    /* 隐私模式等忽略 */
  }
}

/** 按访问次数降序排序；次数相同的条目保持原顺序（依赖稳定排序） */
export function sortByVisits<T extends { to: string }>(entries: readonly T[], counts: VisitCounts): T[] {
  return [...entries].sort((a, b) => (counts[b.to] ?? 0) - (counts[a.to] ?? 0))
}

/** 记录一次入口点击：登录态写入服务端，同时本地兜底（匿名态 / 乐观更新） */
export function recordVisit(route: string): void {
  const token = useAuthStore.getState().session?.access_token
  if (token) {
    void api("/visits", { method: "POST", auth: true, body: { route } }).catch(() => {})
  }
  const next = { ...readLocal(), [route]: (readLocal()[route] ?? 0) + 1 }
  writeLocal(next)
}

/**
 * 读取当前用户的入口点击计数：
 * - 登录态优先取服务端（跨设备 / 跨浏览器保留，跟随账户）
 * - 未登录或拉取失败回退本地 localStorage
 */
export function useVisitCounts(): { counts: VisitCounts } {
  const [counts, setCounts] = useState<VisitCounts>(() =>
    useAuthStore.getState().session?.access_token ? {} : readLocal(),
  )

  useEffect(() => {
    const token = useAuthStore.getState().session?.access_token
    if (!token) {
      setCounts(readLocal())
      return
    }
    let cancelled = false
    api<{ counts: VisitCounts }>("/visits", { method: "GET", auth: true })
      .then((res) => {
        if (!cancelled) setCounts(res.counts ?? {})
      })
      .catch(() => {
        if (!cancelled) setCounts(readLocal())
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { counts }
}
