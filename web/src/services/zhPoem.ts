/** AI 对话学语文 — 古诗练习：整体概括 + 逐句原文/白话 + 逐字释义服务封装 */

import { api } from "./api"

export interface PoemChar {
  c: string
  m: string
}

export interface PoemLine {
  verse: string
  meaning: string
  chars: PoemChar[]
}

export interface PoemScript {
  title: string
  summary: string
  lines: PoemLine[]
  /** true = 后端 LLM 讲解不可用时按原诗切句的兜底（无白话/字义） */
  fallback?: boolean
}

/** 生成古诗练习内容（概括 / 逐句原文+白话 / 逐字释义） */
export async function zhPoemSetup(poem: string): Promise<PoemScript> {
  return api<PoemScript>("/llm/zh-poem-setup", {
    method: "POST",
    body: { poem },
    timeoutMs: 60000,
  })
}

/** 古诗快速概括（开场等待专用）：只生成题目+整体概括，1~3s 出；逐句/逐字仍用 zhPoemSetup 后台生成 */
export async function zhPoemSummary(poem: string): Promise<{ title: string; summary: string }> {
  return api<{ title: string; summary: string }>("/llm/zh-poem-summary", {
    method: "POST",
    body: { poem },
    timeoutMs: 20000,
  })
}
