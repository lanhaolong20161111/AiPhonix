/** 识图模型选择器（2026-09-02）
 *
 * 识别前由用户显式选择用哪个模型识别（豆包 / PaddleOCR / 自动），
 * 选中值写入全局 useOcrEngineStore，parseImage 内部读取后透传给服务端。
 *
 * 用法：放在识别入口附近（AiInputBox、OcrPickSheet、ImageSliceSheet 头部），
 * 用户选完点「识别」即按所选模型识别。
 */
import { useOcrEngineStore, ENGINE_LABELS, type OcrEngine } from "../stores/ocrEngineStore"

const ORDER: OcrEngine[] = ["auto", "doubao", "paddle"]

interface OcrEnginePickerProps {
  /** 可选：限制可选模型（如数学页只有豆包可用，可隐藏 paddle） */
  allowed?: OcrEngine[]
  /** 是否显示标题文案 */
  showLabel?: boolean
}

export function OcrEnginePicker({ allowed, showLabel = true }: OcrEnginePickerProps) {
  const engine = useOcrEngineStore((s) => s.engine)
  const setEngine = useOcrEngineStore((s) => s.setEngine)
  const opts = allowed ? ORDER.filter((e) => allowed.includes(e)) : ORDER

  return (
    <div style={{ marginBottom: 8 }}>
      {showLabel && (
        <span style={{ fontSize: 12, color: "#64748b", marginRight: 8 }}>识别模型</span>
      )}
      <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        {opts.map((e) => {
          const active = engine === e
          return (
            <button
              key={e}
              type="button"
              onClick={() => setEngine(e)}
              aria-pressed={active}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                borderRadius: 8,
                cursor: "pointer",
                border: `1.5px solid ${active ? "#2563eb" : "#e2e8f0"}`,
                background: active ? "#eff6ff" : "#fff",
                color: active ? "#1d4ed8" : "#64748b",
                fontWeight: active ? 600 : 400,
              }}
            >
              {ENGINE_LABELS[e]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
