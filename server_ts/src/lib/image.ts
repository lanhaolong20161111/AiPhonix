/** 图像处理 — sharp 替代 Python PIL（EXIF 方向校正/压缩/裁剪） */
import sharp from "sharp"
import { join, extname, dirname } from "node:path"

/** 应用 EXIF 方向校正，输出统一 JPEG（原文件保持不动，返回新 .jpg 路径） */
export async function autoOrient(imagePath: string): Promise<string> {
  try {
    const base = imagePath.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "")
    const outPath = `${base}.jpg`
    await sharp(imagePath)
      .rotate() // 自动应用 EXIF Orientation
      .jpeg({ quality: 92 })
      .toFile(outPath)
    return outPath
  } catch (e) {
    console.warn("[image] autoOrient 跳过:", (e as Error).message)
    return imagePath
  }
}

/** 压缩图片到目标宽度内，输出 JPEG（返回 Buffer） */
export async function compressImage(imagePath: string, maxWidth = 1600, quality = 92): Promise<Buffer> {
  return sharp(imagePath).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality }).toBuffer()
}

/** 压缩并保存到指定路径，返回输出路径 */
export async function compressImageToFile(
  imagePath: string,
  outPath: string,
  maxWidth = 1600,
  quality = 92
): Promise<string> {
  await sharp(imagePath).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality }).toFile(outPath)
  return outPath
}

/** 多模态识图预处理：长边限制 1440px、JPEG 质量 80（对齐 doubao-seed-2-1-turbo OCR 提速优化）。
 * 不放大；直接替代原图 base64 上传，砍掉大图的 visual token 量，降低 TTFT。
 * 与 server_cf/src/lib/image.ts#preprocessForVision 语义一致（CF 用 @jsquash 等价实现）。 */
export async function preprocessForVision(imagePath: string): Promise<Buffer> {
  return sharp(imagePath)
    .rotate() // 应用 EXIF Orientation
    .resize({ width: 1440, height: 1440, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
}

/** 将图片 buffer 转 base64 data URL（供豆包/多模态 API 使用） */
export function toDataUrl(buffer: Buffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${buffer.toString("base64")}`
}

/** 判断文件扩展名是否为受支持图片 */
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]
export function isAllowedImageExt(filename: string): boolean {
  return ALLOWED_EXT.includes(extname(filename).toLowerCase())
}

export function safeJoin(dir: string, name: string): string {
  // 防目录穿越
  const base = name.split(/[\\/]/).pop() || ""
  return join(dir, base)
}
