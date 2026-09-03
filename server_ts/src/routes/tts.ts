/** TTS 路由 — /api/v1/tts/synthesize（百度 TTS，返回 MP3 blob + 磁盘缓存） */
import { Hono } from "hono"
import { join } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { getConfig, CACHE_DIR } from "../env.js"
import { BaiduTTSService } from "../lib/baiduTts.js"
import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(HERE, "../../")

let svc: BaiduTTSService | null = null
function getTts(): BaiduTTSService | null {
  if (!svc) {
    const cfg = getConfig()
    if (!cfg.baidu_tts.api_key || !cfg.baidu_tts.secret_key) return null
    // 缓存落到 server_ts 自有目录（shared/cache/tts），不再写入已退役的 Python 目录，
    // 避免双端脑裂 / 污染遗留资产——P1-8
    const cacheDir = join(CACHE_DIR, "tts")
    svc = new BaiduTTSService(cfg.baidu_tts.app_id, cfg.baidu_tts.api_key, cfg.baidu_tts.secret_key, cacheDir)
  }
  return svc
}

// POST /api/v1/tts/synthesize
router.post("/tts/synthesize", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "")
  const speaker = String(body?.speaker ?? "0")
  const speed = Number(body?.speed ?? 5)
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  const tts = getTts()
  if (!tts) return c.json({ detail: "服务端未配置百度 TTS" }, 500)
  try {
    const audio = await tts.synthesize(text, speaker, speed)
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600" } })
  } catch (e) {
    return c.json({ detail: `TTS 合成失败: ${(e as Error).message}` }, 500)
  }
})

export default router
