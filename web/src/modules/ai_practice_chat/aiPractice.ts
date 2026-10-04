/** AI 陪我练 API 客户端 — 对应 server_py/routes/ai_practice.py */

import { api } from "../../services/api"

export interface AiSessionSummary {
  session_id: number
  content: string
  content_type: string
  task: string
  status: string
  turn_count: number
  created_at: string
}

export interface AiTurn {
  role: string // ai / user
  text: string
  correction: string
  praise: string
  audio_path: string
}

export interface AiSessionDetail {
  session_id: number
  content: string
  content_type: string
  task: string
  status: string
  plan?: unknown
  turns: AiTurn[]
}

export interface AiCreateResult {
  session_id: number
  content: string
  content_type: string
  task: string
  question: string
}

export interface AiChatResult {
  correction: string
  praise: string
  question: string
  done: boolean
}

export async function createAiSession(content: string, contentType: string, task = ""): Promise<AiCreateResult> {
  return api<AiCreateResult>("/ai-practice/sessions", {
    method: "POST",
    body: { content, content_type: contentType, task },
    timeoutMs: 20000,
  })
}

export async function aiChat(sessionId: number, text: string): Promise<AiChatResult> {
  return api<AiChatResult>(`/ai-practice/sessions/${sessionId}/chat`, {
    method: "POST",
    body: { text },
    timeoutMs: 20000,
  })
}

export async function listAiSessions(): Promise<AiSessionSummary[]> {
  const res = await api<{ sessions: AiSessionSummary[] }>("/ai-practice/sessions")
  return res.sessions ?? []
}

export async function getAiSessionDetail(sessionId: number): Promise<AiSessionDetail> {
  return api<AiSessionDetail>(`/ai-practice/sessions/${sessionId}`)
}
