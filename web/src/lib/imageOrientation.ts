/**
 * 图片方向纠正（对齐 Android OrientedBitmap）：
 * - 解析 JPEG EXIF orientation，手机横拍/倒置照片自动转正
 * - 无方向标签的旧照片（课本/作业横拍）：宽明显大于高 → 视为横拍竖用，自动转 90°
 * 识别前先转正再上传，保证服务端 OCR/识图看到的是正向内容。
 *
 * 实现：createImageBitmap(imageOrientation:"none") 取原始像素（不依赖浏览器
 * 自动应用 EXIF，跨浏览器/电脑手机一致），再按 EXIF orientation 手动旋转。
 */

/** 解析 JPEG EXIF Orientation（1-8）；非 JPEG 或解析失败返回 1（正常） */
export function parseExifOrientation(buffer: ArrayBuffer): number {
  const dv = new DataView(buffer)
  if (dv.byteLength < 2 || dv.getUint16(0, false) !== 0xffd8) return 1 // 非 JPEG

  let offset = 2
  const len = dv.byteLength
  while (offset + 4 <= len) {
    const marker = dv.getUint16(offset, false)
    const size = dv.getUint16(offset + 2, false)
    if (marker === 0xffe1) {
      // APP1: Exif
      if (offset + 8 <= len) {
        // "Exif\0\0"
        const header =
          dv.getUint8(offset + 4) === 0x45 &&
          dv.getUint8(offset + 5) === 0x78 &&
          dv.getUint8(offset + 6) === 0x69 &&
          dv.getUint8(offset + 7) === 0x66
        if (header) {
          const tiffStart = offset + 10
          const endian = dv.getUint16(tiffStart, false)
          const little = endian === 0x4949 // "II"
          if (endian === 0x4949 || endian === 0x4d4d) {
            const ifd0 = dv.getUint32(tiffStart + 4, little)
            // TIFF header 8 bytes，IFD0 条目
            const entryCount = dv.getUint16(tiffStart + ifd0, little)
            for (let i = 0; i < entryCount; i++) {
              const entryOffset = tiffStart + ifd0 + 2 + i * 12
              if (entryOffset + 12 > len) break
              const tag = dv.getUint16(entryOffset, little)
              if (tag === 0x0112) {
                // Orientation tag
                return dv.getUint16(entryOffset + 8, little)
              }
            }
          }
        }
      }
    } else if (marker === 0xffd9 || marker === 0xffda) {
      break // 遇到图像数据/结尾，停止
    }
    if (size < 2) break
    offset += 2 + size
  }
  return 1
}

/**
 * 按 EXIF 方向纠正图片：取原始像素 → canvas 手动旋转 → 输出新 Blob。
 * 无 EXIF 方向标签的旧照片：宽/高 > 1.3 视为横拍竖用，自动转 90°。
 */
export async function orientImageFile(file: File): Promise<Blob> {
  const buf = await file.arrayBuffer()
  const orientation = parseExifOrientation(buf)

  // 取原始像素（禁用浏览器自动应用 EXIF，保证手动旋转不重复）
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "none" })
  } catch {
    // 不支持 imageOrientation 选项时回退：用 Image 加载（浏览器可能已应用 EXIF）
    return orientViaImage(file, orientation)
  }

  const { width, height } = bitmap
  const swap = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8
  const canvasW = swap ? height : width
  const canvasH = swap ? width : height

  const canvas = document.createElement("canvas")
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    return file
  }

  // 手动按 EXIF orientation 旋转（对齐 Android Matrix）
  switch (orientation) {
    case 2: // FLIP_HORIZONTAL
      ctx.translate(canvasW, 0)
      ctx.scale(-1, 1)
      break
    case 3: // ROTATE_180
      ctx.translate(canvasW, canvasH)
      ctx.rotate(Math.PI)
      break
    case 4: // FLIP_VERTICAL
      ctx.translate(0, canvasH)
      ctx.scale(1, -1)
      break
    case 5: // TRANSPOSE: 旋转90 + 水平翻转
      ctx.translate(canvasW, 0)
      ctx.scale(-1, 1)
      ctx.rotate(Math.PI / 2)
      break
    case 6: // ROTATE_90
      ctx.translate(canvasW, 0)
      ctx.rotate(Math.PI / 2)
      break
    case 7: // TRANSVERSE: 旋转90 + 垂直翻转
      ctx.translate(canvasW, 0)
      ctx.rotate(Math.PI / 2)
      ctx.translate(canvasW, 0)
      ctx.scale(-1, 1)
      break
    case 8: // ROTATE_270
      ctx.translate(0, canvasH)
      ctx.rotate(-Math.PI / 2)
      break
    default:
      // 1 = 正常；无方向标签旧照片启发式：横拍竖用转90°
      if (width > height && width / height > 1.3) {
        canvas.width = height
        canvas.height = width
        const ctx2 = canvas.getContext("2d")
        if (ctx2) {
          ctx2.translate(height, 0)
          ctx2.rotate(Math.PI / 2)
          ctx2.drawImage(bitmap, 0, 0)
          bitmap.close()
          return await canvasToBlob(canvas, file)
        }
      }
      break
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return await canvasToBlob(canvas, file)
}

/** 回退路径：不支持 createImageBitmap imageOrientation 时用 Image */
async function orientViaImage(file: File, orientation: number): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    let { width, height } = img
    const swap = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8
    const canvasW = swap ? height : width
    const canvasH = swap ? width : height
    const canvas = document.createElement("canvas")
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext("2d")
    if (!ctx) return file

    switch (orientation) {
      case 3:
        ctx.translate(canvasW, canvasH)
        ctx.rotate(Math.PI)
        break
      case 6:
        ctx.translate(canvasW, 0)
        ctx.rotate(Math.PI / 2)
        break
      case 8:
        ctx.translate(0, canvasH)
        ctx.rotate(-Math.PI / 2)
        break
      default:
        // 启发式：无方向标签横图转90°
        if (width > height && width / height > 1.3) {
          canvas.width = height
          canvas.height = width
          const ctx2 = canvas.getContext("2d")
          if (ctx2) {
            ctx2.translate(height, 0)
            ctx2.rotate(Math.PI / 2)
            ctx2.drawImage(img, 0, 0)
            return await canvasToBlob(canvas, file)
          }
        }
        break
    }
    ctx.drawImage(img, 0, 0)
    return await canvasToBlob(canvas, file)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, fallback: Blob): Promise<Blob> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? fallback), "image/jpeg", 0.92)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("图片加载失败"))
    img.src = url
  })
}

/** 把图片 blob 顺时针旋转 90°（手动调整方向兜底，与 Android "↻" 按钮一致） */
export async function rotateBlob90(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement("canvas")
    canvas.width = img.height
    canvas.height = img.width
    const ctx = canvas.getContext("2d")
    if (!ctx) return blob
    ctx.translate(img.height, 0)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(img, 0, 0)
    return await canvasToBlob(canvas, blob)
  } finally {
    URL.revokeObjectURL(url)
  }
}
