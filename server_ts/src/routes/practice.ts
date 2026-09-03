/** Practice 路由 — /api/v1/practice/submit|stats|history（读写 data/practice/*.json）
 * 逐字段对齐 Python routes/practice.py：
 * - submit：重算 correct/total_score/max_score，覆盖 timestamp(ISO)/date(UTC)，保存 records 数组
 * - stats：per_char/per_char_attempts 均为 char→int（first_try 计数 / 尝试次数）
 * - history：total 为未过滤的全部会话数；sessions 取文件加载顺序末尾 limit 条再反转；records 为 int
 */
import { Hono } from "hono"
import { readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { dataPath } from "../lib/jsonfile.js"

import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
const PRACTICE_DIR = dataPath("practice")

interface PracticeRecord {
  char: string
  module: string
  attempt_count: number
  first_try_correct: boolean
  hint_used: boolean
  correct: boolean
  timestamp: string
  date: string
  grade: string
}

interface PracticeSession {
  module: string
  grade: string
  records: PracticeRecord[]
  total_score: number
  max_score: number
  timestamp: string
  date: string
}

// 与 PY _load 一致：os.listdir 顺序读取全部 .json（文件加载顺序）
const allSessions = (): PracticeSession[] => {
  if (!existsSync(PRACTICE_DIR)) return []
  const files = readdirSync(PRACTICE_DIR).filter((f) => f.endsWith(".json"))
  const sessions: PracticeSession[] = []
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(PRACTICE_DIR, f), "utf-8"))
      const records: PracticeRecord[] = Array.isArray(data?.records)
        ? data.records.map((r: Record<string, unknown>) => ({
            char: String(r?.char ?? ""),
            module: String(r?.module ?? ""),
            attempt_count: Number(r?.attempt_count ?? 0),
            first_try_correct: Boolean(r?.first_try_correct),
            hint_used: Boolean(r?.hint_used),
            correct: Boolean(r?.correct),
            timestamp: String(r?.timestamp ?? ""),
            date: String(r?.date ?? ""),
            grade: String(r?.grade ?? ""),
          }))
        : []
      sessions.push({
        module: String(data?.module ?? ""),
        grade: String(data?.grade ?? ""),
        records,
        total_score: Number(data?.total_score ?? 0),
        max_score: Number(data?.max_score ?? 0),
        timestamp: String(data?.timestamp ?? ""),
        date: String(data?.date ?? ""),
      })
    } catch {
      /* skip */
    }
  }
  return sessions
}

// POST /api/v1/practice/submit
router.post("/submit", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ detail: "请求体为空" }, 400)
  const now = new Date()
  const ts = now.getTime()

  const rawRecords: PracticeRecord[] = Array.isArray(body?.records)
    ? body.records.map((r: Record<string, unknown>) => ({
        char: String(r?.char ?? ""),
        module: String(r?.module ?? ""),
        attempt_count: Number(r?.attempt_count ?? 0),
        first_try_correct: Boolean(r?.first_try_correct),
        hint_used: Boolean(r?.hint_used),
        correct: Boolean(r?.correct),
        timestamp: String(r?.timestamp ?? ""),
        date: String(r?.date ?? ""),
        grade: String(r?.grade ?? ""),
      }))
    : []

  // 与 PY：now = datetime.now(timezone.utc)，session.timestamp/date 覆盖
  const session: PracticeSession = {
    module: String(body?.module ?? ""),
    grade: String(body?.grade ?? ""),
    records: rawRecords,
    total_score: 0,
    max_score: 0,
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
  }

  const correct = session.records.filter((r) => r.correct).length
  session.total_score = correct
  session.max_score = session.records.length

  const fileName = `practice_${session.date}_${ts}.json`
  const path = join(PRACTICE_DIR, fileName)
  try {
    mkdirSync(PRACTICE_DIR, { recursive: true })
    writeFileSync(
      path,
      JSON.stringify(
        {
          module: session.module,
          grade: session.grade,
          records: session.records,
          total_score: session.total_score,
          max_score: session.max_score,
          timestamp: session.timestamp,
          date: session.date,
        },
        null,
        2
      ),
      "utf-8"
    )
  } catch (e) {
    return c.json({ detail: `保存失败: ${(e as Error).message}` }, 500)
  }

  return c.json({ status: "ok", score: correct, max_score: session.records.length })
})

// GET /api/v1/practice/stats
router.get("/stats", (c) => {
  const module = c.req.query("module") ?? ""
  const all = allSessions()
  const sessions = all.filter((s) => !module || s?.module === module)

  let totalSessions = sessions.length
  let totalChars = 0
  let firstTryCorrect = 0
  let totalCorrect = 0
  const perChar = new Map<string, number>()
  const perCharAttempts = new Map<string, number>()
  for (const s of sessions) {
    const records = s?.records ?? []
    for (const r of records) {
      totalChars++
      const ch = r?.char ?? ""
      if (r.first_try_correct) {
        firstTryCorrect++
        perChar.set(ch, (perChar.get(ch) ?? 0) + 1)
      }
      if (r.correct) totalCorrect++
      perCharAttempts.set(ch, (perCharAttempts.get(ch) ?? 0) + 1)
    }
  }
  return c.json({
    total_sessions: totalSessions,
    total_chars: totalChars,
    first_try_correct: firstTryCorrect,
    total_correct: totalCorrect,
    per_char: Object.fromEntries(perChar),
    per_char_attempts: Object.fromEntries(perCharAttempts),
  })
})

// GET /api/v1/practice/history
router.get("/history", (c) => {
  const module = c.req.query("module") ?? ""
  const limit = Number(c.req.query("limit") ?? 20)
  const all = allSessions()
  // PY：先过滤 module，再取文件加载顺序末尾 limit 条（slice(-limit)），再反转
  const filtered = all.filter((s) => !module || s?.module === module)
  const sessions = filtered.slice(-limit).reverse()
  return c.json({
    // PY 的 total 是未过滤的全部会话数
    total: all.length,
    sessions: sessions.map((s) => ({
      module: s?.module ?? "",
      grade: s?.grade ?? "",
      total_score: s?.total_score ?? 0,
      max_score: s?.max_score ?? 0,
      timestamp: s?.timestamp ?? "",
      date: s?.date ?? "",
      records: (s?.records ?? []).length,
    })),
  })
})

export default router
