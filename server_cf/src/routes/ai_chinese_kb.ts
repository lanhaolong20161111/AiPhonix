/** ai_chinese/ai_chinese_kb —— 按域自主路由拆出（路径/响应逐字节不变）。Cloudflare 版。
 * 共享目录与小工具在 lib/aiChineseContext.ts；提示词在 lib/prompts.ts。
 * 差异：db→getDb() 全 await；sqlite.prepare FTS→sqlAll；searchTitle 变 async。 */
import { Hono } from "hono"
import { getDb, sqlAll } from "../db/index.js"
import { knowledgeRelations, wikiPages } from "../db/schema.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { and, desc, eq, or, sql } from "drizzle-orm"
import { loadJsonArr, nowIso, searchTitle, chineseSearch } from "../lib/aiChineseContext.js"

const router = new Hono()

router.get("/wiki/pages", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const ptype = String(c.req.query("ptype") ?? "")
  const unit = String(c.req.query("unit") ?? "")
  const lesson = String(c.req.query("lesson") ?? "").trim()
  const q = String(c.req.query("q") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 500)
  const conditions = []
  if (ptype) conditions.push(eq(wikiPages.pageType, ptype))
  if (unit) conditions.push(eq(wikiPages.unit, unit))
  if (lesson) conditions.push(sql`${wikiPages.lesson} LIKE ${`%${lesson.replace(/[《》\s]/g, "")}%`}`)
  if (q) conditions.push(or(
    sql`${wikiPages.title} LIKE ${`%${q}%`}`,
    sql`${wikiPages.content} LIKE ${`%${q}%`}`
  ))
  const rows = await getDb()
    .select()
    .from(wikiPages)
    .where(and(...conditions))
    .orderBy(desc(wikiPages.id))
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({
    id: r.id, title: r.title, page_type: r.pageType,
    content: (r.content || "").slice(0, 1500), unit: r.unit, lesson: r.lesson,
    source_ref: r.sourceRef, links: loadJsonArr(r.links),
  })))
})

router.get("/wiki/pages/:page_id", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const pageId = Number(c.req.param("page_id"))
  const row = await getDb().select().from(wikiPages).where(eq(wikiPages.id, pageId)).get()
  if (!row) return c.json({ detail: "词条不存在" }, 404)
  const linkIds = loadJsonArr(row.links).map(Number).filter((n) => Number.isFinite(n) && n > 0)
  let links: { id: number; title: string; page_type: string }[] = []
  if (linkIds.length) {
    links = (await getDb().select().from(wikiPages).where(sql`${wikiPages.id} IN (${linkIds.join(",")})`).all())
      .map((l) => ({ id: l.id, title: l.title, page_type: l.pageType }))
  }
  return c.json({
    id: row.id, title: row.title, page_type: row.pageType,
    content: row.content, unit: row.unit, lesson: row.lesson,
    source_ref: row.sourceRef, links,
  })
})

router.put("/wiki/pages/:page_id", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const pageId = Number(c.req.param("page_id"))
  const body = await c.req.json().catch(() => null)
  const row = await getDb().select().from(wikiPages).where(eq(wikiPages.id, pageId)).get()
  if (!row) return c.json({ detail: "词条不存在" }, 404)
  const updates: Record<string, unknown> = {}
  if (String(body?.title ?? "").trim()) updates.title = String(body.title).trim()
  if (String(body?.content ?? "").trim()) updates.content = String(body.content).trim()
  if (String(body?.unit ?? "").trim()) updates.unit = String(body.unit).trim()
  if (String(body?.lesson ?? "").trim()) updates.lesson = String(body.lesson).trim()
  if (Array.isArray(body?.links) && body.links.length) {
    updates.links = JSON.stringify((body.links as unknown[]).map(Number))
  }
  if (Object.keys(updates).length) {
    updates.updatedAt = nowIso()
    await getDb().update(wikiPages).set(updates).where(eq(wikiPages.id, pageId)).run()
  }
  return c.json({ status: "ok", id: pageId })
})

router.get("/knowledge/relations", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const nodeId = Number(c.req.query("node_id") ?? 0)
  const relation = String(c.req.query("relation") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 300) || 300, 500)
  const conditions = []
  if (nodeId) conditions.push(or(eq(knowledgeRelations.fromId, nodeId), eq(knowledgeRelations.toId, nodeId)))
  if (relation) conditions.push(eq(knowledgeRelations.relation, relation))
  const rows = await getDb()
    .select()
    .from(knowledgeRelations)
    .where(and(...conditions))
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({ id: r.id, from: r.fromId, relation: r.relation, to: r.toId })))
})

router.get("/knowledge/graph/:node_id", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const nodeId = Number(c.req.param("node_id"))
  const node = await getDb().select().from(wikiPages).where(eq(wikiPages.id, nodeId)).get()
  if (!node) return c.json({ detail: "节点不存在" }, 404)
  const edges = await getDb().select().from(knowledgeRelations)
    .where(or(eq(knowledgeRelations.fromId, nodeId), eq(knowledgeRelations.toId, nodeId)))
    .all()
  const outEdges: { relation: string; to: number }[] = []
  const inEdges: { relation: string; from: number }[] = []
  for (const e of edges) {
    if (e.fromId === nodeId) outEdges.push({ relation: e.relation, to: e.toId })
    else inEdges.push({ relation: e.relation, from: e.fromId })
  }
  return c.json({
    node: { id: node.id, title: node.title, page_type: node.pageType, content: (node.content || "").slice(0, 500) },
    out_edges: outEdges, in_edges: inEdges,
  })
})

router.get("/search", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const q = String(c.req.query("q") ?? "").trim()
  const ptype = String(c.req.query("ptype") ?? "")
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 100)
  if (!q || q.length < 2) return c.json([])
  try {
    const rows = await chineseSearch(q, limit, ptype)
    const out: { id: number; ptype: string; title: string; snippet: string }[] = []
    for (const r of rows) {
      if (ptype && r.stype !== ptype) continue
      out.push({ id: r.sid, ptype: r.stype, title: await searchTitle(r.stype, r.sid), snippet: r.snip || "" })
    }
    return c.json(out.slice(0, limit))
  } catch (e) {
    console.warn("[ai-chinese/search] 搜索失败:", (e as Error).message)
    return c.json([])
  }
})

export default router
