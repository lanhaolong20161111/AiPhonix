/**
 * 切块识别选择器（PP-OCRv6 后端检测文本块 + 客户手动调整框）
 *
 * 交互流程（按客户反馈重设计）：
 * 1. 选图 → 打开 sheet → 上传到后端用 PP-OCRv6 自动检测图片中的每行文本
 * 2. **用绿色框标出每个文本块**给客户预览（带编号 + 识别文本）
 * 3. 客户看到绿框后选择：
 *   a) 自动切割：按绿框逐块识别，全部合并成整页结果
 *   b) 手动调整：客户可拖动/拉伸每个绿框的四条边/四角，也可增删块，再识别
 * 4. 完成后通过 onDone(merged: ParseImageResult, previewUrl) 把合并结果交回调用方
 *
 * 与旧版的区别：旧版用等分网格（2x2/3x3）机械切 / OpenCV.js 前端轮廓检测；新版用 PP-OCRv6
 * 后端文本行检测 + 客户可视化微调。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { parseImage, mergeParseResults, type ParseImageResult } from "../services/aiImage"
import { detectTextBlocks, type TextBlockBox } from "../services/paddleTextDetect"
import { OcrEnginePicker } from "./OcrEnginePicker"

type Mode = "auto" | "manual"
interface EditableBox {
  id: string
  nx: number
  ny: number
  nw: number
  nh: number
  original: TextBlockBox | null
}

interface ImageSliceSheetProps {
  file: File | Blob
  module: "chinese" | "math" | "english"
  title?: string
  onClose: () => void
  onDone: (merged: ParseImageResult, previewUrl: string) => void
}

let __boxIdCounter = 0
const newBoxId = () => "b" + ++__boxIdCounter

export function ImageSliceSheet({ file, module, title = "切块识别", onClose, onDone }: ImageSliceSheetProps) {
  const [mode, setMode] = useState<Mode>("auto")
  const [imgUrl, setImgUrl] = useState("")
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 检测状态：loading（后端 PP-OCRv6 检测中）→ done / error
  const [loading, setLoading] = useState(true)
  const [detectErr, setDetectErr] = useState("")
  const [detected, setDetected] = useState<TextBlockBox[]>([])
  const [editable, setEditable] = useState<EditableBox[]>([])

  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState("")
  const [results, setResults] = useState<ParseImageResult[]>([])
  const [doneCount, setDoneCount] = useState(0)
  // 自动切割的合并方式：fast=直接用 PP-OCRv6 检测文字（秒级，纯文本）；
  // ai=整张原图一次走 LLM 结构化识别（几秒，保留标题/正文/多音字 polyphones）
  const [recognizeMode, setRecognizeMode] = useState<"fast" | "ai">("fast")

  // 把 file 转成 objectURL 供 <img> 显示
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // 图片 onLoad：记录原始尺寸，供后续裁剪换算
  const onImgLoad = useCallback((el: HTMLImageElement | null) => {
    imgRef.current = el
    if (el?.naturalWidth) {
      setImgDims({ w: el.naturalWidth, h: el.naturalHeight })
    }
  }, [])

  // 挂载后立即上传检测（依赖 file；组件每次 open 重新创建，天然只跑一次）
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDetectErr("")
    detectTextBlocks(file)
      .then((boxes) => {
        if (cancelled) return
        console.log("[slice] PP-OCRv6 检测完成，找到", boxes.length, "个文本块")
        setDetected(boxes)
        setEditable(
          boxes.map((b) => ({
            id: newBoxId(),
            nx: b.nx,
            ny: b.ny,
            nw: b.nw,
            nh: b.nh,
            original: b,
          })),
        )
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        console.error("[slice] PP-OCRv6 检测失败:", msg)
        setDetectErr(msg)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const handleClose = () => {
    if (busy || loading) return
    onClose()
  }

  const mergedText = useMemo(() => mergeParseResults(results).text.trim(), [results])

  const totalBlocks = editable.length
  const gridProgress = totalBlocks > 0 ? Math.min(doneCount / totalBlocks, 1) : 0

  const runRecognizeAll = useCallback(async () => {
    if (!imgDims || editable.length === 0) return
    setBusy(true)
    setErrMsg("")
    setResults([])
    setDoneCount(0)
    try {
      // 方案 B（整图 AI）：保留结构化排版（标题/正文）+ 多音字 polyphones。
      // 整张原图一次走 LLM parseImage，几秒完成，不再逐块。
      if (recognizeMode === "ai") {
        const blob = await new Promise<Blob | null>((res) => {
          const c = document.createElement("canvas")
          c.width = imgDims.w
          c.height = imgDims.h
          const ctx = c.getContext("2d")
          if (!ctx || !imgRef.current) return res(null)
          ctx.drawImage(imgRef.current, 0, 0, imgDims.w, imgDims.h)
          c.toBlob(res, "image/jpeg", 0.9)
        })
        if (blob) {
          const r = await parseImage(blob, module)
          setResults([r])
          setDoneCount(1)
        } else {
          setErrMsg("整图识别失败：无法截取原图")
        }
        return
      }

      // 方案 A（快）：所有块都来自 PP-OCRv6 检测（original.text 存在）时，
      // 直接用检测阶段已返回的文字拼装，跳过逐块 LLM 识别 —— 秒级完成。
      const allDetected = editable.every((eb) => eb.original?.text)
      if (allDetected) {
        const texts: string[] = []
        for (const eb of editable) {
          const t = (eb.original?.text ?? "").trim()
          if (t) texts.push(t)
        }
        setResults([{ text: texts.join("\n"), questions: [] }])
        setDoneCount(editable.length)
        return
      }

      // 兜底（仅当含用户手动新增、无检测文本的块时）：逐块裁图走 LLM 识别。
      // 2026-09-02：串行改并发 2 路（5 框串行 = 5×单次耗时；并发 2 明显提速且不压垮后端），结果按框顺序。
      const acc: (ParseImageResult | null)[] = new Array(editable.length).fill(null)
      const recognizeOne = async (eb: EditableBox): Promise<ParseImageResult | null> => {
        const sx = Math.max(0, Math.round(eb.nx * imgDims.w))
        const sy = Math.max(0, Math.round(eb.ny * imgDims.h))
        const sw = Math.min(imgDims.w - sx, Math.round(eb.nw * imgDims.w))
        const sh = Math.min(imgDims.h - sy, Math.round(eb.nh * imgDims.h))
        if (sw < 4 || sh < 4) return null
        const canvas = document.createElement("canvas")
        canvas.width = sw
        canvas.height = sh
        const ctx = canvas.getContext("2d")
        if (!ctx || !imgRef.current) return null
        ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh)
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9))
        if (!blob) return null
        return await parseImage(blob, module)
      }
      let cursor = 0
      let done = 0
      const worker = async () => {
        while (cursor < editable.length) {
          const i = cursor++
          try {
            acc[i] = await recognizeOne(editable[i])
          } catch (e) {
            console.error("[slice] block " + (i + 1) + " failed", e)
          }
          setDoneCount(++done)
        }
      }
      await Promise.all(Array.from({ length: Math.min(2, editable.length) }, worker))
      const okResults = acc.filter((r): r is ParseImageResult => r !== null)
      setResults(okResults)
      if (okResults.length === 0) setErrMsg("所有切块都识别失败，请检查图片或调整切块位置")
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [editable, imgDims, module, recognizeMode])

  const handleDone = () => {
    if (busy || !mergedText) return
    onDone(mergeParseResults(results), imgUrl)
  }

  const updateBox = useCallback((id: string, patch: Partial<EditableBox>) => {
    setEditable((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  const removeBox = (id: string) => setEditable((prev) => prev.filter((b) => b.id !== id))

  const addBox = () => {
    setEditable((prev) => [
      ...prev,
      { id: newBoxId(), nx: 0.2, ny: 0.2, nw: 0.6, nh: 0.15, original: null },
    ])
  }

  const resetToDetected = () => {
    setEditable(
      detected.map((b) => ({
        id: newBoxId(),
        nx: b.nx,
        ny: b.ny,
        nw: b.nw,
        nh: b.nh,
        original: b,
      })),
    )
    setResults([])
    setDoneCount(0)
  }

  return (
    <div className="settings-overlay" onClick={handleClose}>
      <div
        className="settings-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        style={{ maxHeight: "92vh", width: "min(720px, 96vw)" }}
      >
        <div className="settings-sheet-head">
          <span className="settings-sheet-title">{title}</span>
          <button className="btn-secondary btn-sm" onClick={handleClose} disabled={busy || loading}>
            ✕
          </button>
        </div>

        <div className="settings-sheet-body" style={{ overflow: "auto" }}>
          {(loading || detectErr) && (
            <p
              style={{
                fontSize: 12,
                color: detectErr ? "#dc2626" : "#64748b",
                background: detectErr ? "#fef2f2" : "#f1f5f9",
                padding: "6px 8px",
                borderRadius: 6,
                margin: "0 0 8px",
              }}
            >
              {loading && "⏳ PP-OCRv6 正在检测文本块（首次约 5-15s）..."}
              {detectErr && "❌ 文本块检测失败：" + detectErr + "（可换图重试，或切「手动调整」自行框选）"}
            </p>
          )}

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(
              [
                ["auto", "自动切割 (" + editable.length + " 块)"],
                ["manual", "手动调整"],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={busy || loading || editable.length === 0}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  fontSize: 13,
                  borderRadius: 8,
                  cursor: busy ? "wait" : "pointer",
                  border: "1.5px solid " + (mode === m ? "#16a34a" : "#e2e8f0"),
                  background: mode === m ? "#dcfce7" : "#fff",
                  color: mode === m ? "#15803d" : "#64748b",
                  fontWeight: mode === m ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 识别前选择模型（数学通道仅豆包可用，隐藏 PaddleOCR） */}
          <OcrEnginePicker allowed={module === "math" ? ["auto", "doubao"] : undefined} showLabel={false} />

          {errMsg && (
            <p style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", padding: "6px 8px", borderRadius: 6, margin: "0 0 8px" }}>
              {"❌ " + errMsg}
            </p>
          )}

          <div
            ref={boxRef}
            style={{
              position: "relative",
              userSelect: "none",
              borderRadius: 8,
              overflow: "hidden",
              background: "#0f172a",
              marginBottom: 10,
              minHeight: 200,
            }}
          >
            <img
              ref={onImgLoad}
              src={imgUrl}
              alt="待识别"
              style={{ display: "block", width: "100%", maxHeight: 460, objectFit: "contain", pointerEvents: "none" }}
              draggable={false}
              crossOrigin="anonymous"
              onLoad={(e) => onImgLoad(e.currentTarget)}
            />
            {imgUrl && editable.length > 0 && (
              <BoxOverlay
                boxes={editable}
                imgContainerRef={boxRef}
                editable={mode === "manual"}
                onUpdate={updateBox}
              />
            )}
            {busy && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(15,23,42,.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  pointerEvents: "none",
                }}
              >
                {"⏳ 识别中… " + doneCount + "/" + totalBlocks}
              </div>
            )}
          </div>

          {mode === "manual" && (
            <>
              <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 6px" }}>
                拖动绿框中部移动整个块；拖动边框/角拉伸；点 ✕ 删除单个块。完成后点「识别所有块」。
              </p>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button className="btn-secondary btn-sm" onClick={addBox} disabled={busy}>
                  ➕ 新增块
                </button>
                <button className="btn-secondary btn-sm" onClick={resetToDetected} disabled={busy}>
                  ↻ 还原 PP-OCRv6 检测结果
                </button>
              </div>
            </>
          )}
          {mode === "auto" && editable.length > 0 && (
            <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 6px" }}>
              {"PP-OCRv6 检测到 " + detected.length + " 个文本块，已用绿框标出。选下方一种方式合并识别结果。"}
            </p>
          )}
          {editable.length === 0 && !loading && !detectErr && (
            <p style={{ fontSize: 11, color: "#dc2626", margin: "0 0 6px" }}>
              PP-OCRv6 未识别到任何文本块，可切换到「手动调整」自行框选。
            </p>
          )}

          {mode === "auto" && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {(
                  [
                    ["fast", "⚡ 秒级合并（检测文字）", "直接用 PP-OCRv6 已识别文字，纯文本，立即完成"],
                    ["ai", "🧠 AI 整图识别（保结构）", "整张图一次 LLM，几秒，保留标题/正文/多音字"],
                  ] as [typeof recognizeMode, string, string][]
                ).map(([m, label, hint]) => (
                  <button
                    key={m}
                    onClick={() => setRecognizeMode(m)}
                    disabled={busy || loading}
                    title={hint}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      fontSize: 12,
                      borderRadius: 8,
                      cursor: busy ? "wait" : "pointer",
                      border: "1.5px solid " + (recognizeMode === m ? "#16a34a" : "#e2e8f0"),
                      background: recognizeMode === m ? "#dcfce7" : "#fff",
                      color: recognizeMode === m ? "#15803d" : "#64748b",
                      fontWeight: recognizeMode === m ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {busy && (
                <div style={{ height: 6, borderRadius: 3, background: "#e2e8f0", overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: gridProgress * 100 + "%", background: "#16a34a", transition: "width .3s" }} />
                </div>
              )}
              {!busy && results.length === 0 && (
                <button className="btn-primary" style={{ width: "100%" }} disabled={editable.length === 0} onClick={runRecognizeAll}>
                  {recognizeMode === "fast"
                    ? "⚡ 按 " + editable.length + " 个绿框合并文字（秒级）"
                    : "🧠 整图 AI 识别并合并（保留结构/多音字）"}
                </button>
              )}
              {!busy && results.length > 0 && (
                <button className="btn-secondary" style={{ width: "100%" }} onClick={runRecognizeAll}>
                  ↻ 重新识别
                </button>
              )}
            </>
          )}
          {mode === "manual" && (
            <button className="btn-primary" style={{ width: "100%" }} disabled={busy || editable.length === 0} onClick={runRecognizeAll}>
              {busy ? "⏳ 识别中… " + doneCount + "/" + totalBlocks : "识别所有块 (" + editable.length + ")"}
            </button>
          )}

          {mode === "manual" && editable.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{"当前 " + editable.length + " 个块（按阅读顺序）："}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {editable.map((b, i) => (
                  <div
                    key={b.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "#f8fafc",
                      borderRadius: 6,
                      padding: "3px 6px",
                      fontSize: 11,
                      color: "#475569",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#16a34a" }}>{"#" + (i + 1)}</span>
                    <span>
                      {Math.round(b.nx * 100) + "," + Math.round(b.ny * 100) + " · " + Math.round(b.nw * 100) + "×" + Math.round(b.nh * 100)}
                    </span>
                    <button
                      onClick={() => removeBox(b.id)}
                      disabled={busy}
                      style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13, padding: 0, marginLeft: 2 }}
                      aria-label="删除该块"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mergedText && (
            <>
              <p style={{ fontSize: 11, color: "#94a3b8", margin: "12px 0 4px" }}>
                {"合并识别结果（" + mergedText.length + " 字，可预览）："}
              </p>
              <textarea
                rows={5}
                readOnly
                value={mergedText}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontSize: 13,
                  padding: 8,
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 8,
                  marginBottom: 10,
                  background: "#f8fafc",
                }}
              />
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
<button className="btn-secondary" onClick={handleClose} disabled={busy || loading}>
            取消
          </button>
            <button className="btn-primary" disabled={!mergedText || busy} onClick={handleDone}>
              ✓ 完成，识别整页
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface BoxOverlayProps {
  boxes: EditableBox[]
  imgContainerRef: React.RefObject<HTMLDivElement | null>
  editable: boolean
  onUpdate: (id: string, patch: Partial<EditableBox>) => void
}

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

function BoxOverlay({ boxes, imgContainerRef, editable, onUpdate }: BoxOverlayProps) {
  const [imgBox, setImgBox] = useState<{ left: number; top: number; w: number; h: number } | null>(null)
  useEffect(() => {
    const recompute = () => {
      const c = imgContainerRef.current
      const i = c?.querySelector("img") as HTMLImageElement | null
      if (!c || !i || !i.naturalWidth) return
      const cw = c.clientWidth
      const ch = c.clientHeight
      const ir = i.naturalWidth / i.naturalHeight
      const cr = cw / ch
      let dw: number, dh: number
      if (ir > cr) {
        dw = cw
        dh = cw / ir
      } else {
        dh = ch
        dw = ch * ir
      }
      const left = (cw - dw) / 2
      const top = (ch - dh) / 2
      setImgBox({ left, top, w: dw, h: dh })
    }
    recompute()
    window.addEventListener("resize", recompute)
    const ro = new ResizeObserver(recompute)
    if (imgContainerRef.current) ro.observe(imgContainerRef.current)
    return () => {
      window.removeEventListener("resize", recompute)
      ro.disconnect()
    }
  }, [imgContainerRef, boxes.length])

  const onPointerDownHandle = useCallback(
    (e: React.PointerEvent, boxId: string, handle: Handle) => {
      if (!editable || !imgBox) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      const target = boxes.find((b) => b.id === boxId)
      if (!target) return
      const orig = { nx: target.nx, ny: target.ny, nw: target.nw, nh: target.nh }
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

      const onMove = (mv: PointerEvent) => {
        const dx = (mv.clientX - startX) / imgBox.w
        const dy = (mv.clientY - startY) / imgBox.h
        const next = { ...orig }
        if (handle === "move") {
          next.nx = clamp01(orig.nx + dx)
          next.ny = clamp01(orig.ny + dy)
        } else if (handle === "n") {
          const newH = orig.nh - dy
          next.ny = clamp01(orig.ny + dy)
          next.nh = Math.max(0.02, newH)
          if (next.ny + next.nh > 1) next.nh = 1 - next.ny
        } else if (handle === "s") {
          const newH = orig.nh + dy
          next.nh = Math.max(0.02, newH)
          if (next.ny + next.nh > 1) next.nh = 1 - next.ny
        } else if (handle === "w") {
          const newW = orig.nw - dx
          next.nx = clamp01(orig.nx + dx)
          next.nw = Math.max(0.02, newW)
          if (next.nx + next.nw > 1) next.nw = 1 - next.nx
        } else if (handle === "e") {
          const newW = orig.nw + dx
          next.nw = Math.max(0.02, newW)
          if (next.nx + next.nw > 1) next.nw = 1 - next.nx
        } else if (handle === "ne") {
          const newH = orig.nh - dy
          const newW = orig.nw + dx
          next.ny = clamp01(orig.ny + dy)
          next.nw = Math.max(0.02, newW)
          next.nh = Math.max(0.02, newH)
          if (next.nx + next.nw > 1) next.nw = 1 - next.nx
          if (next.ny + next.nh > 1) next.nh = 1 - next.ny
        } else if (handle === "nw") {
          const newH = orig.nh - dy
          const newW = orig.nw - dx
          next.nx = clamp01(orig.nx + dx)
          next.ny = clamp01(orig.ny + dy)
          next.nw = Math.max(0.02, newW)
          next.nh = Math.max(0.02, newH)
          if (next.nx + next.nw > 1) next.nw = 1 - next.nx
          if (next.ny + next.nh > 1) next.nh = 1 - next.ny
        } else if (handle === "se") {
          const newH = orig.nh + dy
          const newW = orig.nw + dx
          next.nw = Math.max(0.02, newW)
          next.nh = Math.max(0.02, newH)
          if (next.nx + next.nw > 1) next.nw = 1 - next.nx
          if (next.ny + next.nh > 1) next.nh = 1 - next.ny
        } else if (handle === "sw") {
          const newH = orig.nh + dy
          const newW = orig.nw - dx
          next.nx = clamp01(orig.nx + dx)
          next.nw = Math.max(0.02, newW)
          next.nh = Math.max(0.02, newH)
          if (next.nx + next.nw > 1) next.nw = 1 - next.nx
          if (next.ny + next.nh > 1) next.nh = 1 - next.ny
        }
        onUpdate(boxId, next)
      }
      const onUp = () => {
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerup", onUp)
      }
      document.addEventListener("pointermove", onMove)
      document.addEventListener("pointerup", onUp)
    },
    [boxes, editable, imgBox, onUpdate],
  )

  if (!imgBox) return null

  return (
    <div
      style={{
        position: "absolute",
        left: imgBox.left,
        top: imgBox.top,
        width: imgBox.w,
        height: imgBox.h,
        pointerEvents: editable ? "auto" : "none",
      }}
    >
      {boxes.map((b, i) => {
        const left = b.nx * imgBox.w
        const top = b.ny * imgBox.h
        const w = b.nw * imgBox.w
        const h = b.nh * imgBox.h
        return (
          <div
            key={b.id}
            style={{
              position: "absolute",
              left,
              top,
              width: w,
              height: h,
              border: "2px solid #22c55e",
              borderRadius: 4,
              boxSizing: "border-box",
              boxShadow: editable ? "0 0 0 1px rgba(0,0,0,.3)" : undefined,
              touchAction: "none",
              cursor: editable ? "move" : "default",
            }}
            onPointerDown={(e) => onPointerDownHandle(e, b.id, "move")}
          >
            <span
              style={{
                position: "absolute",
                left: 4,
                top: -22,
                background: "#22c55e",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 3,
                pointerEvents: "none",
                lineHeight: "16px",
                whiteSpace: "nowrap",
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {"#" + (i + 1) + (b.original?.text ? " " + b.original.text : "")}
            </span>
            {editable && (
              <>
                {(["nw", "ne", "se", "sw"] as Handle[]).map((h) => (
                  <span
                    key={h}
                    onPointerDown={(e) => onPointerDownHandle(e, b.id, h)}
                    style={{
                      position: "absolute",
                      width: 14,
                      height: 14,
                      background: "#22c55e",
                      border: "2px solid #fff",
                      borderRadius: 3,
                      ...cornerStyle(h),
                      cursor: cornerCursor(h),
                    }}
                  />
                ))}
                {(["n", "s", "e", "w"] as Handle[]).map((h) => (
                  <span
                    key={h}
                    onPointerDown={(e) => onPointerDownHandle(e, b.id, h)}
                    style={{
                      position: "absolute",
                      background: "#22c55e",
                      border: "1.5px solid #fff",
                      borderRadius: 2,
                      ...edgeStyle(h),
                      cursor: edgeCursor(h),
                    }}
                  />
                ))}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function cornerStyle(h: Handle): React.CSSProperties {
  switch (h) {
    case "nw":
      return { left: -7, top: -7 }
    case "ne":
      return { right: -7, top: -7 }
    case "se":
      return { right: -7, bottom: -7 }
    case "sw":
      return { left: -7, bottom: -7 }
  }
  return {}
}
function cornerCursor(h: Handle): string {
  return h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize"
}
function edgeStyle(h: Handle): React.CSSProperties {
  switch (h) {
    case "n":
      return { left: "50%", top: -5, width: 20, height: 10, transform: "translateX(-50%)" }
    case "s":
      return { left: "50%", bottom: -5, width: 20, height: 10, transform: "translateX(-50%)" }
    case "e":
      return { top: "50%", right: -5, width: 10, height: 20, transform: "translateY(-50%)" }
    case "w":
      return { top: "50%", left: -5, width: 10, height: 20, transform: "translateY(-50%)" }
  }
  return {}
}
function edgeCursor(h: Handle): string {
  return h === "n" || h === "s" ? "ns-resize" : "ew-resize"
}