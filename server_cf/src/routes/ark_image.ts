/** 火山引擎文生图路由 — POST /api/v1/image-generations（对齐 Python routes/ark_image.py） */
import { Hono } from "hono"
import { generateImage } from "../lib/ark_image.js"
import { requireAuth } from "../middleware/auth.js"

const router = new Hono()

router.post("/image-generations", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const prompt = String(body?.prompt ?? "").trim()
  if (!prompt) return c.json({ detail: "prompt 不能为空" }, 422)
  try {
    const images = await generateImage({
      prompt,
      negative_prompt: String(body?.negative_prompt ?? ""),
      size: String(body?.size ?? "2K"),
      n: Number(body?.n ?? 1),
      stream: Boolean(body?.stream ?? false),
      watermark: body?.watermark === undefined ? true : Boolean(body.watermark),
    })
    return c.json({ images, total: images.length })
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    if (msg.includes("ARK_MODEL") || msg.includes("model")) {
      return c.json({ detail: msg }, 503)
    }
    return c.json({ detail: `生成失败: ${msg}` }, 500)
  }
})

export default router
