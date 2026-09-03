/** AI 数学/语文作业 API 客户端 — 对应 server_py/routes/ai_homework.py + ai_chinese.py */

import { api } from "./api"

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

export interface AnalyzeResult {
  topic: string
  sentences: AnalyzeSentence[]
  total_key_points: number
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
