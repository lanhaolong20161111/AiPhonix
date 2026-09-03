/**
 * 客户端图片压缩 / 缩放 — 识别上传前调用，减小请求体积。
 *
 * 背景：识别接口（/ai-chinese|ai-homework/parse-image）服务端 Ark OCR 在 1400px 已能整页识别，
 * 但前端此前直接上传「原图」（平板高清拍照常 3000–4000px、数 MB）。大图上传慢，
 * 客户端 60s 超时容易在平板上触发（手机小图能跑完），表现为 "signal is aborted without reason"。
 * 这里在上传前压到最长边 1600px 的 JPEG（质量 0.85），体积通常从数 MB 降到 ~300KB，
 * 既加速上传也缩短服务端 OCR 耗时，平板/手机都稳。
 *
 * 注意：本函数只缩放重编码，不改变已应用的方向（调用方传入的 blob 已是转正后的）。
 */

import { parseExifOrientation } from "./imageOrientation"

/** 用 <img> 解码（老 WebView / 不支持 createImageBitmap 的浏览器兜底），返回解码后的尺寸。 */
function decodeViaImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("image decode failed"))
    }
    img.src = url
  })
}

/** 取解码后的像素源 + 原始宽高：优先 createImageBitmap，失败用 <img> 兜底。 */
async function decodeSource(
  file: Blob,
): Promise<{ source: ImageBitmap | HTMLImageElement; width: number; height: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "none",
      }).catch(() => createImageBitmap(file))
      return { source: bitmap, width: bitmap.width, height: bitmap.height }
    } catch {
      /* fall through to <img> */
    }
  }
  try {
    const img = await decodeViaImage(file)
    return { source: img, width: img.naturalWidth, height: img.naturalHeight }
  } catch {
    return null
  }
}

/** 把已解码的源画到缩略 canvas（只绘制，不编码）。失败返回 null。
 * source 可以是 ImageBitmap / HTMLImageElement / HTMLCanvasElement（二次压缩复用）。 */
function drawToCanvas(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
  maxDim: number,
): HTMLCanvasElement | null {
  const scale = Math.min(1, maxDim / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

/** canvas → JPEG blob */
function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
}

/**
 * 把图片压缩到最长边 maxDim 以内，输出 JPEG。非浏览器环境或失败时回退透传原文件。
 *
 * 提速两点（2026-09-01）：
 * 1. **小图（≤300KB）直接跳过压缩**。压缩要 decode + draw + encode 三步，平板 CPU 上 1-4s，
 *    而小图本就够小、压缩几乎无收益，直接上传更快也更省电。
 * 2. 平板保护：首轮后体积仍 > 1.5MB 时再压一轮（1280px / 0.7），但**从已绘制的 canvas 直接再缩放**，
 *    不再重新 decode 一遍 JPEG（解码是三步里最贵的一步，旧实现在这里重复付了一次）。
 */
export async function compressImageFile(
  file: File | Blob,
  maxDim = 1600,
  quality = 0.85,
): Promise<Blob> {
  // 非浏览器（如单测 / SSR）直接透传
  if (typeof document === "undefined" || typeof HTMLCanvasElement === "undefined") {
    return file
  }
  // 小图跳过压缩：省掉平板上 1-4s 的 decode+draw+encode，体积收益可忽略
  if (file.size <= 300_000) return file
  try {
    // 取原始像素：优先 imageOrientation:"none" 避免浏览器重复应用 EXIF。
    // 平板部分 WebView 无 createImageBitmap 或对超大图 decode 失败 → 用 <img> 兜底解码，
    // 确保压到 ~300KB 的小 JPEG 再上传，而不是把数 MB 原图丢给 120s 超时的请求。
    const decoded = await decodeSource(file as Blob)
    if (!decoded) return file
    const { source, width, height } = decoded

    const canvas = drawToCanvas(source, width, height, maxDim)
    if ("close" in source) (source as ImageBitmap).close()
    if (!canvas) return file

    let blob = await canvasToJpeg(canvas, quality)

    // 体积保护：仍过大则从已绘制的 canvas 再缩一轮（不重新解码 JPEG）
    if (blob && blob.size > 1_500_000) {
      const c2 = drawToCanvas(canvas, canvas.width, canvas.height, 1280)
      if (c2) {
        const reBlob = await canvasToJpeg(c2, 0.7)
        if (reBlob) blob = reBlob
      }
    }

    return blob ?? file
  } catch {
    // 任何异常都回退原文件，不阻断识别
    return file
  }
}

/**
 * 单次图像处理（2026-09-02）：EXIF 转正 + 缩放 + JPEG 编码合并为一次 decode→draw→encode。
 * 替代此前「页面 orientImageFile 重编码一次 → parseImage 内 compressImageFile 再解码
 * 再编码」的双重处理（平板上每次 decode+encode 约 1-2s，双重处理白付一遍）。
 *
 * 快路径：JPEG + 方向正常 + ≤800KB → 原样返回（零解码零编码；≤800KB 上传够快，
 * 服务端 OCR/区域裁剪本就会再处理尺寸，不必强压到 1600px）。
 *
 * 变换逻辑与 imageOrientation.ts 的 orientImageFile 一致：
 * 8 种 EXIF orientation + 「无方向标签横拍竖用」启发式（宽/高 > 1.3 转 90°）。
 * 失败一律回退原文件，绝不阻断识别。
 */
export async function prepareImageFile(
  file: File | Blob,
  maxDim = 1600,
  quality = 0.85,
): Promise<Blob> {
  if (typeof document === "undefined" || typeof HTMLCanvasElement === "undefined") return file

  // 解析 EXIF orientation（非 JPEG / 解析失败 → 1）
  let orientation = 1
  try {
    orientation = parseExifOrientation(await file.arrayBuffer())
  } catch {
    orientation = 1
  }

  // 快路径：方向正常 + 已是 JPEG + 体积可接受 → 直接上传，同时保住服务端
  // 「按上传字节 sha256」的缓存命中（同图重发字节一致）
  const isJpeg = file.type === "image/jpeg"
  if (isJpeg && orientation === 1 && file.size <= 800_000) return file

  try {
    const decoded = await decodeSource(file)
    if (!decoded) return file
    const { source, width, height } = decoded

    const rot90 = orientation >= 5 && orientation <= 8
    const heuristic90 = orientation === 1 && width > height && width / height > 1.3
    const flip = orientation === 2 || orientation === 3 || orientation === 4
    const scale = Math.min(1, maxDim / Math.max(width, height))
    if (!rot90 && !heuristic90 && !flip && scale >= 1) {
      // 方向/尺寸都合格：原样返回，零编码（PNG 截图等非 JPEG 也直接上传）
      if ("close" in source) (source as ImageBitmap).close()
      return file
    }

    const dw = width * scale
    const dh = height * scale
    const cw = rot90 || heuristic90 ? dh : dw
    const chh = rot90 || heuristic90 ? dw : dh
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(cw))
    canvas.height = Math.max(1, Math.round(chh))
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      if ("close" in source) (source as ImageBitmap).close()
      return file
    }
    // 变换矩阵（对齐 orientImageFile 的 8 种情形），最后统一 drawImage 缩放绘制
    if (rot90 || heuristic90) {
      switch (orientation) {
        case 5:
          ctx.translate(canvas.width, 0)
          ctx.scale(-1, 1)
          ctx.rotate(Math.PI / 2)
          break
        case 6:
          ctx.translate(canvas.width, 0)
          ctx.rotate(Math.PI / 2)
          break
        case 7:
          ctx.translate(canvas.width, 0)
          ctx.rotate(Math.PI / 2)
          ctx.translate(canvas.width, 0)
          ctx.scale(-1, 1)
          break
        case 8:
          ctx.translate(0, canvas.height)
          ctx.rotate(-Math.PI / 2)
          break
        default:
          // 横拍竖用启发式（无方向标签宽图转 90°）
          ctx.translate(canvas.width, 0)
          ctx.rotate(Math.PI / 2)
          break
      }
    } else if (flip) {
      if (orientation === 2) {
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
      } else if (orientation === 3) {
        ctx.translate(canvas.width, canvas.height)
        ctx.rotate(Math.PI)
      } else {
        ctx.translate(0, canvas.height)
        ctx.scale(1, -1)
      }
    }
    ctx.drawImage(source, 0, 0, dw, dh)
    if ("close" in source) (source as ImageBitmap).close()

    let blob = await canvasToJpeg(canvas, quality)
    // 体积保护：仍过大则从已绘制 canvas 再缩一轮（不重新解码）
    if (blob && blob.size > 1_500_000) {
      const c2 = drawToCanvas(canvas, canvas.width, canvas.height, 1280)
      if (c2) {
        const reBlob = await canvasToJpeg(c2, 0.7)
        if (reBlob) blob = reBlob
      }
    }
    return blob ?? file
  } catch {
    return file
  }
}
