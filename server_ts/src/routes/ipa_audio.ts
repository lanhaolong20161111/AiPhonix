/** IpaAudio 路由 — /api/v1/ipa-audio?file=xxx.aac（文件服务，仅单个 .aac 文件名） */
import { Hono } from "hono"
import { join, normalize } from "node:path"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dataPath } from "../lib/jsonfile.js"

const router = new Hono()
const AUDIO_DIR = dataPath("ipa_audio")

router.get("/", async (c) => {
  const file = c.req.query("file") ?? ""
  if (!file.endsWith(".aac")) return c.json({ detail: "仅支持 aac" }, 400)
  const name = file.split(/[\\/]/).pop() || ""
  const full = normalize(join(AUDIO_DIR, name))
  if (!full.startsWith(normalize(AUDIO_DIR))) return c.json({ detail: "非法路径" }, 400)
  if (!existsSync(full)) return c.json({ detail: "文件不存在" }, 404)
  // 异步读 + 缓存头：音素 chip 点击高频路径，音频文件内容不变，让浏览器直接命中本地缓存
  return new Response(await readFile(full), { headers: { "Content-Type": "audio/aac", "Cache-Control": "public, max-age=604800" } })
})

export default router
