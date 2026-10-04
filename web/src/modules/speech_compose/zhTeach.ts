/** AI 对话学语文 — 教学剧本（覆盖式问答）+ 文本作答判定服务封装 */

import { api } from "../../services/api"

export interface TeachItem {
  q: string
  ref: string
  focus: string
  /** 分级提示：意思 → 例句 → 句型骨架 */
  hints: string[]
}

export interface TeachScript {
  title: string
  items: TeachItem[]
}

export interface TeachJudgeResult {
  ok: boolean
  praise: string
  correct: string
}

/** 生成语文教学剧本（主题 + 考查词/句 → 逐题问答，参考回答覆盖全部考查内容） */
export async function zhTeachSetup(topic: string, words: string[], sentences: string[]): Promise<TeachScript> {
  return api<TeachScript>("/llm/zh-teach-setup", {
    method: "POST",
    body: { topic, words, sentences },
    timeoutMs: 90000,
  })
}

/** 判定孩子文本回答是否算对 */
export async function zhTeachJudge(q: string, ref: string, answer: string): Promise<TeachJudgeResult> {
  return api<TeachJudgeResult>("/llm/zh-teach-judge", {
    method: "POST",
    body: { q, ref, answer },
    timeoutMs: 60000,
  })
}
