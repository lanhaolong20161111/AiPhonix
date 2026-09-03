/** 练习记录客户端 — 类型来自共享契约层 @contracts（单一事实来源：server_ts/src/contracts） */

import { api } from "./api"

import type { CharPracticeRecord, PracticeRecordsResponse } from "@contracts"

export type { CharPracticeRecord, PracticeRecordsResponse }

/** 查询练习记录（chars 为空返回全部） */
export async function fetchPracticeRecords(chars: string[] = []): Promise<CharPracticeRecord[]> {
  const res = await api<PracticeRecordsResponse>("/practice/records", {
    method: "POST",
    body: { chars },
  })
  return res.records
}

/** 标记某字"已通过"（认字页整字全部关卡达标后调用，服务器持久化绿标） */
export async function markCharPassed(char: string): Promise<boolean> {
  if (!char) return false
  try {
    await api("/practice/pass", { method: "POST", body: { char } })
    return true
  } catch {
    return false
  }
}

/** 该字总练习次数（拼音+发音） */
export function recordTotalCount(r: CharPracticeRecord): number {
  return r.pinyin_correct + r.pinyin_wrong + r.pronunciation_correct + r.pronunciation_wrong
}
