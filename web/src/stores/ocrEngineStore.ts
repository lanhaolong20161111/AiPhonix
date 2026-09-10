/** 识图模型选择 store（2026-09-02）
 *
 * 背景：原识别模型由服务端 OCR_ENGINE 环境变量「默默」决定（PaddleOCR-VL 优先 / 豆包），
 * 用户无感。现改为识别前由用户在前端显式选择模型，再点识别（「确定」）。
 *
 * 设计：全局 store + localStorage 持久化。用户在某页选了模型，刷新/切页/进切块与自由框选
 * 选择器都沿用同一选择（parseImage 内部读本 store，无需逐层透传 props）。
 *
 * 取值：
 * - auto   ：跟随服务端默认（OCR_ENGINE；当前生产为 paddle 打头阵，失败/超时自动回退豆包）
 * - doubao ：强制豆包多模态（慢网友好）
 * - paddle ：强制 PaddleOCR（专用 OCR，通常 ~1~3s 出全文，版面/表格更准）
 */
import { create } from "zustand"

export type OcrEngine = "auto" | "paddle" | "doubao"

const KEY = "aiphonix_ocr_engine"

function readInitial(): OcrEngine {
  try {
    const v = localStorage.getItem(KEY)
    if (v === "paddle" || v === "doubao" || v === "auto") return v
  } catch {
    /* 忽略 */
  }
  return "auto"
}

interface OcrEngineState {
  engine: OcrEngine
  setEngine: (e: OcrEngine) => void
}

export const useOcrEngineStore = create<OcrEngineState>((set) => ({
  engine: readInitial(),
  setEngine: (e) => {
    try {
      localStorage.setItem(KEY, e)
    } catch {
      /* 忽略 */
    }
    set({ engine: e })
  },
}))

/** 非 hook 读取（service 层 parseImage 用，避免 React 依赖） */
export function getOcrEngine(): OcrEngine {
  return useOcrEngineStore.getState().engine
}

/** 中文/英文/每日一练识别通道支持 paddle 与 doubao；数学仅豆包可用 */
export const ENGINE_LABELS: Record<OcrEngine, string> = {
  auto: "🤖 自动(默认)",
  doubao: "⚡ 豆包(快)",
  paddle: "📐 PaddleOCR(准)",
}
