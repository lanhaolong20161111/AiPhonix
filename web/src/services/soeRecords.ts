/** 发音评测记录查询 API 客户端 — 对应 server_py/routes/soe.py 的 /soe/records */

import { api } from "./api"
import type { SoeWord } from "../lib/soeApi"

export interface SoeRecord {
  id: number
  user_id: number
  language: string
  eval_type: string
  ref_text: string
  engine: string
  total_accuracy: number
  total_fluency: number
  total_completion: number
  suggested_score: number
  /** 来源字卡/词（评测上下文），用于历史跳转定位 */
  source?: string
  /** words 明细（含音素 phone_infos） */
  units: SoeWord[]
  created_at: string | null
}

export interface SoeRecordsQuery {
  user_id?: number
  language?: string
  eval_type?: string
  limit?: number
  offset?: number
}

/** 查询本人评测历史（按时间倒序） */
export async function fetchSoeRecords(query: SoeRecordsQuery = {}): Promise<SoeRecord[]> {
  const res = await api<{ total: number; records: SoeRecord[] }>("/soe/records", {
    method: "POST",
    body: query,
    timeoutMs: 15000,
  })
  return res.records ?? []
}

/** 删除单条评测记录 */
export async function deleteSoeRecord(recordId: number): Promise<void> {
  await api<void>(`/soe/records/${recordId}`, { method: "DELETE", timeoutMs: 10000 })
}

/** 批量删除评测记录 */
export async function batchDeleteSoeRecords(ids: number[]): Promise<number> {
  if (!ids.length) return 0
  const res = await api<{ ok: boolean; deleted: number }>("/soe/records/batch-delete", {
    method: "POST",
    body: { ids },
    timeoutMs: 20000,
  })
  return res.deleted ?? 0
}

/** 反馈记录（学习状态：correct/wrong/unsure） */
export interface FeedbackItem {
  user_id: number
  char: string
  grade: string
  semester: string
  type: string
  learning_status: string | null // "correct" | "wrong" | "unsure"
  needs_regen: boolean
  timestamp: string
}

/** 查询本人反馈记录（按时间倒序，返回全部） */
export async function fetchFeedback(userId: number): Promise<{ items: FeedbackItem[]; total: number; stats: Record<string, number> }> {
  if (!userId) return { items: [], total: 0, stats: {} }
  const res = await api<{ items: FeedbackItem[]; total: number; stats: Record<string, number> }>(
    `/char-images/feedback?user_id=${userId}&limit=100000`,
    { timeoutMs: 15000 },
  )
  return { items: res.items ?? [], total: res.total ?? 0, stats: res.stats ?? {} }
}
