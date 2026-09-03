/** AI 问答全局 store — 提问即自动持久化（localStorage），按会话 scope 组织，输入页/结果页统一可见
 *
 * key 格式：`${scope}:${relKey}`，relKey = block-N / q-N / text。
 * scope 标识一次识别/输入会话（结果页用 sessionId，输入页用 input-时间戳）。
 */

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { QaItem } from "../lib/aiHistory"

interface QaState {
  qa: Record<string, QaItem[]>
  /** 设置某 key 的完整问答列表 */
  setQaList: (key: string, list: QaItem[]) => void
  /** 追加一条问答（并发安全，基于 store 当前值） */
  appendQa: (key: string, item: QaItem) => void
  /** 删除某 scope 的所有问答 */
  removeScope: (scope: string) => void
}

export const useQaStore = create<QaState>()(
  persist(
    (set) => ({
      qa: {},
      setQaList: (key, list) => set((s) => ({ qa: { ...s.qa, [key]: list } })),
      appendQa: (key, item) =>
        set((s) => ({ qa: { ...s.qa, [key]: [...(s.qa[key] ?? []), item] } })),
      removeScope: (scope) =>
        set((s) => {
          const next: Record<string, QaItem[]> = {}
          for (const [k, v] of Object.entries(s.qa)) {
            if (!k.startsWith(`${scope}:`)) next[k] = v
          }
          return { qa: next }
        }),
    }),
    { name: "ai_phonix_web_qa" },
  ),
)

/** 取某 scope 的所有问答（key → 列表），key 已去掉 scope 前缀 */
export function scopeQa(scope: string, qa: Record<string, QaItem[]>): Record<string, QaItem[]> {
  const prefix = `${scope}:`
  const out: Record<string, QaItem[]> = {}
  for (const [k, v] of Object.entries(qa)) {
    if (k.startsWith(prefix) && v.length > 0) out[k.slice(prefix.length)] = v
  }
  return out
}

/** 从完整 key 恢复相对 key（block-N / q-N / text） */
export function relQaLabel(key: string): string {
  if (key.startsWith("block-")) {
    const i = Number(key.slice("block-".length))
    return `第 ${i + 1} 段`
  }
  if (key.startsWith("q-")) {
    const i = Number(key.slice(2))
    return `第 ${i + 1} 题`
  }
  return "整段文本"
}
