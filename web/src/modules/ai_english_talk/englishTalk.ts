/** AI 英语对话陪练 — 服务封装（剧情生成 + 整句判定） */

import { api } from "../../services/api"

export interface DialogueLine {
  ai: string
  target: string
  hint_words: string[]
  /** 发音意群（跟读阶梯用，2~4 词/短语一组；可缺省，缺省前端启发式兜底） */
  chunks?: string[]
}

export interface DialogueScript {
  title: string
  lines: DialogueLine[]
}

/** 生成对话剧情（主题 + 练习词 + 练习句 → 多轮台词/目标句/提示词） */
export async function enDialogueSetup(
  topic: string,
  words: string[],
  sentences: string[],
): Promise<DialogueScript> {
  return api<DialogueScript>("/llm/en-dialogue-setup", {
    method: "POST",
    body: { topic, words, sentences },
    timeoutMs: 90000,
  })
}

export interface AnswerJudgeResult {
  ok: boolean
  praise: string
  correct: string
}

/** 判定孩子整句是否符合目标句语境 */
export async function enAnswerJudge(target: string, said: string): Promise<AnswerJudgeResult> {
  return api<AnswerJudgeResult>("/llm/en-answer-judge", {
    method: "POST",
    body: { target, said },
    timeoutMs: 60000,
  })
}
