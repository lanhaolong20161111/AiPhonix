/** 视频跟读句子问题反馈 — /api/v1/video-issues
 * 普通用户可提交；管理员可查询。表运行时幂等创建，避免部署时依赖额外的 D1 手工迁移。
 */
import { Hono } from "hono"
import { sqlAll, sqlRun } from "../db/index.js"
import { requireAdmin, requireAuth, resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()

const ISSUE_TYPES = new Set(["audio_pause", "subtitle_timing", "subtitle_text", "other"])

let tableReady: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = sqlRun(
      `CREATE TABLE IF NOT EXISTS video_issue_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        video_name TEXT NOT NULL,
        subtitle_index INTEGER NOT NULL,
        sentence_text TEXT NOT NULL DEFAULT '',
        issue_type TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )`,
    )
      .then(() => sqlRun("CREATE INDEX IF NOT EXISTS ix_video_issue_reports_created_at ON video_issue_reports(created_at)"))
      .then(() => sqlRun("CREATE INDEX IF NOT EXISTS ix_video_issue_reports_video ON video_issue_reports(video_name, subtitle_index)"))
      .then(() => undefined)
      .catch((e) => {
        tableReady = null
        throw e
      })
  }
  return tableReady
}

/** POST /api/v1/video-issues */
router.post("/video-issues", requireAuth(), async (c) => {
  await ensureTable()
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  const videoName = String(body?.videoName ?? "").trim()
  const subtitleIndex = Number(body?.subtitleIndex)
  const sentenceText = String(body?.sentenceText ?? "").trim()
  const issueType = String(body?.issueType ?? "").trim()
  const description = String(body?.description ?? "").trim()

  if (!/^Ep\d{2}$/.test(videoName)) return c.json({ detail: "视频集参数不正确" }, 400)
  if (!Number.isInteger(subtitleIndex) || subtitleIndex < 1) return c.json({ detail: "句子序号不正确" }, 400)
  if (!sentenceText || sentenceText.length > 1000) return c.json({ detail: "字幕内容不能为空且不能超过 1000 字" }, 400)
  if (!ISSUE_TYPES.has(issueType)) return c.json({ detail: "问题类型不正确" }, 400)
  if (!description || description.length > 2000) return c.json({ detail: "问题描述不能为空且不能超过 2000 字" }, 400)

  const createdAt = new Date().toISOString()
  await sqlRun(
    `INSERT INTO video_issue_reports
      (user_id, video_name, subtitle_index, sentence_text, issue_type, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    user!.id,
    videoName,
    subtitleIndex,
    sentenceText,
    issueType,
    description,
    createdAt,
  )
  return c.json({ status: "ok", message: "问题已提交，感谢反馈" })
})

/** GET /api/v1/video-issues（管理员查看，前端暂未使用） */
router.get("/video-issues", requireAdmin(), async (c) => {
  await ensureTable()
  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? 100) || 100, 500))
  const rows = await sqlAll(
    `SELECT id, user_id, video_name, subtitle_index, sentence_text, issue_type, description, created_at
     FROM video_issue_reports ORDER BY id DESC LIMIT ?`,
    limit,
  )
  return c.json({ items: rows })
})

export default router
