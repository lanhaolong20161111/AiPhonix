/** TTS 路由 — /api/v1/tts/synthesize（百度 TTS，返回 MP3 blob + 磁盘缓存）
 *  engine=doubao 时走豆包 TTS（火山语音，默认 seed-audio-1.0），失败自动回退百度。 */
import { Hono } from "hono"
import { join } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { getConfig, CACHE_DIR } from "../env.js"
import { BaiduTTSService } from "../lib/baiduTts.js"
import { DoubaoTTSService } from "../lib/doubaoAudio.js"
import { synthesizeStream } from "../lib/baiduTtsStream.js"
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

let dsvc: DoubaoTTSService | null = null
let dsvcKey = ""
function getDoubao(): DoubaoTTSService | null {
  const cfg = getConfig()
  if (!cfg.volc_tts.api_key) return null
  const key = `${cfg.volc_tts.api_key}|${cfg.volc_tts.engine}`
  if (!dsvc || dsvcKey !== key) {
    dsvc = new DoubaoTTSService(cfg.volc_tts.api_key, cfg.volc_tts.engine, join(CACHE_DIR, "tts", "volc"))
    dsvcKey = key
  }
  return dsvc
}

// POST /api/v1/tts/synthesize
router.post("/tts/synthesize", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "")
  const speaker = String(body?.speaker ?? "6221")
  const speed = Number(body?.speed ?? 5)
  /** 引擎：baidu（默认）| doubao（豆包 TTS，失败回退百度） */
  const engine = body?.engine === "doubao" ? "doubao" : "baidu"
  if (!text) return c.json({ detail: "文本不能为空" }, 422)

  // 豆包引擎：缓存/合成在 DoubaoTTSService 内部，失败回退百度，保证页面不哑火。
  if (engine === "doubao") {
    const doubao = getDoubao()
    if (doubao) {
      try {
        const audio = await doubao.synthesize(text)
        return new Response(audio, {
          headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600", "X-Tts-Source": "doubao" },
        })
      } catch (e) {
        console.warn(`[tts] 豆包引擎失败，回退百度: ${(e as Error).message}`)
      }
    } else {
      console.warn("[tts] 未配置豆包 TTS（volc_tts.api_key），回退百度")
    }
  }

  const tts = getTts()
  if (!tts) return c.json({ detail: "服务端未配置百度 TTS" }, 500)
  try {
    const audio = await tts.synthesize(text, speaker, speed)
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600" } })
  } catch (e) {
    return c.json({ detail: `TTS 合成失败: ${(e as Error).message}` }, 500)
  }
})

// POST /api/v1/tts/stream — 百度流式文本在线合成（chunked mp3 分片，降低首音延迟）
router.post("/tts/stream", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "")
  const speaker = String(body?.speaker ?? "6221")
  const speed = Number(body?.speed ?? 5)
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  if (body?.engine === "doubao") return c.json({ detail: "doubao 引擎不支持流式合成", fallback: true }, 409)
  try {
    const stream = await synthesizeStream(text, speaker, speed)
    return new Response(stream, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Tts-Stream": "1" },
    })
  } catch (e) {
    return c.json({ detail: `流式合成失败: ${(e as Error).message}`, fallback: true }, 502)
  }
})

export default router
