/** 每日一练·英语配置 + LLM 内容 + 图片查找（服务端接口）
 * 配置按账号+日期跨设备同步（镜像 dailyZh）。
 */

import { api } from "./api"
import { useAuthStore } from "../stores/authStore"

export interface DailyEnConfig {
  words: string
  sentences: string
  updatedAt: string
}

export interface DailyEnResponse {
  config: DailyEnConfig | null
  last: DailyEnConfig | null
  date: string
}

export interface EnWordInfo {
  word: string
  translation: string
  meaning: string
  sentences: Array<{ en: string; zh: string }>
  cached?: boolean
}

export interface EnSentenceInfo {
  sentence: string
  translation: string
  scene: string
  cached?: boolean
}

export async function fetchDailyEn(date?: string): Promise<DailyEnResponse> {
  const q = date ? `?date=${encodeURIComponent(date)}` : ""
  return api<DailyEnResponse>(`/daily-en${q}`, { auth: true })
}

export async function saveDailyEn(
  cfg: DailyEnConfig & { date?: string },
): Promise<{ status: string; date: string; config: DailyEnConfig }> {
  return api(`/daily-en`, { method: "PUT", body: cfg, auth: true })
}

export async function fetchWordInfo(word: string): Promise<EnWordInfo> {
  return api<EnWordInfo>(`/daily-en/word-info?word=${encodeURIComponent(word)}`, { auth: true })
}

export async function fetchSentenceInfo(sentence: string): Promise<EnSentenceInfo> {
  return api<EnSentenceInfo>(`/daily-en/sentence-info?sentence=${encodeURIComponent(sentence)}`, { auth: true })
}

/** 图片查找：数据库里有则返回 R2 文件名，没有则 image=null（前端不显示图片） */
export async function fetchDailyImage(text: string, kind: "word" | "sentence" = "word"): Promise<string | null> {
  const r = await api<{ image: string | null }>(
    `/daily-en/image?text=${encodeURIComponent(text)}&kind=${kind}`,
    { auth: true },
  )
  return r.image
}

export function dailyEnImageUrl(filename: string): string {
  return `/api/v1/daily-en/file/${encodeURIComponent(filename)}`
}

// ── 本地镜像（离线兜底 + 快速首屏） ──
const DAILY_EN_KEY = "daily_english_config"

export function readLocalMirror(): DailyEnConfig {
  try {
    const raw = localStorage.getItem(DAILY_EN_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<DailyEnConfig>
      return { words: p.words ?? "", sentences: p.sentences ?? "", updatedAt: p.updatedAt ?? "" }
    }
  } catch { /* 忽略 */ }
  return { words: "", sentences: "", updatedAt: "" }
}

export function writeLocalMirror(cfg: DailyEnConfig): void {
  try {
    localStorage.setItem(DAILY_EN_KEY, JSON.stringify(cfg))
  } catch { /* 忽略 */ }
}

export async function loadDailyEnSynced(): Promise<DailyEnConfig> {
  const token = useAuthStore.getState().session?.access_token ?? ""
  if (!token) return readLocalMirror()
  try {
    const res = await fetchDailyEn()
    const next = res.config ?? res.last ?? readLocalMirror()
    writeLocalMirror(next)
    return next
  } catch {
    return readLocalMirror()
  }
}
