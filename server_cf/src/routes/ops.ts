/** Ops 路由 — /api/v1/ops/logs|metrics（🟡8 可观测性查询；JWT 保护）
 * 读取 request_logs（由 index.ts 中间件/onError 写 D1），支持按 level/status/path 过滤与聚合。
 */
import { Hono } from "hono"
import { getEnv } from "../env.js"
import { requireRole } from "../middleware/auth.js"

const router = new Hono()

interface LogRow {
  id: number
  ts: string
  method: string
  path: string
  status: number
  duration_ms: number
  level: string
  message: string
}

/** since 解析：支持 24h/1d/7d/1w 或 ISO 时间；默认 24h */
function sinceBoundary(since: string): string {
  const m = since.match(/^(\d+)([hdw])$/)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]
    const ms = unit === "h" ? n * 3_600_000 : unit === "d" ? n * 86_400_000 : n * 7 * 86_400_000
    return new Date(Date.now() - ms).toISOString()
  }
  if (!Number.isNaN(Date.parse(since))) return new Date(Date.parse(since)).toISOString()
  return new Date(Date.now() - 24 * 3_600_000).toISOString()
}

// GET /api/v1/ops/logs?level=&status=&path=&limit=（运维日志：仅管理员）
router.get("/logs", requireRole("admin"), async (c) => {
  const level = String(c.req.query("level") ?? "").trim()
  const status = String(c.req.query("status") ?? "").trim()
  const path = String(c.req.query("path") ?? "").trim()
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 1000)
  let sql = "SELECT id, ts, method, path, status, duration_ms, level, message FROM request_logs WHERE 1=1"
  const args: unknown[] = []
  if (level) {
    args.push(level)
    sql += ` AND level = ?${args.length}`
  }
  if (status && /^\d+$/.test(status)) {
    args.push(Number(status))
    sql += ` AND status = ?${args.length}`
  }
  if (path) {
    args.push(`${path}%`)
    sql += ` AND path LIKE ?${args.length}`
  }
  sql += ` ORDER BY id DESC LIMIT ?${args.length + 1}`
  args.push(limit)
  const r = await getEnv().DB.prepare(sql).bind(...(args as [])).all<LogRow>()
  return c.json({ total: r.results.length, items: r.results })
})

// GET /api/v1/ops/metrics?since=24h|1d|7d|ISO（运维指标：仅管理员）
router.get("/metrics", requireRole("admin"), async (c) => {
  const since = sinceBoundary(String(c.req.query("since") ?? "24h"))
  const db = getEnv().DB
  const summary = await db
    .prepare(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errs, ROUND(AVG(duration_ms), 1) AS avg_ms, MAX(duration_ms) AS max_ms FROM request_logs WHERE ts >= ?1"
    )
    .bind(since)
    .first<{ n: number; errs: number; avg_ms: number; max_ms: number }>()
  const byStatus = (
    await db
      .prepare("SELECT status, COUNT(*) AS c FROM request_logs WHERE ts >= ?1 GROUP BY status ORDER BY c DESC")
      .bind(since)
      .all<{ status: number; c: number }>()
  ).results
  const topPaths = (
    await db
      .prepare(
        "SELECT path, COUNT(*) AS c, ROUND(AVG(duration_ms),1) AS avg_ms FROM request_logs WHERE ts >= ?1 GROUP BY path ORDER BY c DESC LIMIT 20"
      )
      .bind(since)
      .all<{ path: string; c: number; avg_ms: number }>()
  ).results
  const durs = (
    await db
      .prepare("SELECT duration_ms FROM request_logs WHERE ts >= ?1 ORDER BY duration_ms LIMIT 5000")
      .bind(since)
      .all<{ duration_ms: number }>()
  ).results.map((r) => r.duration_ms)
  const pct = (p: number) => (durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * p))] : 0)
  return c.json({
    since,
    summary: summary ?? { n: 0, errs: 0, avg_ms: 0, max_ms: 0 },
    by_status: byStatus,
    top_paths: topPaths,
    latency: { count: durs.length, p50: pct(0.5), p95: pct(0.95) },
  })
})

export default router