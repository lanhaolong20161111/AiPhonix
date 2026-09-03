/** PinyinAudio 路由 — /api/v1/pinyin-audio?file=目录/文件名.mp3（R2 文件服务，白名单目录+防穿越）
 * Cloudflare 版：R2（data/pinyin_audio/<目录>/<文件>），语义对齐 server_ts。
 */
import { Hono } from "hono"
import { dataPath } from "../lib/jsonfile.js"
import { exists, readBlob } from "../lib/storage.js"

const router = new Hono()

// 白名单子目录
const ALLOWED_DIRS = [
  "声母",
  "韵母",
  "整体认读音节",
  "单韵母声调",
  "复韵母声调",
  "鼻韵母声调",
  "整体认读声调",
  "特殊韵母声调",
]

const AUDIO_DIR = dataPath("pinyin_audio")

router.get("/", async (c) => {
  const file = c.req.query("file") ?? ""
  const parts = file.split("/")
  if (parts.length !== 2) return c.json({ detail: "参数格式错误" }, 400)
  const [dir, name] = parts
  if (!ALLOWED_DIRS.includes(dir)) return c.json({ detail: "目录不允许" }, 400)
  if (!name.endsWith(".mp3")) return c.json({ detail: "仅支持 mp3" }, 400)
  if (name.includes("\\") || name.includes("..")) return c.json({ detail: "非法路径" }, 400)
  const key = `${AUDIO_DIR}/${dir}/${name}`
  if (!(await exists(key))) return c.json({ detail: "文件不存在" }, 404)
  const data = await readBlob(key)
  if (!data) return c.json({ detail: "文件不存在" }, 404)
  // 缓存头：chip 点击高频路径，音频文件内容不变，让浏览器直接命中本地缓存
  return new Response(data, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=604800" } })
})

export default router
