/** English 路由 — /api/v1/english/vocabulary|sentences（纯静态 JSON，Cloud 版：R2 async） */
import { Hono, type Context } from "hono"
import { exists, readText } from "../lib/storage.js"
import { dataPath } from "../lib/jsonfile.js"

const router = new Hono()

const serveJsonFile = (path: string) => async (c: Context) => {
  if (!(await exists(path))) return c.json({ detail: "数据文件不存在" }, 404)
  const content = await readText(path)
  return c.json(JSON.parse(content ?? "null"))
}

router.get("/vocabulary", serveJsonFile(dataPath("english_vocabulary.json")))
router.get("/sentences", serveJsonFile(dataPath("english_sentences.json")))

export default router
