/** ImportTemplates 路由 — /api/v1/import-templates（读 data/import_templates.json） */
import { Hono } from "hono"
import { readJson, dataPath } from "../lib/jsonfile.js"

const router = new Hono()

interface TemplateData {
  version?: string
  templates?: unknown[]
}

let cache: TemplateData | null = null

const getData = (): TemplateData => {
  if (!cache) cache = readJson<TemplateData>(dataPath("import_templates.json"), {})
  return cache
}

router.get("/", (c) => {
  const data = getData()
  const id = c.req.query("id")
  const version = String(data.version ?? "")
  if (id) {
    const templates = Array.isArray(data.templates) ? data.templates : []
    const tpl = templates.find((t) => (t as { id?: string })?.id === id)
    if (!tpl) return c.json({ status: "not_found", version, template: null })
    return c.json({ status: "ok", version, template: tpl })
  }
  return c.json({ status: "ok", version, templates: data.templates ?? [] })
})

export default router
