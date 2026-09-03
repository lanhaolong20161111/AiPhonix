/** Chinese 路由 — /api/v1/chinese/polyphone（读 data/polyphone_chars.json） */
import { Hono } from "hono"
import { existsSync, readFileSync } from "node:fs"
import { dataPath } from "../lib/jsonfile.js"

const router = new Hono()

// GET /api/v1/chinese/polyphone
router.get("/polyphone", (c) => {
  const path = dataPath("polyphone_chars.json")
  if (existsSync(path)) {
    try {
      return c.json(JSON.parse(readFileSync(path, "utf-8")))
    } catch {
      return c.json([])
    }
  }
  return c.json([])
})

export default router
