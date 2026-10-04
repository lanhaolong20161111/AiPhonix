/** 训练计划 / 打卡 API 客户端 — 对应 server_py/routes/training.py */

import { api } from "./api"
import { TRAINING_MODULES } from "../modules/registry"

/** 与 Android FeatureCatalog 一致的功能目录 —— 由模块注册表派生（唯一真源，见 modules/catalog.ts） */
export const FEATURES: Feature[] = TRAINING_MODULES.map((m) => ({
  id: m.id,
  emoji: m.icon,
  title: m.title,
  subtitle: m.subtitle ?? "",
  training: true,
}))

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
