/**
 * 契约层（server_cf 自包含副本）
 *
 * ⚠️ 为什么不复用 server_ts 的契约：server_cf 是独立 npm 工程（不在 pnpm 工作区），
 * 而 server_ts 的 `node_modules/zod` 是 pnpm 符号链接（junction）。wrangler 的 esbuild
 * 在 Windows 上拒绝穿越 junction（"untrusted mount point"），导致 `deploy` 构建失败：
 *   Cannot read directory "../server_ts/node_modules/zod": untrusted mount point
 * 因此本文件在 server_cf 内自包含定义，zod 解析到 server_cf 自身的真实 node_modules。
 *
 * 🔴 规范源仍是 server_ts/src/contracts/index.ts：修改 schema 时两处需同步，
 * 否则 server_cf 与 server_ts 会再次漂移（原转发方案的本意即消除漂移）。
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
export const PracticeWeightsResponseSchema = z.object({ weights: z.record(z.string(), z.string()) })
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

// ── 课件库（语/数/英课件图片） ──
export const CoursewareModuleSchema = z.enum(["chinese", "math", "english"])
export const CoursewareItemSchema = z.object({
  id: z.number(),
  module: CoursewareModuleSchema,
  file_name: z.string(),
  url: z.string(),
  title: z.string(),
  created_at: z.string().nullable(),
})
export const CoursewareListResponseSchema = z.object({
  total: z.number(),
  items: z.array(CoursewareItemSchema),
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

// ── 发音要领（低分音素的阅读技巧） ──
export const PhoneTipSchema = z.object({
  phone: z.string(),
  tip: z.string(),
  category: z.string(),
})
export const PhoneTipsResponseSchema = z.object({
  tips: z.array(PhoneTipSchema),
  source: z.enum(["llm", "cache", "empty"]),
})

// 推导类型（前端直接 import type）
export type CharPracticeRecord = z.infer<typeof CharPracticeRecordSchema>
export type PracticeRecordsResponse = z.infer<typeof PracticeRecordsResponseSchema>
export type PracticeWeightsResponse = z.infer<typeof PracticeWeightsResponseSchema>
export type UploadRecord = z.infer<typeof UploadRecordSchema>
export type UploadPhotoResponse = z.infer<typeof UploadPhotoResponseSchema>
export type CoursewareModule = z.infer<typeof CoursewareModuleSchema>
export type CoursewareItem = z.infer<typeof CoursewareItemSchema>
export type CoursewareListResponse = z.infer<typeof CoursewareListResponseSchema>
export type LlmBudgetResponse = z.infer<typeof LlmBudgetResponseSchema>
export type CurrentUser = z.infer<typeof CurrentUserSchema>
export type PhoneTip = z.infer<typeof PhoneTipSchema>
export type PhoneTipsResponse = z.infer<typeof PhoneTipsResponseSchema>

/** 出参安全校验：不匹配时放行原样 + 告警（渐进收紧，不做砖头） */
export function parseOut<T>(schema: z.ZodType<T>, value: unknown, tag: string): T {
  const r = schema.safeParse(value)
  if (!r.success) console.warn(`[contract] ${tag} 出参与契约不符: ${r.error.issues[0]?.message}`)
  return (r.success ? r.data : value) as T
}
