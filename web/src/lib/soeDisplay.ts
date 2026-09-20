/** SOE 评测结果的展示层纯函数 —— 缺读判定 / 分数文本 / 参考文本大小写还原
 *
 * 背景（2026-09-20 从生产 /soe/records 拉真实英文记录确认）：
 * - 腾讯智聆 SOE 对「没被检测到的单位」（漏读、没读出这个词/音素）返回
 *   `PronAccuracy = -1` + `MatchTag = 2`，而不是 0。
 *   直接渲染就会出现「-1 分」这种既难看又不准确的结果（-1 不是 0 分，是没读到）。
 * - 英文引擎返回的 `Word`/`ReferenceWord` **一律小写**（"I" → "i"、"Lily" → "lily"），
 *   逐词展示时需要按参考文本还原原始大小写。
 */

import type { SoeWord } from "./soeApi"

/** 单个单位（词 / 音素）是否「未被检测到」（漏读）。MatchTag=2 是腾讯的缺读标记。 */
export function isSoeMissing(accuracy: number | null | undefined, matchTag?: number): boolean {
  if (matchTag === 2) return true
  if (!Number.isFinite(accuracy)) return true
  return (accuracy as number) < 0
}

/** 分数文本：正常四舍五入取整；缺读显示「未读」（绝不显示 -1）。 */
export function formatSoeScore(accuracy: number | null | undefined, matchTag?: number): string {
  if (isSoeMissing(accuracy, matchTag)) return "未读"
  return String(Math.round(accuracy as number))
}

/** 分数色阶类名：good(≥80) / ok(≥60) / bad(<60) / miss(未读到) */
export function soeScoreClass(accuracy: number | null | undefined, matchTag?: number): "good" | "ok" | "bad" | "miss" {
  if (isSoeMissing(accuracy, matchTag)) return "miss"
  const n = accuracy as number
  if (n >= 80) return "good"
  if (n >= 60) return "ok"
  return "bad"
}

/** 参考文本里的单词字符（含连字符、撇号，撇号含中英文两种写法） */
const WORD_RE = /[A-Za-z0-9'\u2019\u02BC-]+/g

/** 归一化：小写 + 统一撇号 + 丢非字母数字撇号字符，用于宽松比对 */
function normWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2019\u02BC]/g, "'")
    .replace(/[^a-z0-9']/g, "")
}

/**
 * 用参考文本按顺序还原 SOE 返回词的大小写。
 *
 * 腾讯英文 SOE 的 `ReferenceWord` 全小写，逐词分数练的是「原句里的词」，
 * 展示成 `i` / `lily` 对小学生是错的（"I" 永远大写、专名首字母大写）。
 *
 * 采用**顺序双指针**匹配（不是按下标一一对应）：
 * SOE 允许漏词/少返回，指针只会单向前进，因此 "I play games" 只返回
 * ["i","games"] 时仍能正确还原成 ["I","games"]，重复词（the cat and the dog）
 * 也不会串位。匹配不上的词保持原样（不猜）。
 */
export function restoreWordCase(words: SoeWord[], refText: string): SoeWord[] {
  const tokens = refText.match(WORD_RE) ?? []
  if (!tokens.length || !words.length) return words

  const out = words.slice()
  let ti = 0
  for (let i = 0; i < out.length; i++) {
    const target = normWord(out[i]?.word ?? "")
    if (!target) continue
    let hit = -1
    for (let j = ti; j < tokens.length; j++) {
      if (normWord(tokens[j]) === target) {
        hit = j
        break
      }
    }
    if (hit < 0) continue // 参考文本里找不到同形词 → 保持原样
    const token = tokens[hit]
    if (token !== out[i].word) out[i] = { ...out[i], word: token }
    ti = hit + 1
  }
  return out
}

/**
 * 把评测结果里的词做大小写还原，返回**新的** result（不改原对象）。
 * 用于「每日英语」这类逐词展示英文句子的页面。
 */
export function withRefCase<T extends { words?: SoeWord[] }>(result: T, refText: string): T {
  const words = result.words
  if (!words?.length) return result
  return { ...result, words: restoreWordCase(words, refText) }
}
