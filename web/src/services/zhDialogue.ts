/** AI 对话学（原造句小助手，中文口语对话版）— 剧情生成 + 整句判定服务封装
 * 后端复用 /llm/en-dialogue-setup 与 /llm/en-answer-judge，通过 lang:"zh" 走中文分支。
 */

import { api } from "./api"
import type { DialogueLine, DialogueScript, AnswerJudgeResult } from "./englishTalk"

/** 生成中文口语对话剧情（主题 + 练习词 + 练习句 → 多轮台词/目标句/提示词） */
export async function zhDialogueSetup(
  topic: string,
  words: string[],
  sentences: string[],
): Promise<DialogueScript> {
  return api<DialogueScript>("/llm/en-dialogue-setup", {
    method: "POST",
    body: { lang: "zh", topic, words, sentences },
    timeoutMs: 90000,
  })
}

/** 判定孩子整句（中文）是否符合目标句语境 */
export async function zhAnswerJudge(target: string, said: string): Promise<AnswerJudgeResult> {
  return api<AnswerJudgeResult>("/llm/en-answer-judge", {
    method: "POST",
    body: { lang: "zh", target, said },
    timeoutMs: 60000,
  })
}

export type { DialogueLine, DialogueScript, AnswerJudgeResult }
