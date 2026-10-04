/** AI 数学/语文作业 API 客户端 — 对应 server_py/routes/ai_homework.py + ai_chinese.py */

import { api } from "../../services/api"

export interface AnalyzeSentence {
  text: string
  is_key: boolean
  highlight: string
}

export interface AnalyzeQuestion {
  text: string
  target: string
  needs: string[]
  hint: string
}

/** 数量实体：已知量 value 为数字；题目所求的未知量 value 为 null */
export interface AnalyzeQuantity {
  name: string
  value: number | null
  unit: string
}

/** 数量关系：more=a比b多amount / less=a比b少amount / times=a是b的amount倍 /
 *  total=求和（a 是「一共」或所求总量，parts 列出所有分量名） */
export interface AnalyzeRelation {
  a: string
  b: string
  type: "more" | "less" | "times" | "total"
  amount: number
  parts: string[]
}

export interface AnalyzeResult {
  topic: string
  sentences: AnalyzeSentence[]
  total_key_points: number
  /** 数量实体（服务端 /ai-homework/analyze 返回，此前 TS 接口漏声明） */
  quantities: AnalyzeQuantity[]
  /** 数量关系（同上，此前漏声明） */
  relations: AnalyzeRelation[]
  questions: AnalyzeQuestion[]
}

export interface EvaluateResult {
  verdict: string // correct / partial / wrong
  feedback: string
  suggestion: string
}

export async function analyzeQuestion(question: string): Promise<AnalyzeResult> {
  return api<AnalyzeResult>("/ai-homework/analyze", {
    method: "POST",
    body: { question, force_refresh: false },
    timeoutMs: 40000,
  })
}

export async function evaluateAnswer(question: string, answer: string): Promise<EvaluateResult> {
  return api<EvaluateResult>("/ai-homework/evaluate", {
    method: "POST",
    body: { question, answer },
    timeoutMs: 30000,
  })
}
