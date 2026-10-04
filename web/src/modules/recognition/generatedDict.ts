/** 生成字词内容客户端 — 调用 /api/v1/generated-dict
 *
 * 每日一练加入了字库/词库没有的字词时，按需让后端调大模型生成
 * （字：拼音+2组词+1句；词：1句），结果由后端缓存（同字词只生成一次）。
 */
import { api } from "../../services/api"

export interface GeneratedEntry {
  type: "char" | "word"
  text: string
  /** 组词（仅 char 有，最多 2 个） */
  words: string[]
  /** 句子 */
  sentence: string
  /** 拼音（仅 char 有，含声调数字） */
  pinyin?: string
  /** llm=现场生成 cache=命中缓存 error=生成失败 */
  source: "llm" | "cache" | "error"
}

export interface GeneratedItem {
  type: "char" | "word"
  text: string
}

/** 批量确保字词已生成（缺失则调大模型生成并缓存），返回生成结果（失败返回空数组） */
export async function ensureGenerated(items: GeneratedItem[]): Promise<GeneratedEntry[]> {
  if (!items.length) return []
  try {
    const res = await api<{ items: GeneratedEntry[] }>("/generated-dict/ensure", {
      method: "POST",
      body: { items },
      auth: false,
      timeoutMs: 30000,
    })
    return res.items ?? []
  } catch {
    return []
  }
}
