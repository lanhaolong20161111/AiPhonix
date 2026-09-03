/** 练习复习权重（与 PY services/practice_tracker.py get_weight 逐字对齐的纯函数，供路由与单测共用） */

export interface CharRec {
  char: string
  pinyin_correct: number
  pinyin_wrong: number
  pronunciation_correct: number
  pronunciation_wrong: number
  consecutive_correct: number
  last_seen: number | null
  last_correct: boolean
  passed: boolean
}

export const emptyRec = (char: string): CharRec => ({
  char,
  pinyin_correct: 0,
  pinyin_wrong: 0,
  pronunciation_correct: 0,
  pronunciation_wrong: 0,
  consecutive_correct: 0,
  last_seen: null,
  last_correct: false,
  passed: false,
})

/**
 * 缺失记录按 1.0；1.0 + 总错误×0.3；连续正确>0 时 −min(连续×0.15, 0.7)；
 * 距上次 ≥7 天时 +min(天数×0.02, 0.5)；下限 0.1。
 */
export function computeWeight(rec: CharRec, nowSec = Date.now() / 1000): number {
  const totalWrong = rec.pinyin_wrong + rec.pronunciation_wrong
  let weight = 1.0 + totalWrong * 0.3
  if (rec.consecutive_correct > 0) {
    weight -= Math.min(rec.consecutive_correct * 0.15, 0.7)
  }
  if (rec.last_seen != null) {
    const daysSince = (nowSec - rec.last_seen) / 86400
    if (daysSince > 7) {
      weight += Math.min(daysSince * 0.02, 0.5)
    }
  }
  return Math.max(weight, 0.1)
}
