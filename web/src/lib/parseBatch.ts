/** 一次多张照片的识别流水线（2026-09-16）
 *
 * 为什么要排队：服务端识图接口一次只吃一张图（multipart 单个 file），"同时识别多张"
 * 只能在客户端编排。**第 1 张必须最先出结果**（孩子拍完就等着看），其余照片不该和它抢
 * 带宽/OCR 配额，所以策略是：
 *
 *   1. 立刻把 N 页骨架写进 store（结果页据此渲染「第 1 张 / 第 2 张 …」标签）；
 *   2. **第 1 张走前台**：转正压缩 → 识别 → 写结果 → 交给调用方跳转结果页；
 *   3. 其余照片在**后台串行**逐张识别（一次只跑一张），每张完成就写回 store，
 *      结果页是 zustand 订阅组件 → 标签状态与正文自动更新，用户无感。
 *
 * 3 的关键前提：跳转是 SPA 路由跳转，JS 不卸载，所以后台任务能一直跑到完 —— 这也是
 * 它比"跳页后重新发请求"更简单可靠的原因。
 *
 * 批次号：新的一批开始（用户又拍了一组）会让旧批次的后台循环自行退出，避免两组结果
 * 互相覆盖同一批 pages。
 */

import { parseImage, type ParseImageResult, type ParseStage } from "../services/aiImage"
import { prepareImageFile } from "./imageCompress"
import { schedulePolyPatch } from "./polyPatch"
import { useParseSessionStore } from "../stores/parseSessionStore"

export type BatchModule = "chinese" | "math" | "english"

/** 批次序号：只有最新一批的后台循环有权继续写 store */
let batchSeq = 0

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 转正 + 压缩，失败时退回原图（与单张路径同口径） */
async function prepareSafe(file: File | Blob): Promise<File | Blob> {
  try {
    return await prepareImageFile(file, 1600, 0.85)
  } catch {
    return file
  }
}

function messageOf(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m || "识别失败，请重试"
}

export interface StartBatchOptions {
  files: (File | Blob)[]
  module: BatchModule
  /** 仅"带图提问"走 no_cache（重拍/重试用），常规拍照走缓存 */
  noCache?: boolean
  /** 第 1 张的阶段回调（输入页进度条用）；后台页不回调，避免 UI 在结果页上乱跳 */
  onStage?: (stage: ParseStage | null) => void
  initialQuestion?: string
  /** 沿用调用方原来的扁平口径：不落 blocks/crops/page_bounds（数学整图识别一直如此，
   *  展示退回题目列表）。不传=按服务端返回的结构化数据落库。 */
  omitStructured?: boolean
}

/** 按调用方口径归一化识别结果（见 omitStructured） */
function normalize(res: ParseImageResult, omitStructured?: boolean): ParseImageResult {
  if (!omitStructured) return res
  return { ...res, blocks: [], crops: [], page_bounds: null }
}

/**
 * 开始一批识别。**返回即代表第 1 张已有结果**（成功 ok=true / 失败带 error），
 * 调用方据此决定是否跳结果页；其余照片在后台继续。
 */
export async function startParseBatch(opts: StartBatchOptions): Promise<{ ok: boolean; error?: string }> {
  const { files, module, noCache = false, onStage, initialQuestion, omitStructured } = opts
  if (!files.length) return { ok: false, error: "没有拿到图片" }
  const mine = ++batchSeq

  // 先用原图 objectURL 占位（结果页立即有缩略图可看），转正压缩后换成处理过的
  useParseSessionStore.getState().beginPages(
    files.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) })),
    module,
    initialQuestion ? { initialQuestion } : {},
  )
  const st = () => useParseSessionStore.getState()

  // ── 第 1 张：前台，优先出结果 ──
  try {
    onStage?.("preparing")
    const first = await prepareSafe(files[0])
    if (mine !== batchSeq) return { ok: false, error: "已开始新的识别" }
    st().setPagePreview(0, URL.createObjectURL(first))
    const res = await parseImage(first, module, noCache, onStage)
    if (mine !== batchSeq) return { ok: false, error: "已开始新的识别" }
    if (!res.text?.trim()) return { ok: false, error: "没识别到文字，换一张更清晰的照片试试～" }
    st().setPageResult(0, res)
    schedulePolyPatch(res, module, 0)
  } catch (e) {
    const msg = `识别失败: ${messageOf(e)}`
    st().setPageError(0, msg)
    return { ok: false, error: msg }
  } finally {
    onStage?.(null)
  }

  // ── 其余照片：后台串行慢慢识别 ──
  if (files.length > 1) {
    void (async () => {
      for (let i = 1; i < files.length; i++) {
        if (mine !== batchSeq) return
        st().setPageStage(i, "preparing")
        try {
          const f = await prepareSafe(files[i])
          if (mine !== batchSeq) return
          st().setPagePreview(i, URL.createObjectURL(f))
          st().setPageStage(i, "recognizing")
          const res: ParseImageResult = await parseImage(f, module, false)
          if (mine !== batchSeq) return
          if (!res.text?.trim()) {
            st().setPageError(i, "没识别到文字，这张可能太模糊了")
          } else {
            const norm = normalize(res, omitStructured)
            st().setPageResult(i, norm)
            schedulePolyPatch(norm, module, i)
          }
        } catch (e) {
          if (mine !== batchSeq) return
          st().setPageError(i, messageOf(e))
        }
        // 张与张之间留一点空隙：结果页可能正在读中文/点读，别把带宽全占了
        await sleep(800)
      }
    })()
  }

  return { ok: true }
}

/** 让当前批次的后台循环停下（用户又发起新识别时由 startParseBatch 内部自增序号即可；
 *  需要显式取消时调用它）。 */
export function cancelParseBatch(): void {
  batchSeq++
}
