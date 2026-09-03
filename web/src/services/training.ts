/** 训练计划 / 打卡 API 客户端 — 对应 server_py/routes/training.py */

import { api } from "./api"

/** 与 Android FeatureCatalog 一致的功能目录 */
export const FEATURES = [
  { id: "recognition", emoji: "🔤", title: "认字", subtitle: "看图认汉字，跟读发音", training: true },
  { id: "dictation", emoji: "✏️", title: "默写", subtitle: "听音写字，检验掌握", training: true },
  { id: "word_practice", emoji: "📚", title: "词语", subtitle: "词语跟读与辨析", training: true },
  { id: "oral_writing", emoji: "🎙️", title: "口述作文", subtitle: "看图/听题口述表达", training: true },
  { id: "char_image", emoji: "🖼️", title: "看图识字词句", subtitle: "识字 · 识词 · 识句", training: true },
  { id: "english_learning", emoji: "🇬🇧", title: "英语学习", subtitle: "字母 · 拼读 · 视频跟读", training: true },
  { id: "video_practice", emoji: "🎬", title: "视频跟读", subtitle: "跟读视频练发音", training: true },
  { id: "daily_practice", emoji: "🏆", title: "每日一练", subtitle: "语文 · 数学 · 英语", training: true },
  { id: "ai_practice", emoji: "🤖", title: "AI 陪我练", subtitle: "导入主题，AI 多轮引导练习", training: true },
  { id: "ai_chinese", emoji: "📷", title: "AI 语文识图", subtitle: "拍照/粘贴图片识别，语文问答", training: true },
] as const

export interface Feature {
  id: string
  emoji: string
  title: string
  subtitle: string
  training: boolean
}

export interface PlanItem {
  id: string
  feature: string
  done: boolean
  doneAt?: number | null
  lastResult?: unknown
  /** 家长配置（如认字选年级批次：{"grades": ["一年级上"]}） */
  config?: Record<string, unknown> | null
}

export interface TrainingPlan {
  id: string
  title: string
  items: PlanItem[]
  createdAt: number
  updatedAt: number
}

export interface ProgressRecord {
  plan_item_id: string
  feature: string
  date: string
  status: string
  count: number
  correct: number | null
  score: number | null
  duration_ms: number
  metrics: Record<string, unknown>
}

export interface GetPlanResponse {
  plan: TrainingPlan | null
}

export interface ProgressResponse {
  total: number
  sessions: ProgressRecord[]
}

export async function fetchPlan(): Promise<TrainingPlan | null> {
  const res = await api<GetPlanResponse>("/training/plan")
  return res.plan
}

export async function savePlan(plan: TrainingPlan): Promise<TrainingPlan> {
  const res = await api<{ status: string; plan: TrainingPlan }>("/training/plan", {
    method: "PUT",
    body: plan,
  })
  return res.plan
}

export async function fetchProgress(params: { date?: string; start?: string; end?: string } = {}): Promise<ProgressRecord[]> {
  const qs = new URLSearchParams()
  if (params.date) qs.set("date", params.date)
  if (params.start) qs.set("start", params.start)
  if (params.end) qs.set("end", params.end)
  const q = qs.toString()
  const res = await api<ProgressResponse>(`/training/progress${q ? `?${q}` : ""}`)
  return res.sessions
}

/** 按 feature id 查功能元数据 */
export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id) as Feature | undefined
}
