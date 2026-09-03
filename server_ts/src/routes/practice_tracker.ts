/** PracticeTracker 路由 — /api/v1/practice/char-record|char-weights|records
 * 逐字段对齐 Python services/practice_tracker.py + routes/practice_tracker.py：
 * - 持久化：SQLite `char_practice` 表（按账号隔离：唯一键 (user_id, char)，2026-09-02 起）
 * - id 自增保持插入序（对齐 PY records.values() 列表顺序语义）；last_seen 为 unix 浮点秒
 * - consecutive_correct 为**全局**连续正确（非按类型），基于总对错比判定
 * - 权重公式见 lib/practiceWeights.ts（与 PY get_weight 一致，有单测覆盖）
 * - 所有读写均挂在当前登录账号下（requireAuth + resolveCurrentUser）
 */
import { Hono } from "hono"
import { eq, and, asc } from "drizzle-orm"
import { computeWeight, emptyRec, type CharRec } from "../lib/practiceWeights.js"
import {
  parseOut,
  PracticeRecordsResponseSchema,
  PracticeWeightsResponseSchema,
} from "../contracts/index.js"
import { db } from "../db/index.js"
import { charPractice } from "../db/schema.js"

import { requireAuth, resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()

type Row = typeof charPractice.$inferSelect

function rowToRec(r: Row): CharRec {
  return {
    char: r.char,
    pinyin_correct: r.pinyinCorrect,
    pinyin_wrong: r.pinyinWrong,
    pronunciation_correct: r.pronunciationCorrect,
    pronunciation_wrong: r.pronunciationWrong,
    consecutive_correct: r.consecutiveCorrect,
    last_seen: r.lastSeen,
    last_correct: Boolean(r.lastCorrect),
    passed: Boolean(r.passed),
  }
}

const getRec = (userId: number, ch: string): Row | undefined =>
  db.select().from(charPractice)
    .where(and(eq(charPractice.userId, userId), eq(charPractice.char, ch)))
    .get()

// POST /api/v1/practice/char-record
router.post("/char-record", requireAuth(), async (c) => {
  const user = (await resolveCurrentUser(c.req.header("Authorization")))!
  const body = await c.req.json().catch(() => null)
  const char = String(body?.char ?? "")
  const correct = Boolean(body?.correct)
  const type = String(body?.type ?? "pronunciation") // pinyin | pronunciation
  if (!char) return c.json({ detail: "缺少 char" }, 400)

  // 读改写（单进程低并发，无需事务级竞争防护；WAL 下原子且快速）
  let rec: CharRec
  const existing = getRec(user.id, char)
  rec = existing ? rowToRec(existing) : emptyRec(char)

  rec.last_seen = Date.now() / 1000 // time.time() 浮点秒
  if (type === "pinyin") {
    if (correct) rec.pinyin_correct++
    else rec.pinyin_wrong++
  } else {
    if (correct) rec.pronunciation_correct++
    else rec.pronunciation_wrong++
  }
  // 全局连续正确判定（与 PY 一致，不分类型）
  rec.last_correct =
    rec.pinyin_correct + rec.pronunciation_correct > rec.pinyin_wrong + rec.pronunciation_wrong
  rec.consecutive_correct = rec.last_correct ? rec.consecutive_correct + 1 : 0

  if (existing) {
    db.update(charPractice)
      .set({
        pinyinCorrect: rec.pinyin_correct,
        pinyinWrong: rec.pinyin_wrong,
        pronunciationCorrect: rec.pronunciation_correct,
        pronunciationWrong: rec.pronunciation_wrong,
        consecutiveCorrect: rec.consecutive_correct,
        lastSeen: rec.last_seen,
        lastCorrect: rec.last_correct,
      })
      .where(eq(charPractice.id, existing.id))
      .run()
  } else {
    db.insert(charPractice)
      .values({
        userId: user.id,
        char,
        pinyinCorrect: rec.pinyin_correct,
        pinyinWrong: rec.pinyin_wrong,
        pronunciationCorrect: rec.pronunciation_correct,
        pronunciationWrong: rec.pronunciation_wrong,
        consecutiveCorrect: rec.consecutive_correct,
        lastSeen: rec.last_seen,
        lastCorrect: rec.last_correct,
      })
      .run()
  }
  return c.json({ status: "ok" })
})

// POST /api/v1/practice/pass  { char } — 标记该字"已通过"（认字全关卡达标）
router.post("/pass", requireAuth(), async (c) => {
  const user = (await resolveCurrentUser(c.req.header("Authorization")))!
  const body = await c.req.json().catch(() => null)
  const char = String(body?.char ?? "")
  if (!char) return c.json({ detail: "缺少 char" }, 400)
  const existing = getRec(user.id, char)
  const now = Date.now() / 1000
  if (existing) {
    db.update(charPractice)
      .set({ passed: true, lastSeen: now })
      .where(eq(charPractice.id, existing.id))
      .run()
  } else {
    db.insert(charPractice)
      .values({ userId: user.id, char, passed: true, lastSeen: now })
      .run()
  }
  return c.json({ status: "ok" })
})

// POST /api/v1/practice/char-weights
router.post("/char-weights", requireAuth(), async (c) => {
  const user = (await resolveCurrentUser(c.req.header("Authorization")))!
  const body = await c.req.json().catch(() => null)
  const chars = Array.isArray(body?.chars) ? body.chars.map(String) : []
  const weights: Record<string, number> = {}
  for (const ch of chars) {
    const row = getRec(user.id, ch)
    weights[ch] = row ? computeWeight(rowToRec(row)) : 1.0
  }
  return c.json(parseOut(PracticeWeightsResponseSchema, { weights }, "practice/char-weights"))
})

// POST /api/v1/practice/records
router.post("/records", requireAuth(), async (c) => {
  const user = (await resolveCurrentUser(c.req.header("Authorization")))!
  const body = await c.req.json().catch(() => null)
  const chars: string[] | null =
    Array.isArray(body?.chars) && body.chars.length ? body.chars.map((x: unknown) => String(x)) : null
  // chars 为空返回该账号全部（按插入顺序）；否则按请求顺序只返回出现的字
  const rows: Row[] = chars
    ? chars.map((ch) => getRec(user.id, ch)).filter((r): r is Row => r !== undefined)
    : db.select().from(charPractice)
        .where(eq(charPractice.userId, user.id))
        .orderBy(asc(charPractice.id))
        .all()
  const records = rows.map(rowToRec)
  return c.json(parseOut(PracticeRecordsResponseSchema, { total: records.length, records }, "practice/records"))
})

export default router
