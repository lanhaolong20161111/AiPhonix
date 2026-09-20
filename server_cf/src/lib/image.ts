/** 图像处理 — Cloudflare 版
 *
 * ⚠️ 结论（2026-09-15 实测）：**Worker 侧不做任何像素处理**，本模块是纯透传实现。
 *
 * 历史与踩坑（别再回头踩）：
 * 1) 这里原用 @jsquash(WASM) 替代 sharp 做解码/EXIF 旋转/缩放/重编码。但 workerd **禁止运行时编译 wasm**，
 *    @jsquash 默认在运行时取 .wasm 字节再 instantiate → 必抛
 *    `WebAssembly.instantiate(): Wasm code generation disallowed by embedder`。
 *    后果：autoOrient / preprocessForVision 静默降级成「不处理」（被各自的 catch 吞掉），
 *    而 compressImage 曾把异常直接抛给识别主链路 → 前端只看到
 *    「图片识别失败（诊断：豆包识图: Wasm code generation disallowed by embedder）」。
 * 2) 按 @jsquash 官方「Usage in Cloudflare Workers」改成**静态 import .wasm**（wrangler CompiledWasm
 *    在构建期编译成 WebAssembly.Module）+ 显式 `init(module)` 注入后，wasm 确实能跑了
 *    （staging 日志不再有降级告警）。但随即撞上 Worker 的 CPU 限制：同一张 1200×1700 PNG 时好时坏地
 *    返回 503 `error code: 1102`（Exceeded CPU Limit），连不带图片的 /auth/register 都偶发 503
 *    —— 约 1.2MB 的 wasm 把**冷启动/首次调用的 CPU** 顶到超限，属平台硬约束，调不动。
 * 3) 而这些处理换来的收益几乎为零：客户端上传前已把图压到 1600px/0.85 的 JPEG
 *    （web/src/lib/imageCompress.ts，JPEG≤800KB 直接原样上传），服务端再压到 1440 属于白付 CPU。
 *
 * 所以本模块现在的语义（函数名保留，只为不动调用方）：
 * - autoOrient：返回原 key；EXIF 方向由**客户端**烘焙进像素（imageCompress.ts 里的 canvas 旋转）
 * - compressImage：返回原图字节；compressImageToFile：返回原 key（不写副本 —— 避免出现
 *   「扩展名 .jpg 但字节是 PNG」的副本，下游按扩展名判定 MIME）
 * - preprocessForVision：返回原图字节（多模态识图直接用原图）
 * - toDataUrl / keyToDataUrl / isAllowedImageExt / safeJoin / sniffImageKind 不变
 */
import { readBlob, toBase64 } from "./storage.js"

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

// ── 格式嗅探（按魔数，不看扩展名） ──

function sniff(buf: Uint8Array): "jpeg" | "png" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg"
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png"
  return null
}

export { sniff as sniffImageKind }

// ── 对外 API（路径参数实为 R2 key） ──

/** 「EXIF 方向校正 → 输出统一 JPEG」的 Cloudflare 版：**原样返回原 key**。
 *  方向由客户端烘焙（imageCompress.ts）；这里只保留一个告警，便于发现「客户端漏了转正」的图。 */
export async function autoOrient(imageKey: string): Promise<string> {
  try {
    const raw = await readBlob(imageKey)
    if (!raw) return imageKey
    const buf = new Uint8Array(raw)
    if (sniff(buf) === "jpeg") {
      const o = readExifOrientation(buf)
      if (o !== 1) {
        console.warn(`[image] 图片带 EXIF 方向 ${o} 且未被客户端烘焙，Worker 不再旋转，按原样送识别: ${imageKey}`)
      }
    }
  } catch (e) {
    console.warn("[image] autoOrient 检查失败（忽略）:", (e as Error).message)
  }
  return imageKey
}

/** 读取图片字节（Cloudflare 版不压缩；保留原签名以便调用方无感）。
 *  降级约定：任何情况下都返回「原图字节」，绝不抛 wasm 之类的底层异常 —— 该异常曾污染识别诊断串。 */
export async function compressImage(imageKey: string, _maxWidth = 1600, _quality = 92): Promise<Buffer> {
  const raw = await readBlob(imageKey)
  if (!raw) throw new Error(`图片不存在: ${imageKey}`)
  return Buffer.from(new Uint8Array(raw))
}

/** 「压缩并写入 R2」的 Cloudflare 版：**直接返回原 key**（不写副本）。
 *  不写 `.jpg` 副本很重要：原图是 PNG 时若按 .jpg 名义落盘，下游按扩展名取 MIME 就会 mime 与字节不符。 */
export async function compressImageToFile(
  imageKey: string,
  _outKey: string,
  _maxWidth = 1600,
  _quality = 92
): Promise<string> {
  return imageKey
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

/** 多模态识图预处理：Cloudflare 版**原样直传**（原「长边 1440 + jpeg80」依赖 wasm，已按文件头所述禁用）。
 *  上游客户端已把图压到 1600px/0.85，原图直传的 visual token 与压缩后相差无几。 */
export async function preprocessForVision(imageKey: string): Promise<Buffer> {
  const raw = await readBlob(imageKey)
  if (!raw) throw new Error(`图片不存在: ${imageKey}`)
  const buf = new Uint8Array(raw)
  if (!sniff(buf)) throw new Error("不支持的图片格式（仅 jpeg/png 可处理）")
  return Buffer.from(buf)
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
