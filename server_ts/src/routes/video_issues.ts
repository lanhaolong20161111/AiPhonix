/** 视频跟读句子问题反馈 — /api/v1/video-issues（本地 TS 服务端） */
import { Hono } from "hono"
import { sqlite } from "../db/index.js"
import { requireAdmin, requireAuth, resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()
const ISSUE_TYPES = new Set(["audio_pause", "subtitle_timing", "subtitle_text", "other"])
let tableReady = false

function ensureTable(): void {
  if (tableReady) return
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS video_issue_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_name TEXT NOT NULL,
      subtitle_index INTEGER NOT NULL,
      sentence_text TEXT NOT NULL DEFAULT '',
      issue_type TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS ix_video_issue_reports_created_at ON video_issue_reports(created_at);
    CREATE INDEX IF NOT EXISTS ix_video_issue_reports_video ON video_issue_reports(video_name, subtitle_index);
  `)
  tableReady = true
}

router.post("/video-issues", requireAuth(), async (c) => {
  ensureTable()
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

  sqlite.prepare(
    `INSERT INTO video_issue_reports
      (user_id, video_name, subtitle_index, sentence_text, issue_type, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(user!.id, videoName, subtitleIndex, sentenceText, issueType, description, new Date().toISOString())
  return c.json({ status: "ok", message: "问题已提交，感谢反馈" })
})

router.get("/video-issues", requireAdmin(), (c) => {
  ensureTable()
  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? 100) || 100, 500))
  const rows = sqlite.prepare(
    `SELECT id, user_id, video_name, subtitle_index, sentence_text, issue_type, description, created_at
     FROM video_issue_reports ORDER BY id DESC LIMIT ?`,
  ).all(limit)
  return c.json({ items: rows })
})

export default router
