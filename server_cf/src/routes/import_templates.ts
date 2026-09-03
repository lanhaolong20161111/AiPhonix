/** ImportTemplates 路由 — /api/v1/import-templates（读 R2 data/import_templates.json）
 * Cloudflare 版：懒加载 async + 60s TTL（🟠6：数据更新最多延迟 60s 生效）。
 */
import { Hono } from "hono"
import { readJson, dataPath } from "../lib/jsonfile.js"
import { ttlCache } from "../lib/ttlCache.js"

const router = new Hono()

interface TemplateData {
  version?: string
  templates?: unknown[]
}

const templatesStore = ttlCache<TemplateData>(
  () => readJson<TemplateData>(dataPath("import_templates.json"), {}),
  60_000
)

const getData = async (): Promise<TemplateData> => templatesStore.get()

router.get("/", async (c) => {
  const data = await getData()
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
