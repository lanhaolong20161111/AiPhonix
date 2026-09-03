/** IpaAudio 路由 — /api/v1/ipa-audio?file=xxx.aac（R2 文件服务，仅单个 .aac 文件名）
 * Cloudflare 版：R2（data/ipa_audio/<文件>），语义对齐 server_ts。
 */
import { Hono } from "hono"
import { dataPath } from "../lib/jsonfile.js"
import { exists, readBlob } from "../lib/storage.js"

const router = new Hono()
const AUDIO_DIR = dataPath("ipa_audio")

router.get("/", async (c) => {
  const file = c.req.query("file") ?? ""
  if (!file.endsWith(".aac")) return c.json({ detail: "仅支持 aac" }, 400)
  const name = file.split(/[\\/]/).pop() || ""
  if (name.includes("..") || !name) return c.json({ detail: "非法路径" }, 400)
  const key = `${AUDIO_DIR}/${name}`
  if (!(await exists(key))) return c.json({ detail: "文件不存在" }, 404)
  const data = await readBlob(key)
  if (!data) return c.json({ detail: "文件不存在" }, 404)
  // 缓存头：音素 chip 点击高频路径，音频文件内容不变，让浏览器直接命中本地缓存
  return new Response(data, { headers: { "Content-Type": "audio/aac", "Cache-Control": "public, max-age=604800" } })
})

export default router
