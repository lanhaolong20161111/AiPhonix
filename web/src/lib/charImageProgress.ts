/** 看图识字浏览进度记忆 — localStorage 实现（对齐 Android CharImageProgressStore）
 *
 * - per (userId, grade, semester, type) 记住上次页码
 * - 最近一次浏览记录（跨列表，供"继续上次学习"入口）
 */

const KEY_PREFIX = "ai_phonix_charimage"

interface LastVisit {
  grade: string
  semester: string
  type: string
  index: number
}

function posKey(userId: number, grade: string, semester: string, type: string): string {
  return `${KEY_PREFIX}_pos_${userId}_${grade}|${semester}|${type}`
}

export function savePosition(
  userId: number,
  grade: string,
  semester: string,
  type: string,
  index: number,
): void {
  try {
    localStorage.setItem(posKey(userId, grade, semester, type), String(index))
  } catch {
    /* 忽略 */
  }
}

/** 返回上次页码；无记录返回 -1 */
export function getPosition(
  userId: number,
  grade: string,
  semester: string,
  type: string,
): number {
  try {
    const raw = localStorage.getItem(posKey(userId, grade, semester, type))
    if (raw === null) return -1
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 ? n : -1
  } catch {
    return -1
  }
}

export function saveLastVisit(userId: number, visit: LastVisit): void {
  try {
    localStorage.setItem(
      `${KEY_PREFIX}_last_${userId}`,
      `${visit.grade}|${visit.semester}|${visit.type}|${visit.index}`,
    )
  } catch {
    /* 忽略 */
  }
}

export function getLastVisit(userId: number): LastVisit | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}_last_${userId}`)
    if (!raw) return null
    const parts = raw.split("|")
    if (parts.length !== 4) return null
    const index = Number(parts[3])
    if (!Number.isInteger(index) || index < 0) return null
    return { grade: parts[0], semester: parts[1], type: parts[2], index }
  } catch {
    return null
  }
}
