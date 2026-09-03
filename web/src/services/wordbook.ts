/** 生词本 API 客户端 — /wordbook（SRS 间隔重复） */

import { api } from "./api"

export interface WordbookItem {
  id: number
  user_id: number
  text: string
  pinyin: string
  source: string
  times: number
  correct: number
  box: number
  next_review: string
  created_at: string
  updated_at: string
}

export async function addWordbook(text: string, pinyin = "", source = "chat"): Promise<boolean> {
  try {
    await api("/wordbook/add", { method: "POST", body: { text, pinyin, source }, timeoutMs: 8000 })
    return true
  } catch {
    return false
  }
}

/** 批量加入生词本（整块收词）：一次请求多个字，比逐字循环快得多 */
export async function addWordbookMany(texts: string[], source = "recog_batch"): Promise<boolean> {
  if (!texts.length) return true
  try {
    await api("/wordbook/add-many", { method: "POST", body: { texts, source }, timeoutMs: 10000 })
    return true
  } catch {
    return false
  }
}

export async function listWordbook(): Promise<WordbookItem[]> {
  const res = await api<{ total: number; items: WordbookItem[] }>("/wordbook/list", { timeoutMs: 10000 })
  return res.items ?? []
}

export async function reviewQueue(): Promise<WordbookItem[]> {
  const res = await api<{ total: number; items: WordbookItem[] }>("/wordbook/review", { timeoutMs: 10000 })
  return res.items ?? []
}

export async function rateWordbook(id: number, correct: boolean): Promise<void> {
  await api("/wordbook/rate", { method: "POST", body: { id, correct }, timeoutMs: 8000 })
}

export async function removeWordbook(id: number): Promise<void> {
  await api(`/wordbook/${id}`, { method: "DELETE", timeoutMs: 8000 })
}
