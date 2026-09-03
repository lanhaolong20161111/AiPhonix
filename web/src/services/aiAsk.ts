/** AI 提问统一入口 — 纯文本直接问答；图片（可带问题）识别后问答 */

import { api } from "./api"
import { compressImageFile } from "../lib/imageCompress"

export interface LlmChatReply {
  reply: string
}

/**
 * 纯文本提问 → 直接调 LLM 回答（无画像，旧路径）。
 * @param text 用户输入的问题
 * @param mode chinese / english / math（对应后端 system prompt；默认 chat）
 */
export async function askLlm(text: string, mode: "chinese" | "english" | "math" | "" = ""): Promise<string> {
  const res = await api<LlmChatReply>("/llm/chat", {
    method: "POST",
    body: { message: text, mode: mode || "chat" },
    timeoutMs: 60000,
  })
  return res.reply ?? ""
}

export interface ChatTurnPayload {
  role: "user" | "assistant"
  content: string
}

export interface AskProfileResult {
  reply: string
  session_id?: string
  tts_url?: string
  word_info?: string
  /** 提问语法/语义纠错（后端从【改错】标签解析）：corrected=修正后完整句，wrongs=原句错误片段 */
  correction?: { corrected: string; wrongs: string[] }
  /** 小老师游戏判分（后端从【判对】标签解析）：1=纠正正确 0=未纠正 */
  judge?: number
}

/**
 * 带学生画像与后端会话的语数英对话（后端按 JWT user_id 读画像注入个性化，并回写画像；
 * 会话由后端按 session_id 持久化，支持断点续聊）。
 * @param module chinese / math / english
 * @param message 本轮最新消息
 * @param sessionId 会话 id（续聊传回；首次可空由后端创建并返回）
 * @param imageUrl 可选：服务端图片相对路径，走多模态问答
 */
/** 拉取历史会话消息（恢复多轮对话 UI；仅本人会话，无会话返回空数组） */
export async function fetchChatSession(
  sessionId: string,
): Promise<{ session_id: string; module: string; messages: ChatTurnPayload[] }> {
  return api(`/ai-chat/session?session_id=${encodeURIComponent(sessionId)}`, { timeoutMs: 15000 })
}

export async function askWithProfile(
  module: string,
  message: string,
  sessionId = "",
  imageUrl = "",
  role = "",
): Promise<AskProfileResult> {
  const res = await api<AskProfileResult>("/ai-chat/ask", {
    method: "POST",
    body: {
      module,
      message,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
      ...(role ? { role } : {}),
    },
    timeoutMs: 90000,
  })
  return res
}

/** 上传图片到服务端，返回可用于 /ai-chat/ask 的图片相对路径 */
export async function uploadPhoto(file: File | Blob): Promise<string> {
  // 上传前压缩：平板高清原图体积大、易触发 60s 超时（表现为 "signal is aborted without reason"）
  const compressed = await compressImageFile(file, 1600, 0.85)
  const form = new FormData()
  const name = file instanceof File && file.name ? file.name : "image.jpg"
  form.append("file", compressed, name)
  const res = await api<{ url: string }>("/uploads/photo", {
    method: "POST",
    body: form,
    timeoutMs: 60000,
  })
  return res.url ?? ""
}
