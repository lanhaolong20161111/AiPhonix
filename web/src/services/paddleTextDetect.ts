/**
 * PP-OCRv6 文本行检测（切块识图绿框用）— 替代原 OpenCV.js 前端检测。
 *
 * 职责：把整图上传到后端 /ai-chinese/detect-blocks，由后端以 PP-OCRv6 模型检测每行文本，
 * 返回归一化 bbox + 识别文本。前端据此画绿框供用户预览，再决定自动/手动切割。
 *
 * 相比 OpenCV.js 的好处：
 * - 无需下载/解析 10.8MB WASM，移动端加载快、稳定；
 * - 检测准确率远高于 OpenCV 形态学轮廓（PP-OCRv6 是神经网络文本检测器）；
 * - 附带回每行识别文本，可作绿框标签展示。
 */
import { api } from "./api"

export interface TextBlockBox {
  id: number
  x: number // left（相对原图像素）
  y: number // top
  w: number // width
  h: number // height
  /** 归一化坐标 0~1（相对图片宽高），前端渲染绿框用 */
  nx: number
  ny: number
  nw: number
  nh: number
  /** 检测排序（阅读顺序，小→大） */
  order: number
  /** 该行识别文本（PP-OCRv6 返回，可作绿框标签） */
  text?: string
  /** 置信度 0~1 */
  score?: number
}

export interface DetectBlocksResponse {
  width: number
  height: number
  blocks: Array<{
    text: string
    score: number
    nx: number
    ny: number
    nw: number
    nh: number
    order: number
  }>
}

/**
 * 上传图片到后端检测文本块。
 * @param file 图片文件
 * @returns 文本块矩形列表（按阅读顺序排序）
 */
export async function detectTextBlocks(file: File | Blob): Promise<TextBlockBox[]> {
  const form = new FormData()
  const name = file instanceof File && file.name ? file.name : "image.jpg"
  form.append("file", file, name)
  const res = await api<DetectBlocksResponse>("/ai-chinese/detect-blocks", {
    method: "POST",
    body: form,
    timeoutMs: 90000,
  })
  const W = res.width || 1
  const H = res.height || 1
  return (res.blocks ?? []).map((b, i) => ({
    id: i,
    x: Math.round(b.nx * W),
    y: Math.round(b.ny * H),
    w: Math.round(b.nw * W),
    h: Math.round(b.nh * H),
    nx: b.nx,
    ny: b.ny,
    nw: b.nw,
    nh: b.nh,
    order: b.order ?? i,
    text: b.text,
    score: b.score,
  }))
}
