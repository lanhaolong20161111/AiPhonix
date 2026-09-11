/** AI 对话学语文 — 文章练习：按句生成「简洁缩写」（背诵框架提示）服务封装 */

import { api } from "./api"
import type { ArticleLine } from "../lib/articleSplit"

/** 句子原文 + 该句的极简背诵提示（≤12 字，空串表示未生成） */
export type ReciteItem = ArticleLine

/**
 * 为整篇文章的每一句生成简洁缩写（背诵框架）。
 * 句子由前端本地切好后传入（本地切句可立即开始练习，缩写后台补上）。
 */
export async function articleReciteSetup(sentences: string[]): Promise<ReciteItem[]> {
  if (!sentences.length) return []
  const r = await api<{ items: ReciteItem[] }>("/llm/article-recite", {
    method: "POST",
    body: { sentences },
    timeoutMs: 60000,
  })
  return r?.items ?? []
}
