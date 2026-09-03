/** Chinese 路由 — /api/v1/chinese/polyphone（读 data/polyphone_chars.json，Cloud 版：R2 async） */
import { Hono } from "hono"
import { exists, readText } from "../lib/storage.js"
import { dataPath } from "../lib/jsonfile.js"

const router = new Hono()

// GET /api/v1/chinese/polyphone
router.get("/polyphone", async (c) => {
  const path = dataPath("polyphone_chars.json")
  if (await exists(path)) {
    try {
      const content = await readText(path)
      return c.json(JSON.parse(content ?? "null"))
    } catch {
      return c.json([])
    }
  }
  return c.json([])
})

export default router
