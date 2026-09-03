/** 看图识字 API 客户端 — 对应 server_py/routes/char_images.py */

import { api } from "./api"
import { API_BASE } from "./config"
import { useAuthStore } from "../stores/authStore"

export interface CharImageItem {
  char: string
  image: string
  grade: string
  semester: string
  type: string
  pinyin: string
  ipa?: string | null
  ipa_uk?: string | null
  phonemes?: string[] | null
  phonemes_uk?: string[] | null
}

export interface CharImageListResponse {
  total: number
  items: CharImageItem[]
}

export async function listCharImages(params: {
  grade?: string
  semester?: string
  type_?: string
  q?: string
  limit?: number
} = {}): Promise<CharImageItem[]> {
  const qs = new URLSearchParams()
  if (params.grade) qs.set("grade", params.grade)
  if (params.semester) qs.set("semester", params.semester)
  if (params.type_) qs.set("type", params.type_)
  if (params.q) qs.set("q", params.q)
  if (params.limit) qs.set("limit", String(params.limit))
  const q = qs.toString()
  const res = await api<CharImageListResponse>(`/char-images${q ? `?${q}` : ""}`, { auth: false })
  return res.items ?? []
}

/** 图片文件 URL（可选尺寸：?w=N → 服务端按需缩略 JPEG，字卡页用 w=640 提速加载） */
export function charImageUrl(filename: string, width?: number): string {
  return `${API_BASE}/char-images/file/${encodeURIComponent(filename)}${width ? `?w=${width}` : ""}`
}

export type LearningStatus = "correct" | "wrong" | "unsure"

/** 提交学习状态反馈（✓ × ?）到服务端 */
export async function submitCharFeedback(
  item: CharImageItem,
  status: LearningStatus,
): Promise<boolean> {
  try {
    const userId = useAuthStore.getState().session?.user.user_id ?? 0
    await api("/char-images/feedback", {
      method: "POST",
      body: {
        user_id: userId,
        char: item.char,
        grade: item.grade,
        semester: item.semester,
        type: item.type,
        learning_status: status,
      },
      auth: false,
      timeoutMs: 8000,
    })
    return true
  } catch {
    return false
  }
}
