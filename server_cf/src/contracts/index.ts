/** 前后端共享契约层（2026-08-27 起）—— 单一事实来源
 * 后端路由用这些 zod schema 校验出参；前端经 Vite 别名 @contracts 直接引用推导类型，
 * 手写 DTO 从此有编译期护栏。新增/修改字段只改这里。
 */
import { z } from "zod"

// ── 练习记录 ──
export const CharPracticeRecordSchema = z.object({
  char: z.string(),
  pinyin_correct: z.number(),
  pinyin_wrong: z.number(),
  pronunciation_correct: z.number(),
  pronunciation_wrong: z.number(),
  consecutive_correct: z.number(),
  last_seen: z.number().nullable(),
  last_correct: z.boolean(),
  passed: z.boolean(),
})
export const PracticeWeightsResponseSchema = z.object({ weights: z.record(z.string()) })
export const PracticeRecordsResponseSchema = z.object({
  total: z.number(),
  records: z.array(CharPracticeRecordSchema),
})

// ── 上传记录 ──
export const UploadRecordSchema = z.object({
  id: z.number(),
  kind: z.enum(["photo", "text"]),
  file_name: z.string(),
  url: z.string(),
  content: z.string(),
  ocr_text: z.string(),
  note: z.string(),
  source: z.string(),
  uploader: z.string(),
  origin: z.string(),
  created_at: z.string().nullable(),
})
export const UploadPhotoResponseSchema = z.object({
  status: z.literal("ok"),
  id: z.number(),
})

// ── LLM 运维 ──
export const LlmBudgetResponseSchema = z.object({
  date: z.string(),
  total_cost: z.number(),
  calls: z.number(),
  max_cost_per_day: z.number(),
  max_cost_per_call: z.number(),
  max_input_chars: z.number(),
  blocked: z.boolean(),
})
export const CurrentUserSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  username: z.string(),
  nickname: z.string(),
  role: z.string(),
  grade: z.string(),
  age: z.number(),
  learning_level: z.string(),
})

// 推导类型（前端直接 import type）
export type CharPracticeRecord = z.infer<typeof CharPracticeRecordSchema>
export type PracticeRecordsResponse = z.infer<typeof PracticeRecordsResponseSchema>
export type PracticeWeightsResponse = z.infer<typeof PracticeWeightsResponseSchema>
export type UploadRecord = z.infer<typeof UploadRecordSchema>
export type UploadPhotoResponse = z.infer<typeof UploadPhotoResponseSchema>
export type LlmBudgetResponse = z.infer<typeof LlmBudgetResponseSchema>
export type CurrentUser = z.infer<typeof CurrentUserSchema>

/** 出参安全校验：不匹配时放行原样 + 告警（渐进收紧，不做砖头） */
export function parseOut<T>(schema: z.ZodType<T>, value: unknown, tag: string): T {
  const r = schema.safeParse(value)
  if (!r.success) console.warn(`[contract] ${tag} 出参与契约不符: ${r.error.issues[0]?.message}`)
  return (r.success ? r.data : value) as T
}
