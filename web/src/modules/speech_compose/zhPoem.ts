/** AI 对话学语文 — 古诗练习：整体概括 + 逐句原文/白话 + 逐字释义服务封装 */

import { api } from "../../services/api"

export interface PoemChar {
  c: string
  m: string
  /** 该字在本句中的读音（字母+声调数字，如 xie2）；缺省则不做注音锁读 */
  p?: string
}

export interface PoemLine {
  verse: string
  meaning: string
  chars: PoemChar[]
  /** 该句逐字拼音（空格分隔，与 verse 汉字一一对应）——用于锁定多音字读音 */
  pinyin?: string
}

export interface PoemScript {
  title: string
  summary: string
  lines: PoemLine[]
  /** 朝代（出自古诗库搜索） */
  dynasty?: string
  /** 作者（出自古诗库搜索） */
  author?: string
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

/** 古诗快速概括（开场等待专用）：题目+整体概括+全诗逐字拼音，1~3s 出；逐句/逐字仍用 zhPoemSetup 后台生成 */
export async function zhPoemSummary(poem: string): Promise<{ title: string; summary: string; pinyin?: string }> {
  return api<{ title: string; summary: string; pinyin?: string }>("/llm/zh-poem-summary", {
    method: "POST",
    body: { poem },
    timeoutMs: 20000,
  })
}

export interface PoemSearchHit {
  title: string
  dynasty: string
  author: string
  text: string
}

/** 按标题搜索小学必背古诗库（服务器内置数据，不走 LLM）；q 为空返回空 */
export async function zhPoemSearch(q: string): Promise<PoemSearchHit[]> {
  const r = await api<{ poems: PoemSearchHit[] }>(`/llm/zh-poem-search?q=${encodeURIComponent(q.trim())}`, {
    timeoutMs: 10000,
  })
  return r?.poems ?? []
}
