/** English 路由 — /api/v1/english/vocabulary|sentences（纯静态 JSON） */
import { Hono, type Context } from "hono"
import { existsSync, readFileSync } from "node:fs"
import { dataPath } from "../lib/jsonfile.js"

const router = new Hono()

const serveJsonFile = (path: string) => (c: Context) => {
  if (!existsSync(path)) return c.json({ detail: "数据文件不存在" }, 404)
  const content = readFileSync(path, "utf-8")
  return c.json(JSON.parse(content))
}

router.get("/vocabulary", serveJsonFile(dataPath("english_vocabulary.json")))
router.get("/sentences", serveJsonFile(dataPath("english_sentences.json")))

export default router
