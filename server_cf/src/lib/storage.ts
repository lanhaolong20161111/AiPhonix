/**
 * 文件存储 — Cloudflare 版：R2（替代 node:fs）。
 * 本地绝对路径 / 相对路径 统一规范化成 R2 key。
 * 例：C:\...\shared\data\ai_chinese_images\x.jpg → data/ai_chinese_images/x.jpg
 *     C:\...\shared\static\web\index.html    → static/web/index.html
 *     C:\...\shared\downloads\AiPhonix.apk   → downloads/AiPhonix.apk
 */
import { getEnv } from "../env.js"

export function toKey(path: string): string {
  let p = path.replace(/\\/g, "/")
  // 去掉盘符 E:/ 之类
  p = p.replace(/^[a-zA-Z]:\//, "")
  // 1) 先按段去除 . 和 ..，彻底消除路径遍历——无论后续正则如何贪婪都不会越界写其它前缀
  const segs = p.split("/").filter((s) => s !== "" && s !== "." && s !== "..")
  const norm = segs.join("/")
  // 2) 取首个 shared/ 或首个 <data|static|cache|downloads>/ 之后的部分作为 R2 key
  //    （非贪婪 .*? 保证命中「第一个」前缀，避免 data/x/../static/y 被回退到 static/ 命名空间投毒）
  const m = norm.match(/^(?:.*?\/)?shared\/(.+)$/)
  if (m) return m[1]
  const d = norm.match(/^(?:.*?\/)?(data|static|cache|downloads)\/(.+)$/)
  if (d) return `${d[1]}/${d[2]}`
  return norm
}

/** 读二进制 */
export async function readBlob(key: string): Promise<ArrayBuffer | null> {
  const obj = await getEnv().FILES.get(toKey(key))
  if (!obj) return null
  return obj.arrayBuffer()
}

/** 读文本 */
export async function readText(key: string): Promise<string | null> {
  const obj = await getEnv().FILES.get(toKey(key))
  if (!obj) return null
  return obj.text()
}

/** 写二进制（支持 ArrayBuffer / TypedArray / 字符串 / Blob / ReadableStream? 由 R2 put 判定） */
export async function writeBlob(key: string, data: ArrayBuffer | Uint8Array | string, contentType?: string): Promise<void> {
  await getEnv().FILES.put(toKey(key), data as ArrayBuffer, contentType ? { httpMetadata: { contentType } } : undefined)
}

/** 写文本 */
export async function writeText(key: string, text: string, contentType = "application/json"): Promise<void> {
  await getEnv().FILES.put(toKey(key), text, { httpMetadata: { contentType } })
}

/** 是否存在 */
export async function exists(key: string): Promise<boolean> {
  return (await getEnv().FILES.head(toKey(key))) !== null
}

/** 列出某前缀下所有 key */
export async function listKeys(prefix: string): Promise<string[]> {
  const res = await getEnv().FILES.list({ prefix: toKey(prefix) })
  return res.objects.map((o) => o.key)
}

/** 删除 */
export async function removeBlob(key: string): Promise<void> {
  await getEnv().FILES.delete(toKey(key))
}

/** 二进制 → base64（Workers 版，不依赖 Buffer.toString(encoding)） */
export function toBase64(data: Uint8Array | ArrayBuffer): string {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk))
  }
  return btoa(bin)
}
