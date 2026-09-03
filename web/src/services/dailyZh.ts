/** 每日一练·语文配置服务端接口（按账号+日期，跨设备同步） */

import { api } from "./api"
import { useAuthStore } from "../stores/authStore"

export interface DailyZhConfig {
  chars: string
  words: string
  sentences: string
  essayTopic: string
  updatedAt: string
}

export interface DailyZhResponse {
  /** 今日已保存的配置（无则 null） */
  config: DailyZhConfig | null
  /** 今日未设时返回的最近一次配置（供预填草稿） */
  last: DailyZhConfig | null
  date: string
}

export async function fetchDailyZh(date?: string): Promise<DailyZhResponse> {
  const q = date ? `?date=${encodeURIComponent(date)}` : ""
  return api<DailyZhResponse>(`/daily-zh${q}`, { auth: true })
}

export async function saveDailyZh(
  cfg: DailyZhConfig & { date?: string },
): Promise<{ status: string; date: string; config: DailyZhConfig }> {
  return api(`/daily-zh`, { method: "PUT", body: cfg, auth: true })
}

// ── 本地镜像（离线兜底 + 快速首屏） ──
const DAILY_ZH_KEY = "daily_chinese_config"

export function readLocalMirror(): DailyZhConfig {
  try {
    const raw = localStorage.getItem(DAILY_ZH_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<DailyZhConfig>
      return {
        chars: p.chars ?? "",
        words: p.words ?? "",
        sentences: p.sentences ?? "",
        essayTopic: p.essayTopic ?? "",
        updatedAt: p.updatedAt ?? "",
      }
    }
  } catch { /* 忽略 */ }
  return { chars: "", words: "", sentences: "", essayTopic: "", updatedAt: "" }
}

export function writeLocalMirror(cfg: DailyZhConfig): void {
  try {
    localStorage.setItem(DAILY_ZH_KEY, JSON.stringify(cfg))
  } catch { /* 忽略 */ }
}

/** 同步读本地镜像（仅兜底；练习页应优先用 loadDailyZhSynced） */
export function loadDailyZhConfig(): DailyZhConfig {
  return readLocalMirror()
}

/**
 * 异步加载今日配置（练习页统一入口）：
 * 已登录 → 服务端优先（今日 config，无则最近一次 last 预填），结果回写本地镜像；
 * 未登录 / 联网失败 → 退回本地镜像。保证换设备/重进后内容一致，不必每次重新导入。
 */
export async function loadDailyZhSynced(): Promise<DailyZhConfig> {
  const token = useAuthStore.getState().session?.access_token ?? ""
  if (!token) return readLocalMirror()
  try {
    const res = await fetchDailyZh()
    const next = res.config ?? res.last ?? readLocalMirror()
    writeLocalMirror(next)
    return next
  } catch {
    return readLocalMirror()
  }
}
