/** OCR 多 API fallback 链（Cloudflare 版：图片从 R2 读取，其余与 server_ts 一致）
 *
 * 调用顺序：
 * 1. 腾讯云通用印刷体 OCR（GeneralBasicOCR，每月 1000 次免费）
 * 2. 百度通用文字识别（general_basic，每天 500 次免费）
 * 全部失败返回空字符串（与原 ocrFallback 行为一致）
 */
import { createHmac, createHash } from "node:crypto"
import { readBlob, toKey, toBase64 } from "./storage.js"
import { getConfig } from "../env.js"

// ── 腾讯云 OCR（TC3-HMAC-SHA256 签名） ──

const TENCENT_OCR_HOST = "ocr.tencentcloudapi.com"
const TENCENT_OCR_ENDPOINT = `https://${TENCENT_OCR_HOST}`

function sha256Hex(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex")
}

function hmacSha256(key: Buffer, message: string): Buffer {
  return createHmac("sha256", key).update(message, "utf8").digest()
}

async function tencentOcr(imageBase64: string): Promise<string> {
  const cfg = getConfig()
  const secretId = cfg.tencent.secret_id
  const secretKey = cfg.tencent.secret_key
  if (!secretId || !secretKey) throw new Error("腾讯云 OCR 未配置 secret_id/secret_key")

  const service = "ocr"
  const action = "GeneralBasicOCR"
  const version = "2018-11-19"
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify({ ImageBase64: imageBase64 })

  const canonicalUri = "/"
  const canonicalQueryString = ""
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_OCR_HOST}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = "content-type;host;x-tc-action"
  const hashedPayload = sha256Hex(payload)
  const canonicalRequest = `POST\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`

  const algorithm = "TC3-HMAC-SHA256"
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`

  const secretDate = hmacSha256(Buffer.from(`TC3${secretKey}`, "utf8"), date)
  const secretService = hmacSha256(secretDate, service)
  const secretSigning = hmacSha256(secretService, "tc3_request")
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex")

  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Host": TENCENT_OCR_HOST,
    "X-TC-Action": action,
    "X-TC-Version": version,
    "X-TC-Timestamp": String(timestamp),
    "Authorization": authorization,
  }

  const resp = await fetch(TENCENT_OCR_ENDPOINT, {
    method: "POST",
    headers,
    body: payload,
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) throw new Error(`腾讯 OCR HTTP ${resp.status}`)
  const data = (await resp.json()) as {
    Response?: {
      Error?: { Message?: string }
      TextDetections?: Array<{ DetectedText?: string }>
    }
  }
  const r = data.Response
  if (!r) throw new Error("腾讯 OCR 响应格式异常")
  if (r.Error) throw new Error(`腾讯 OCR 错误: ${r.Error.Message ?? "未知"}`)
  const lines = (r.TextDetections ?? []).map((d) => d.DetectedText ?? "")
  return lines.join("\n").trim()
}

// ── 百度通用文字识别 ──

const BAIDU_OCR_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic"

async function baiduOcr(imageBase64: string): Promise<string> {
  const cfg = getConfig()
  const apiKey = cfg.baidu_tts.api_key
  const secretKey = cfg.baidu_tts.secret_key
  if (!apiKey || !secretKey) throw new Error("百度 OCR 未配置 api_key/secret_key")

  const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`
  const tokenResp = await fetch(tokenUrl, { method: "POST", signal: AbortSignal.timeout(10000) })
  if (!tokenResp.ok) throw new Error(`获取百度 token 失败: ${tokenResp.status}`)
  const tokenData = (await tokenResp.json()) as { access_token?: string; error?: string }
  if (tokenData.error || !tokenData.access_token) throw new Error(`获取百度 token 失败: ${tokenData.error ?? "无 token"}`)

  const body = new URLSearchParams({
    image: imageBase64,
    language_type: "CHN_ENG",
  })
  const resp = await fetch(`${BAIDU_OCR_URL}?access_token=${tokenData.access_token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) throw new Error(`百度 OCR HTTP ${resp.status}`)
  const data = (await resp.json()) as {
    error_code?: number
    error_msg?: string
    words_result?: Array<{ words?: string }>
  }
  if (data.error_code) throw new Error(`百度 OCR 错误: ${data.error_msg ?? data.error_code}`)
  const lines = (data.words_result ?? []).map((w) => w.words ?? "")
  return lines.join("\n").trim()
}

/**
 * OCR fallback 链：腾讯云 → 百度。全部失败返回空字符串。
 * imagePath 为 R2 key（本地绝对路径/相对路径会自动归一化）。
 */
export async function ocrChain(imagePath: string): Promise<string> {
  let imageBase64: string
  try {
    const buf = await readBlob(imagePath)
    if (!buf) {
      console.warn(`[ocr] 读取图片失败: R2 无此对象 ${toKey(imagePath)}`)
      return ""
    }
    imageBase64 = toBase64(new Uint8Array(buf))
  } catch (e) {
    console.warn(`[ocr] 读取图片失败: ${(e as Error).message}`)
    return ""
  }

  try {
    const text = await tencentOcr(imageBase64)
    if (text) {
      console.info(`[ocr] 腾讯云 OCR 成功, 文本长度 ${text.length}`)
      return text
    }
  } catch (e) {
    console.warn(`[ocr] 腾讯云 OCR 失败: ${(e as Error).message}`)
  }

  try {
    const text = await baiduOcr(imageBase64)
    if (text) {
      console.info(`[ocr] 百度 OCR 成功, 文本长度 ${text.length}`)
      return text
    }
  } catch (e) {
    console.warn(`[ocr] 百度 OCR 失败: ${(e as Error).message}`)
  }

  return ""
}
