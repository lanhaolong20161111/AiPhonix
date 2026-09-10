/** 记忆快乐本 — 认字/练词今日字词 → LLM 趣味文段（按账号+日期持久化）
 * 端点：/joy/list（全部按日期倒序）/joy?date=（某天）/joy/generate（生成或取缓存）/joy/:id（删除）
 */

import { api } from "./api"

export interface JoyEntry {
  id: number
  date: string
  scope: string
  chars: string
  words: string
  title: string
  text: string
  createdAt: string
}

/** 取该账号全部文段（记忆快乐本按日期分组用） */
export async function fetchJoyList(): Promise<JoyEntry[]> {
  const res = await api<{ entries: JoyEntry[] }>("/joy/list", { method: "GET", auth: true })
  return res.entries ?? []
}

/** 生成（或取缓存）某天的文段：chars/words 为逗号/顿号分隔原文；force=true 强制重新生成。
 * scope 区分缓存条目：'all'=混合（默认）| 'char'=认字页只传今日字 | 'word'=练词页只传今日词。 */
export async function generateJoy(
  chars: string,
  words: string,
  force = false,
  date?: string,
  scope: "all" | "char" | "word" = "all",
): Promise<{ entry: JoyEntry | null; cached: boolean }> {
  return api("/joy/generate", {
    method: "POST",
    body: { date, chars, words, force, scope },
    auth: true,
    timeoutMs: 60000,
  })
}

/** 删除某条文段 */
export async function deleteJoy(id: number): Promise<boolean> {
  try {
    await api(`/joy/${id}`, { method: "DELETE", auth: true })
    return true
  } catch {
    return false
  }
}

/** 按目标词（词优先、再单字）对文段做高亮切段。
 * 返回段落数组：[{ text, hit }]——hit=true 表示该段是今日字/词，前端渲染加高亮。 */
export function highlightJoyText(text: string, chars: string, words: string): { text: string; hit: boolean }[] {
  const t = text ?? ""
  if (!t) return []
  const targets = [
    ...(words ?? "").split(/[,，、;；\s]+/).map((s) => s.trim()).filter((s) => s.length > 0),
    ...(chars ?? "").split(/[,，、;；\s]+/).map((s) => s.trim()).filter((s) => s.length === 1),
  ]
  if (targets.length === 0) return [{ text: t, hit: false }]

  const segs: { text: string; hit: boolean }[] = []
  let rest = t
  while (rest) {
    // 在剩余文本中找最早出现的任一目标词
    let bestIdx = -1
    let bestTarget = ""
    for (const target of targets) {
      const idx = rest.indexOf(target)
      if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
        bestIdx = idx
        bestTarget = target
      }
    }
    if (bestIdx < 0 || !bestTarget) {
      segs.push({ text: rest, hit: false })
      break
    }
    if (bestIdx > 0) segs.push({ text: rest.slice(0, bestIdx), hit: false })
    segs.push({ text: bestTarget, hit: true })
    rest = rest.slice(bestIdx + bestTarget.length)
  }
  return segs
}
