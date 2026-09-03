/** PinyinAudio 路由 — /api/v1/pinyin-audio?file=目录/文件名.mp3（文件服务，白名单目录+防穿越） */
import { Hono } from "hono"
import { join, normalize } from "node:path"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dataPath } from "../lib/jsonfile.js"

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
  const full = normalize(join(AUDIO_DIR, dir, name))
  if (!full.startsWith(normalize(AUDIO_DIR))) return c.json({ detail: "非法路径" }, 400)
  if (!existsSync(full)) return c.json({ detail: "文件不存在" }, 404)
  // 异步读 + 缓存头：chip 点击高频路径，音频文件内容不变，让浏览器直接命中本地缓存
  return new Response(await readFile(full), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=604800" } })
})

export default router
