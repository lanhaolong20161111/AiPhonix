/** 每日一练·英语配置 + LLM 内容 + 图片查找 + 发音要领（服务端接口）
 * 配置按账号+日期跨设备同步（镜像 dailyZh）。
 * 发音要领 `/daily-en/phone-tips` 是**补充**接口：前端本地表先显示，这里补一句更贴词的。
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

// ── 发音要领（低分音素的阅读技巧） ──

export interface PhoneTipItem {
  phone: string
  tip: string
  category: string
}

/**
 * 拉取「针对这个词」的发音要领（LLM 补充）。
 *
 * 只做**补充**：本地表 `lib/phonicsTips.ts` 已经先显示了通用要领，
 * 这里返回的文案到了就替换/追加。所以：
 * - 调用方必须容忍**空数组**（LLM 失败/超预算/中文词被清空都会空）
 * - 不要 await 它再渲染（会拖慢评分反馈），要 fire-and-forget + setState
 * - `timeoutMs` 设短一点：孩子读完一句等了 5 秒还没有提示，这条提示就没价值了
 */
export async function fetchPhoneTips(
  word: string,
  items: Array<{ phone: string; score: number }>,
): Promise<PhoneTipItem[]> {
  if (!items.length) return []
  try {
    const r = await api<{ tips: PhoneTipItem[] }>("/daily-en/phone-tips", {
      method: "POST",
      body: { word, items },
      auth: false, // 与 /soe/records、/daily-en/word-info 一致：不是敏感数据，未登录也能看
      timeoutMs: 20_000,
      retry: false, // 补一句提示而已，不值得为它做冷启动退避（评分本身已经等过一次）
    })
    return Array.isArray(r?.tips) ? r.tips : []
  } catch {
    return [] // 静默降级：本地表文案照常显示
  }
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
