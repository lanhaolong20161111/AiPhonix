/**
 * Workers 环境补充类型：@cloudflare/workers-types 不含 DOM 的 ImageData，
 * 但 workerd 运行时支持（@jsquash 依赖它）。
 */
declare class ImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  constructor(width: number, height: number)
  constructor(data: Uint8ClampedArray, width: number, height?: number)
}
