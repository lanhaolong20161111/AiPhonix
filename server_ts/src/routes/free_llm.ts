/** 免费 LLM 路由 — POST /api/v1/free-llm/chat（文本 / 文本+图片，需登录；对齐 Python routes/free_llm.py） */
import { Hono } from "hono"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { DATA_DIR } from "../env.js"
import { resolveCurrentUser } from "../middleware/auth.js"
import { getArk } from "../lib/ark.js"

const router = new Hono()
const TIMEOUT_MS = 90000

/** /api/v1/uploads/file/xxx.jpg → data/uploads/xxx.jpg；不合法返回空 */
function resolveLocalPath(imageUrl: string): string {
  const name = imageUrl.split("/").pop() || ""
  if (!name || name.includes("..") || name.includes("/")) return ""
  const path = join(DATA_DIR, "uploads", name)
  return existsSync(path) ? path : ""
}

router.post("/free-llm/chat", async (c) => {
  await resolveCurrentUser(c.req.header("Authorization"))
  const body = await c.req.json().catch(() => null)
  const prompt = String(body?.prompt ?? "").trim()
  if (!prompt) return c.json({ detail: "prompt 不能为空" }, 422)

  // 对齐 PY：未配置 ARK_API_KEY 时显式 503（而非落入 502）
  const ark = getArk()
  if (!ark.enabled) {
    return c.json({ detail: "免费 AI 服务未配置（服务端缺少 ARK_API_KEY）" }, 503)
  }

  const imagePaths = (Array.isArray(body?.image_urls) ? body.image_urls : [])
    .map((u: unknown) => resolveLocalPath(String(u ?? "")))
    .filter(Boolean)

  try {
    const text = await Promise.race([
      ark.chat({ prompt, image_paths: imagePaths }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)
      ),
    ])
    return c.json({ text })
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    if (msg === "timeout") return c.json({ detail: "免费 AI 响应超时，请稍后重试" }, 504)
    return c.json({ detail: `免费 AI 调用失败：${msg}` }, 502)
  }
})

export default router
