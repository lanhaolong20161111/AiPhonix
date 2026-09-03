/** 火山引擎 ARK 文生图服务 — 对齐 Python services/ark_image.py（volcengine images API） */
import { cleanSecret, getConfig, getEnv } from "../env.js"

const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

export interface GeneratedImage {
  url: string
  b64_image: string
}

export async function generateImage(opts: {
  prompt: string
  negative_prompt?: string
  size?: string
  n?: number
  stream?: boolean
  watermark?: boolean
}): Promise<GeneratedImage[]> {
  const cfg = getConfig()
  const key = cfg.ark_image.api_key || cleanSecret(getEnv().ARK_API_KEY || "") || ""
  const model = cfg.ark_image.model || getEnv().ARK_MODEL || ""
  if (!model) throw new Error("请配置 ARK_MODEL secret（火山 Ark 端点 ID）")

  const body: Record<string, unknown> = {
    model,
    prompt: opts.prompt,
    size: opts.size ?? "2K",
    n: opts.n ?? 1,
    stream: opts.stream ?? false,
    watermark: opts.watermark ?? true,
    response_format: "url",
  }
  if (opts.negative_prompt) body.negative_prompt = opts.negative_prompt

  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Ark 文生图 API ${res.status}: ${await res.text().catch(() => "")}`)
  }
  const data = (await res.json()) as { data?: { url?: string; b64_image?: string }[] }
  const images: GeneratedImage[] = []
  if (Array.isArray(data.data)) {
    for (const item of data.data) {
      images.push({ url: item.url ?? "", b64_image: item.b64_image ?? "" })
    }
  }
  return images
}
