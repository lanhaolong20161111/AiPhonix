/** SOE 路由 — /api/v1/soe/evaluate|records|records/{id}|records/batch-delete */
import { Hono } from "hono"
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "../db/index.js"
import { speechEvalRecords } from "../db/schema.js"
import { getConfig } from "../env.js"
import { TencentSOEService } from "../lib/soe.js"
import { resolveCurrentUser } from "../middleware/auth.js"

const router = new Hono()
let svc: TencentSOEService | null = null
function getSvc(): TencentSOEService | null {
  if (!svc) {
    const cfg = getConfig()
    if (!cfg.tencent.secret_id || !cfg.tencent.secret_key) return null
    svc = new TencentSOEService(cfg.tencent.app_id, cfg.tencent.secret_id, cfg.tencent.secret_key)
  }
  return svc
}

const nowIso = () => new Date().toISOString()

// POST /api/v1/soe/evaluate
router.post("/soe/evaluate", async (c) => {
  const body = await c.req.json().catch(() => null)
  const refText = String(body?.ref_text ?? "")
  const audioBase64 = String(body?.audio_base64 ?? "")
  const engine = String(body?.engine ?? "")
  const evalMode = String(body?.eval_mode ?? "")
  const scene = String(body?.scene ?? "")
  const userId = Number(body?.user_id ?? 0)
  const source = String(body?.source ?? "")
  if (!refText || !audioBase64) return c.json({ detail: "缺少 ref_text 或 audio_base64" }, 422)

  const soe = getSvc()
  if (!soe) return c.json({ detail: "服务端未配置腾讯 SOE" }, 500)
  let result: Awaited<ReturnType<TencentSOEService["evaluate"]>>
  try {
    result = await soe.evaluate(refText, audioBase64, engine, evalMode, scene)
  } catch (e) {
    return c.json({ detail: `SOE 评测失败: ${(e as Error).message}` }, 500)
  }

  // 记录评测明细（写库失败不阻断）
  try {
    const language = result.engine.includes("zh")
      ? "zh"
      : /[\u4e00-\u9fff]/.test(refText)
        ? "zh"
        : "en"
    let evalType = scene || ""
    if (!evalType && evalMode) {
      evalType = ({ "0": "word", "1": "sentence", "2": "paragraph", "8": "pinyin" } as Record<string, string>)[evalMode] || ""
    }
    if (!evalType) evalType = refText.includes(" ") ? "sentence" : "word"
    db.insert(speechEvalRecords)
      .values({
        userId,
        language,
        evalType,
        refText: refText.slice(0, 500),
        source: source.slice(0, 255),
        engine: result.engine,
        totalAccuracy: result.pron_accuracy,
        totalFluency: result.pron_fluency,
        totalCompletion: result.pron_completion,
        suggestedScore: result.suggested_score,
        details: JSON.stringify(result.words),
        createdAt: nowIso(),
      })
      .run()
  } catch (e) {
    console.warn(`[soe] 评测记录写入失败: ${(e as Error).message}`)
  }
  return c.json(result)
})

// POST /api/v1/soe/records
router.post("/soe/records", async (c) => {
  const body = await c.req.json().catch(() => null)
  const userId = Number(body?.user_id ?? 0)
  const language = String(body?.language ?? "")
  const evalType = String(body?.eval_type ?? "")
  const limit = Math.min(Number(body?.limit ?? 50) || 50, 200)
  const offset = Math.max(Number(body?.offset ?? 0) || 0, 0)
  const conditions: any[] = []
  if (userId > 0) conditions.push(eq(speechEvalRecords.userId, userId))
  if (language) conditions.push(eq(speechEvalRecords.language, language))
  if (evalType) conditions.push(eq(speechEvalRecords.evalType, evalType))
  const rows = db
    .select()
    .from(speechEvalRecords)
    .where(conditions.length ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined)
    .orderBy(desc(speechEvalRecords.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
  const records = rows.map((r) => {
    let details: unknown[] = []
    try { details = JSON.parse(r.details) } catch { details = [] }
    return {
      id: r.id,
      user_id: r.userId,
      language: r.language,
      eval_type: r.evalType,
      ref_text: r.refText,
      source: r.source ?? "",
      engine: r.engine,
      total_accuracy: r.totalAccuracy,
      total_fluency: r.totalFluency,
      total_completion: r.totalCompletion,
      suggested_score: r.suggestedScore,
      units: details,
      created_at: r.createdAt ? new Date(String(r.createdAt)).toISOString() : null,
    }
  })
  return c.json({ total: records.length, records })
})

// DELETE /api/v1/soe/records/{id}
router.delete("/soe/records/:id", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const id = Number(c.req.param("id"))
  if (Number.isNaN(id)) return c.json({ detail: "记录不存在" }, 404)
  const rec = db.select({ userId: speechEvalRecords.userId }).from(speechEvalRecords).where(eq(speechEvalRecords.id, id)).get()
  if (!rec) return c.json({ detail: "记录不存在" }, 404)
  if (rec.userId !== user.id) return c.json({ detail: "无权删除该记录" }, 403)
  const result = db.delete(speechEvalRecords).where(eq(speechEvalRecords.id, id)).run()
  if (result.changes === 0) return c.json({ detail: "记录不存在" }, 404)
  return c.json({ ok: true, deleted: id })
})

// POST /api/v1/soe/records/batch-delete
router.post("/soe/records/batch-delete", async (c) => {
  const user = await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const ids = (body?.ids ?? []).map(Number).filter((n: number) => !Number.isNaN(n))
  if (!ids.length) return c.json({ ok: true, deleted: 0 })
  const result = db.delete(speechEvalRecords).where(and(eq(speechEvalRecords.userId, user.id), inArray(speechEvalRecords.id, ids))).run()
  return c.json({ ok: true, deleted: result.changes })
})

export default router
