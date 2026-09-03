/** 图像处理 — Cloudflare 版：@jsquash(WASM) 替代 sharp，文件读写走 R2
 *
 * 与 server_ts/src/lib/image.ts 的语义对齐：
 * - autoOrient：EXIF 方向校正 → 输出统一 JPEG（返回新 key，原对象不动）
 * - compressImage / compressImageToFile：等比缩放到最大宽度 + JPEG 压缩
 * - toDataUrl / isAllowedImageExt / safeJoin 不变
 *
 * 快路径：JPEG 且无需处理时直接透传原始字节（省 CPU —— Workers 按 CPU 时间计费）。
 */
import { decode as decodeJpeg, encode as encodeJpeg } from "@jsquash/jpeg"
import { decode as decodePng } from "@jsquash/png"
import resize from "@jsquash/resize"
import { readBlob, writeBlob, toBase64 } from "./storage.js"

// ── EXIF orientation 解析（JPEG APP1/TIFF 0x0112） ──

export function readExifOrientation(buf: Uint8Array): number {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1
  let off = 2
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue }
    const marker = buf[off + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { off += 2; continue }
    if (marker === 0xda || marker === 0xd9) break
    const len = (buf[off + 2] << 8) | buf[off + 3]
    if (len < 2) break
    if (marker === 0xe1) {
      const seg = buf.subarray(off + 4, off + 2 + len)
      if (
        seg.length > 14 &&
        seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66 && seg[4] === 0 && seg[5] === 0
      ) {
        const tiff = seg.subarray(6)
        const little = tiff[0] === 0x49 && tiff[1] === 0x49
        const rd16 = (p: number) => (little ? tiff[p] | (tiff[p + 1] << 8) : (tiff[p] << 8) | tiff[p + 1])
        const rd32 = (p: number) =>
          little
            ? tiff[p] | (tiff[p + 1] << 8) | (tiff[p + 2] << 16) | (tiff[p + 3] << 24)
            : ((tiff[p] << 24) | (tiff[p + 1] << 16) | (tiff[p + 2] << 8) | tiff[p + 3]) >>> 0
        if (tiff.length >= 8) {
          const ifd = rd32(4)
          if (ifd + 2 <= tiff.length) {
            const n = rd16(ifd)
            for (let i = 0; i < n; i++) {
              const e = ifd + 2 + i * 12
              if (e + 12 > tiff.length) break
              if (rd16(e) === 0x0112) {
                const v = rd16(e + 8)
                return v >= 1 && v <= 8 ? v : 1
              }
            }
          }
        }
      }
    }
    off += 2 + len
  }
  return 1
}

// ── 按 EXIF orientation 重排像素（1-8 全覆盖） ──

export function applyOrientation(src: ImageData, orientation: number): ImageData {
  const o = orientation >= 1 && orientation <= 8 ? orientation : 1
  if (o === 1) return src
  const w = src.width
  const h = src.height
  const swap = o >= 5
  const dw = swap ? h : w
  const dh = swap ? w : h
  const dst = new ImageData(dw, dh)
  const sd = src.data
  const dd = dst.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx = x
      let dy = y
      switch (o) {
        case 2: dx = w - 1 - x; break
        case 3: dx = w - 1 - x; dy = h - 1 - y; break
        case 4: dy = h - 1 - y; break
        case 5: dx = y; dy = x; break
        case 6: dx = h - 1 - y; dy = x; break
        case 7: dx = h - 1 - y; dy = w - 1 - x; break
        case 8: dx = y; dy = w - 1 - x; break
        default: break
      }
      const si = (y * w + x) * 4
      const di = (dy * dw + dx) * 4
      dd[di] = sd[si]
      dd[di + 1] = sd[si + 1]
      dd[di + 2] = sd[si + 2]
      dd[di + 3] = sd[si + 3]
    }
  }
  return dst
}

// ── 编解码 ──

function sniff(buf: Uint8Array): "jpeg" | "png" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg"
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png"
  return null
}

async function decodeAny(buf: Uint8Array): Promise<{ image: ImageData; kind: "jpeg" | "png" }> {
  const kind = sniff(buf)
  const ab = buf.slice().buffer
  if (kind === "jpeg") return { image: await decodeJpeg(ab), kind }
  if (kind === "png") return { image: await decodePng(ab), kind }
  throw new Error("不支持的图片格式（仅 jpeg/png 可处理）")
}

async function encodeJpegData(image: ImageData, quality: number): Promise<Buffer> {
  const out = await encodeJpeg(image, { quality })
  return Buffer.from(out)
}

export { decodeAny as decodeImage, encodeJpegData as encodeJpeg, sniff as sniffImageKind }

/** 等比缩放到目标最大宽度内（不放大）。仅 JPEG 输入。 */
async function shrinkIfNeeded(image: ImageData, maxWidth: number): Promise<ImageData | null> {
  if (maxWidth <= 0 || image.width <= maxWidth) return null
  const scale = maxWidth / image.width
  const dw = Math.max(1, Math.round(image.width * scale))
  const dh = Math.max(1, Math.round(image.height * scale))
  return await resize(image, { width: dw, height: dh, fitMethod: "stretch", method: "triangle" })
}

// ── 对外 API（与 server_ts 语义对齐；路径参数实为 R2 key） ──

/** EXIF 方向校正 → 输出统一 JPEG（原对象不动，返回新 <base>.jpg key）。
 * 快路径：JPEG 且方向=1 时直接返回原 key（不重编码）。 */
export async function autoOrient(imageKey: string): Promise<string> {
  try {
    const raw = await readBlob(imageKey)
    if (!raw) return imageKey
    const buf = new Uint8Array(raw)
    const kind = sniff(buf)
    const orientation = kind === "jpeg" ? readExifOrientation(buf) : 1
    if (kind === "jpeg" && orientation === 1) return imageKey
    if (!kind) return imageKey
    const { image } = await decodeAny(buf)
    const fixed = applyOrientation(image, orientation)
    const jpg = await encodeJpegData(fixed, 92)
    const base = imageKey.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "")
    const outKey = `${base}.jpg`
    await writeBlob(outKey, jpg, "image/jpeg")
    return outKey
  } catch (e) {
    console.warn("[image] autoOrient 跳过:", (e as Error).message)
    return imageKey
  }
}

/** 压缩图片到目标宽度内，输出 JPEG（返回 Buffer）。
 * 快路径：JPEG、方向=1、宽度已达要求 → 原始字节透传。 */
export async function compressImage(imageKey: string, maxWidth = 1600, quality = 92): Promise<Buffer> {
  const raw = await readBlob(imageKey)
  if (!raw) throw new Error(`图片不存在: ${imageKey}`)
  const buf = new Uint8Array(raw)
  const kind = sniff(buf)
  const orientation = kind === "jpeg" ? readExifOrientation(buf) : 1

  // JPEG 快路径：无需旋转也无需缩放 → 透传
  if (kind === "jpeg" && orientation === 1) {
    if (maxWidth <= 0) return Buffer.from(buf)
    try {
      const { image } = await decodeAny(buf) // 仅读取宽高（此处仍需解码）
      const shrunk = await shrinkIfNeeded(image, maxWidth)
      if (!shrunk) return Buffer.from(buf)
      return await encodeJpegData(shrunk, quality)
    } catch {
      return Buffer.from(buf)
    }
  }

  const { image } = await decodeAny(buf)
  const fixed = applyOrientation(image, orientation)
  const shrunk = await shrinkIfNeeded(fixed, maxWidth)
  return encodeJpegData(shrunk ?? fixed, quality)
}

/** 压缩并写入 R2 指定 key，返回输出 key */
export async function compressImageToFile(
  imageKey: string,
  outKey: string,
  maxWidth = 1600,
  quality = 92
): Promise<string> {
  const jpg = await compressImage(imageKey, maxWidth, quality)
  await writeBlob(outKey, jpg, "image/jpeg")
  return outKey
}

/** 将图片 buffer 转 base64 data URL（供豆包/多模态 API 使用） */
export function toDataUrl(buffer: Uint8Array | Buffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${toBase64(buffer as Uint8Array)}`
}

/** 判断文件扩展名是否为受支持图片 */
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]
export function isAllowedImageExt(filename: string): boolean {
  const m = filename.match(/\.[a-z0-9]+$/i)
  return m ? ALLOWED_EXT.includes(m[0].toLowerCase()) : false
}

export function safeJoin(dir: string, name: string): string {
  // 防目录穿越（R2 key 版：只取文件名段，POSIX 拼接）
  const base = name.split(/[\\/]/).pop() || ""
  return `${dir.replace(/\/+$/, "")}/${base}`
}

/** 多模态识图预处理：长边限制 1440px、JPEG 质量 80（对齐 doubao-seed-2-1-turbo OCR 提速优化）。
 * 与 server_ts/src/lib/image.ts#preprocessForVision 语义一致；Worker 环境用 @jsquash(WASM) 替代 sharp。
 * 不放大；替代原图 base64 上传，砍掉大图的 visual token 量，降低 TTFT。
 *
 * 快路径：Web 客户端已把图压到 1600px/0.85（prepareImageFile，>1.5MB 还会二次压到 1280/0.7），
 * 上传体积恒 ≤1.5MB。这类图再压到 1440 对 visual token 几乎无收益（1600→1440 约 -10% 边长，
 * 平铺 token 数基本不变），却要白白付一次 WASM 解码+重编码（Workers 按 CPU 计费）。
 * 因此 JPEG + 方向已正 + ≤1.5MB 直接透传原始字节，跳过整个 WASM 流程；
 * 只有大图（手机原图直传等）才走解码/缩放/重编码，保住 token 不爆炸。 */
export async function preprocessForVision(imageKey: string): Promise<Buffer> {
  const raw = await readBlob(imageKey)
  if (!raw) throw new Error(`图片不存在: ${imageKey}`)
  const buf = new Uint8Array(raw)
  const kind = sniff(buf)
  if (!kind) throw new Error("不支持的图片格式（仅 jpeg/png 可处理）")
  // 快路径：JPEG + 方向=1 + 体积小（客户端已压缩）→ 透传原始字节，跳过 WASM。
  if (kind === "jpeg" && readExifOrientation(buf) === 1 && buf.length <= 1_500_000) {
    return Buffer.from(buf)
  }
  const { image } = await decodeAny(buf)
  const fixed = applyOrientation(image, kind === "jpeg" ? readExifOrientation(buf) : 1)
  // 长边 > 1440 才缩放（不放大）
  const longEdge = Math.max(fixed.width, fixed.height)
  let out = fixed
  if (longEdge > 1440) {
    const scale = 1440 / longEdge
    const dw = Math.max(1, Math.round(fixed.width * scale))
    const dh = Math.max(1, Math.round(fixed.height * scale))
    out = await resize(fixed, { width: dw, height: dh, fitMethod: "stretch", method: "triangle" })
  }
  return encodeJpegData(out, 80)
}

/** R2 图片 key → data URL（多模态识图常用） */
export async function keyToDataUrl(imageKey: string, quality = 92): Promise<string | null> {
  const raw = await readBlob(imageKey)
  if (!raw) return null
  const buf = new Uint8Array(raw)
  const kind = sniff(buf)
  const mime = kind === "png" ? "image/png" : "image/jpeg"
  return `data:${mime};base64,${toBase64(buf)}`
}
