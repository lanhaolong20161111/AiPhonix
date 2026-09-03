/** 小老师游戏记分 — 按模块累计「判对」得分（localStorage 持久化 + 订阅广播） */

import { useEffect, useState } from "react"

const KEY = "ai_teacher_score_by_module"

type ScoreMap = Partial<Record<string, number>>

function readAll(): ScoreMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as ScoreMap
  } catch {
    return {}
  }
}

let scores: ScoreMap = readAll()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getTeacherScore(module: string): number {
  return scores[module] ?? 0
}

export function addTeacherScore(module: string, delta: number): void {
  scores = { ...scores, [module]: (scores[module] ?? 0) + delta }
  try {
    localStorage.setItem(KEY, JSON.stringify(scores))
  } catch {
    /* 忽略 */
  }
  emit()
}

export function useTeacherScore(module: string): number {
  const [score, setScore] = useState(() => getTeacherScore(module))
  useEffect(() => {
    const fn = () => setScore(getTeacherScore(module))
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [module])
  return score
}
