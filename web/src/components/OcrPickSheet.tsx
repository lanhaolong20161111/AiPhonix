/** OCR 拍照识别选择器 — 自由框选识别
 *
 * 拍照/选图后，直接在图上用鼠标/手指拖拽框出要识别的内容（不再自动分块）。
 * 支持连续框选多个区域：每个框独立裁剪识别，识别结果按框的顺序拼接成一段文本，
 * 可在底部编辑后导入。识别文字可选去除拼音（stripPinyin），并按「练字」需求字间加空格（spaceChars）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { parseImage, type ParseImageResult } from "../services/aiImage"
import { stripPinyin, stripPinyinKeepDelimiters } from "../lib/pinyin"
import { detectTextBlocks } from "../services/paddleTextDetect"
import { OcrEnginePicker } from "./OcrEnginePicker"

/** 识别通道：chinese=语文（含英语复用语文通道）、math=数学。透传给 parseImage */
export type OcrPickModule = "chinese" | "math" | "english"

interface OcrPickSheetProps {
  file: File
  title?: string
  onClose: () => void
  /** 语文场景：识别完成后回传拼接的纯文本（练字/词/句导入）；传了 onConfirmResult 时可不传 */
  onConfirm?: (text: string) => void
  /** 识别通道（默认 chinese） */
  module?: OcrPickModule
  /**
   * AI 场景：传了此回调则点「导入」时合并所有已识别框的结果为结构化 ParseImageResult 回传
   * （含 text/questions/blocks，供跳结果页逐字点读/标记）；未传则走 onConfirm(text)。
   */
  onConfirmResult?: (result: ParseImageResult, previewUrl: string) => void
  /** 是否去除识别文本里的拼音（适合识别带拼音的课本照片，只保留文字） */
  stripPinyin?: boolean
  /** 去拼音时是否把汉字用空格隔开（适合「练字」逐字拆分；练词/练句保持连写不加） */
  spaceChars?: boolean
}

interface CropItem {
  key: number
  rect: { x: number; y: number; w: number; h: number } // 显示坐标（对应预览图）
  /** 待确认识别：框选/调整后置 true，点「开始识别」后才真正识别 */
  pending: boolean
  text: string
  busy: boolean
  err: string
}

export function OcrPickSheet({ file, title = "📷 拍照识别", onClose, onConfirm, module = "chinese", onConfirmResult, stripPinyin: wantStrip, spaceChars }: OcrPickSheetProps) {
  // 图片预览 URL + 解码后的原图尺寸（坐标映射用）
  const [imgUrl, setImgUrl] = useState("")
  const imgRef = useRef<HTMLImageElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 框选列表 + 当前拖拽框（显示坐标）
  const [crops, setCrops] = useState<CropItem[]>([])
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const keyRef = useRef(1)
  // 拖拽会话状态：画新框 / 平移某框 / 缩放某框
  const editRef = useRef<{
    mode: "draw" | "move" | "resize"
    cropKey: number | null
    handle: string | null // 缩放的把手：nw n ne e se s sw w
    start: { x: number; y: number }
    orig: { x: number; y: number; w: number; h: number }
  } | null>(null)
  const rectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  // 底部可编辑文本
  const [draft, setDraft] = useState("")
  // 每框识别到的结构化结果（供 AI 场景 onConfirmResult 合并回传）；key → ParseImageResult
  const cropResultsRef = useRef<Map<number, ParseImageResult>>(new Map())

  // ── 文本块检测（吸附用）：检测块以「显示坐标」存储，供拖拽时吸附到最近的识别行 ──
  const [blocks, setBlocks] = useState<Array<{ x: number; y: number; w: number; h: number; text?: string }>>([])
  const [blocksLoading, setBlocksLoading] = useState(false)
  const blocksErrRef = useRef<string | null>(null)
  // 当前拖拽框吸附到的块（显示坐标），供绿色高亮提示
  const [snapTo, setSnapTo] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  /** 需要去拼音时，统一清洗识别出的文字。
   * - 练字（spaceChars=true）：去掉所有非汉字并把字与字之间加空格，让每个字成为一个条目；
   * - 练词/练句（spaceChars=false）：只去拼音但保留词/句之间的分隔符（空格、换行、顿号等），
   *   否则 stripPinyin 会把所有中文字符串打平成一个长串，下游 splitText 无法按词语拆分。 */
  const clean = useCallback(
    (s: string) => {
      if (!wantStrip) return s
      return spaceChars ? stripPinyin(s, true) : stripPinyinKeepDelimiters(s)
    },
    [wantStrip, spaceChars],
  )

  // 预览 URL 生命周期
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // 图片加载完成后，调后端 PP-OCRv6 检测文本行，供框选时「吸附」到最近的识别块
  useEffect(() => {
    let cancelled = false
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    setBlocksLoading(true)
    detectTextBlocks(file)
      .then((blocks) => {
        if (cancelled) return
        // 归一化坐标 → 显示坐标（与预览图同参考系）
        setBlocks(blocks.map((b) => ({ x: b.nx * box.width, y: b.ny * box.height, w: b.nw * box.width, h: b.nh * box.height, text: b.text })))
      })
      .catch((e) => {
        if (cancelled) return
        blocksErrRef.current = e instanceof Error ? e.message : String(e)
      })
      .finally(() => {
        if (!cancelled) setBlocksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file])

  // ── 拖拽框选（指针/触屏通用）──
  const pointInBox = (e: React.PointerEvent) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return {
      x: Math.min(Math.max(e.clientX - box.left, 0), box.width),
      y: Math.min(Math.max(e.clientY - box.top, 0), box.height),
    }
  }

  // ── 吸附算法：给定拖拽框 r，在所有检测块里找「交集面积 / 用户框面积」最大的块；
  //    若该占比 ≥ SNAP_RATIO（拖到块内部即触发），返回吸附后的精确框；否则返回 null（保持自由框选）。
  const SNAP_RATIO = 0.35
  const intersectRatio = useCallback((r: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
    const ix = Math.max(0, Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x))
    const iy = Math.max(0, Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y))
    const area = ix * iy
    const userArea = r.w * r.h
    if (area <= 0 || userArea <= 0) return 0
    return area / userArea
  }, [])
  const snapRect = useCallback(
    (r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } | null => {
      if (blocks.length === 0) return null
      let best: { x: number; y: number; w: number; h: number } | null = null
      let bestRatio = SNAP_RATIO
      for (const b of blocks) {
        const ratio = intersectRatio(r, b)
        if (ratio > bestRatio) {
          bestRatio = ratio
          best = b
        }
      }
      return best
    },
    [blocks, intersectRatio],
  )

  // ── 已画框的 8 个缩放把手位置（显示坐标） ──
  const HANDLE_HIT = 18 // 命中半径（显示坐标，触屏友好）
  const handlePoints = useCallback((r: { x: number; y: number; w: number; h: number }) => {
    const { x, y, w, h } = r
    return {
      nw: { x, y },
      n: { x: x + w / 2, y },
      ne: { x: x + w, y },
      e: { x: x + w, y: y + h / 2 },
      se: { x: x + w, y: y + h },
      s: { x: x + w / 2, y: y + h },
      sw: { x, y: y + h },
      w: { x, y: y + h / 2 },
    }
  }, [])
  // 命中某框：返回 "resize"(命中把手) / "move"(命中内部) / null(框外)
  const hitCrop = useCallback(
    (p: { x: number; y: number }) => {
      for (let i = crops.length - 1; i >= 0; i--) {
        const c = crops[i]
        const { x, y, w, h } = c.rect
        if (w < 8 || h < 8) continue
        const pts = handlePoints(c.rect)
        for (const [name, pt] of Object.entries(pts)) {
          if (Math.hypot(p.x - pt.x, p.y - pt.y) <= HANDLE_HIT) {
            return { crop: c, action: "resize" as const, handle: name }
          }
        }
        // 内部：忽略边框窄带（避免把手附近误判为 move）
        const pad = 6
        if (p.x > x + pad && p.x < x + w - pad && p.y > y + pad && p.y < y + h - pad) {
          return { crop: c, action: "move" as const, handle: null }
        }
      }
      return null
    },
    [crops, handlePoints],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    const p = pointInBox(e)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const hit = hitCrop(p)
    if (hit) {
      // 调整已画框（缩放/平移）
      editRef.current = {
        mode: hit.action === "resize" ? "resize" : "move",
        cropKey: hit.crop.key,
        handle: hit.handle,
        start: { x: p.x, y: p.y },
        orig: { ...hit.crop.rect },
      }
      setSnapTo(null)
      return
    }
    // 画新框
    editRef.current = { mode: "draw", cropKey: null, handle: null, start: { x: p.x, y: p.y }, orig: { x: p.x, y: p.y, w: 0, h: 0 } }
    const r = { x: p.x, y: p.y, w: 0, h: 0 }
    rectRef.current = r
    setCurrentRect(r)
    setSnapTo(null)
  }

  // 根据缩放把手 + 起止点计算新矩形
  const resizeRect = useCallback(
    (handle: string, start: { x: number; y: number }, cur: { x: number; y: number }, orig: { x: number; y: number; w: number; h: number }) => {
      const dx = cur.x - start.x
      const dy = cur.y - start.y
      let { x, y, w, h } = orig
      // 水平
      if (handle.includes("w")) {
        x = Math.min(orig.x + dx, orig.x + orig.w - 10)
        w = orig.x + orig.w - x
      } else if (handle.includes("e")) {
        w = Math.max(orig.w + dx, 10)
      }
      // 垂直
      if (handle.includes("n")) {
        y = Math.min(orig.y + dy, orig.y + orig.h - 10)
        h = orig.y + orig.h - y
      } else if (handle.includes("s")) {
        h = Math.max(orig.h + dy, 10)
      }
      return { x, y, w, h }
    },
    [],
  )

  const onPointerMove = (e: React.PointerEvent) => {
    const edit = editRef.current
    if (!edit) return
    const p = pointInBox(e)
    if (edit.mode === "resize") {
      const r = resizeRect(edit.handle!, edit.start, p, edit.orig)
      rectRef.current = r
      setCurrentRect(r) // 复用拖拽虚线框实时显示
      setSnapTo(null)
      return
    }
    if (edit.mode === "move") {
      const dx = p.x - edit.start.x
      const dy = p.y - edit.start.y
      const r = { x: edit.orig.x + dx, y: edit.orig.y + dy, w: edit.orig.w, h: edit.orig.h }
      rectRef.current = r
      setCurrentRect(r)
      setSnapTo(null)
      return
    }
    // draw：画新框（吸附仅在此生效）
    const r = { x: Math.min(edit.start.x, p.x), y: Math.min(edit.start.y, p.y), w: Math.abs(p.x - edit.start.x), h: Math.abs(p.y - edit.start.y) }
    const snapped = r.w > 2 && r.h > 2 ? snapRect(r) : null
    const final = snapped ?? r
    rectRef.current = final
    setCurrentRect(final)
    setSnapTo(snapped)
  }

  const onPointerUp = () => {
    const edit = editRef.current
    editRef.current = null
    const r = rectRef.current
    rectRef.current = null
    setCurrentRect(null)
    setSnapTo(null)
    if (!edit) return

    // 画新框：加入列表（标记「待识别」，由「开始识别」按钮统一触发）
    if (edit.mode === "draw") {
      if (r && r.w > 8 && r.h > 8) {
        const key = keyRef.current++
        setCrops((cs) => [...cs, { key, rect: r, pending: true, text: "", busy: false, err: "" }])
      }
      return
    }

    // 调整已画框：更新 rect 并标记「待重新识别」（框有明显变化才触发）
    if (!r || r.w < 8 || r.h < 8 || edit.cropKey == null) return
    const changed = Math.abs(r.x - edit.orig.x) > 1 || Math.abs(r.y - edit.orig.y) > 1 || Math.abs(r.w - edit.orig.w) > 1 || Math.abs(r.h - edit.orig.h) > 1
    if (!changed) return
    setCrops((cs) => cs.map((c) => (c.key === edit.cropKey ? { ...c, rect: r, pending: true, text: "", busy: false, err: "" } : c)))
  }

  // 识别某个框：显示坐标 → 原图像素坐标 → 裁剪 → 服务端识别
  const recognizeRect = useCallback(
    async (key: number, rect: { x: number; y: number; w: number; h: number }) => {
      const fail = (err: string) => setCrops((cs) => cs.map((c) => (c.key === key ? { ...c, busy: false, err } : c)))
      const img = imgRef.current
      const box = boxRef.current?.getBoundingClientRect()
      if (!img || !box || rect.w < 8 || rect.h < 8) return fail("框选区域无效")
      const scaleX = img.naturalWidth / box.width
      const scaleY = img.naturalHeight / box.height
      const sx = Math.max(0, Math.round(rect.x * scaleX))
      const sy = Math.max(0, Math.round(rect.y * scaleY))
      const sw = Math.min(img.naturalWidth - sx, Math.round(rect.w * scaleX))
      const sh = Math.min(img.naturalHeight - sy, Math.round(rect.h * scaleY))
      if (sw < 4 || sh < 4) return fail("框选区域太小")

      const canvas = document.createElement("canvas")
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext("2d")
      if (!ctx) return fail("无法创建画布")
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

      try {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
        if (!blob) throw new Error("裁剪失败，请重试")
        const r = await parseImage(blob, module)
        const t = ((r.text ?? "") || (r.blocks ?? []).map((b) => b.text).join("\n")).trim()
        if (!t) throw new Error("该区域未识别到文字")
        cropResultsRef.current.set(key, r)
        setCrops((cs) => cs.map((c) => (c.key === key ? { ...c, busy: false, text: clean(t) } : c)))
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e))
      }
    },
    [clean, module],
  )

  const removeCrop = (key: number) => {
    cropResultsRef.current.delete(key)
    setCrops((cs) => cs.filter((c) => c.key !== key))
  }

  const anyBusy = crops.some((c) => c.busy)
  const anyPending = crops.some((c) => c.pending)
  // 只要可编辑区有文字即可导入（忽略未识别/识别中的框），避免按钮因 pending/busy 静默禁用导致"点不动"
  const disabledConfirm = !draft.trim()

  /** 点「开始识别」：把所有待识别的框（pending && !busy）统一送去识别 */
  const confirmRecognition = useCallback(() => {
    const toDo = crops.filter((c) => c.pending && !c.busy)
    if (toDo.length === 0) return
    setCrops((cs) => cs.map((c) => (c.pending && !c.busy ? { ...c, pending: false, busy: true, err: "" } : c)))
    for (const c of toDo) void recognizeRect(c.key, c.rect)
  }, [crops, recognizeRect])

  /** 点「导入」：语文场景回传编辑后的文本；AI 场景合并各框结构化结果回传 */
  const handleConfirm = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    if (onConfirmResult) {
      const merged: ParseImageResult = { text, questions: [], blocks: [] }
      for (const c of crops) {
        const r = cropResultsRef.current.get(c.key)
        if (!r) continue
        if (Array.isArray(r.questions)) merged.questions!.push(...r.questions)
        if (Array.isArray(r.blocks)) merged.blocks!.push(...r.blocks)
        if (!merged.page_bounds && r.page_bounds) merged.page_bounds = r.page_bounds
        if (Array.isArray(r.crops) && merged.crops!.length === 0) merged.crops = r.crops
      }
      if (merged.questions!.length === 0 && text) merged.questions = [text]
      onConfirmResult(merged, imgUrl)
    } else {
      onConfirm?.(text)
    }
  }, [draft, crops, onConfirm, onConfirmResult, imgUrl])

  // 拼接文本：按框顺序（有识别文字的框）用换行连接
  const resultText = useMemo(
    () => crops.filter((c) => c.text.trim()).map((c) => c.text.trim()).join("\n").trim(),
    [crops],
  )
  // 识别结果变化（加框/删框/识别完成）→ 同步到底部可编辑文本
  useEffect(() => {
    setDraft(resultText)
  }, [resultText])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title} style={{ maxHeight: "88vh" }}>
        <div className="settings-sheet-head">
          <span className="settings-sheet-title">{title}</span>
          <button className="btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="settings-sheet-body" style={{ overflow: "auto" }}>
          {/* 识别前选择模型（数学通道仅豆包可用，隐藏 PaddleOCR） */}
          <OcrEnginePicker allowed={module === "math" ? ["auto", "doubao"] : undefined} showLabel={false} />
          <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 8px" }}>
            👆 在图片上拖拽框出要识别的内容（可框选多个区域，按顺序拼接）；框选/调整后点击「开始识别」才会识别。已画好的框可拖动内部平移、拖角上/边中点把手调整大小。
            {blocksLoading ? " 正在检测文字行以便自动吸附…" : blocks.length > 0 ? " 画新框会自动吸附到最近的文字行（绿框）。" : " （未检测到文字行，将保持自由框选。）"}
          </p>

          {/* 图片预览区（自由框选） */}
          <div
            ref={boxRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              position: "relative",
              userSelect: "none",
              touchAction: "none",
              cursor: "crosshair",
              borderRadius: 8,
              overflow: "hidden",
              background: "#0f172a",
              marginBottom: 10,
            }}
          >
            <img
              ref={imgRef}
              src={imgUrl}
              alt="待识别"
              style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", pointerEvents: "none" }}
              draggable={false}
            />
            {/* 检测到的文字行轮廓（吸附参考，浅色），点击可框选（disabled 会挡 pointer 事件，故 pointerEvents none） */}
            {!blocksLoading &&
              blocks.map((b, i) => (
                <div
                  key={`blk-${i}`}
                  style={{
                    position: "absolute",
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.h,
                    border: "1px solid rgba(148,163,184,.4)",
                    borderRadius: 2,
                    pointerEvents: "none",
                  }}
                  title={b.text}
                />
              ))}
            {/* 当前吸附目标（绿色高亮） */}
            {snapTo && (
              <div
                style={{
                  position: "absolute",
                  left: snapTo.x,
                  top: snapTo.y,
                  width: snapTo.w,
                  height: snapTo.h,
                  border: "2px solid #22c55e",
                  background: "rgba(34,197,94,.12)",
                  borderRadius: 3,
                  pointerEvents: "none",
                }}
              />
            )}
            {/* 已确认的框（带编号 + 删除 + 8 个缩放把手） */}
            {crops.map((c, i) => {
              const { x, y, w, h } = c.rect
              const hs = handlePoints(c.rect)
              const handleStyle: CSSProperties = {
                position: "absolute",
                width: 10,
                height: 10,
                background: "#fff",
                border: "1.5px solid #3b82f6",
                borderRadius: 2,
                transform: "translate(-50%,-50%)",
                pointerEvents: "none",
              }
              return (
                <div
                  key={c.key}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y,
                    width: w,
                    height: h,
                    border: "2px solid #3b82f6",
                    background: "rgba(59,130,246,.10)",
                    borderRadius: 3,
                    pointerEvents: "none",
                  }}
                >
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeCrop(c.key)}
                    title="删除此框"
                    style={{
                      position: "absolute",
                      right: -10,
                      top: -12,
                      width: 18,
                      height: 18,
                      lineHeight: "16px",
                      fontSize: 11,
                      textAlign: "center",
                      borderRadius: "50%",
                      border: "none",
                      background: "#dc2626",
                      color: "#fff",
                      cursor: "pointer",
                      pointerEvents: "auto",
                      zIndex: 3,
                    }}
                  >
                    ✕
                  </button>
                  <span style={{ position: "absolute", left: -2, top: -12, background: "#3b82f6", color: "#fff", fontSize: 9, padding: "0 5px", borderRadius: 3, lineHeight: "14px", zIndex: 3, pointerEvents: "none" }}>
                    {i + 1}{c.busy ? "…" : c.err ? "⚠" : c.pending ? "⏸" : "✓"}
                  </span>
                  {/* 8 个缩放把手 */}
                  <div style={{ ...handleStyle, left: hs.nw.x, top: hs.nw.y, cursor: "nwse-resize" }} />
                  <div style={{ ...handleStyle, left: hs.n.x, top: hs.n.y, cursor: "ns-resize" }} />
                  <div style={{ ...handleStyle, left: hs.ne.x, top: hs.ne.y, cursor: "nesw-resize" }} />
                  <div style={{ ...handleStyle, left: hs.e.x, top: hs.e.y, cursor: "ew-resize" }} />
                  <div style={{ ...handleStyle, left: hs.se.x, top: hs.se.y, cursor: "nwse-resize" }} />
                  <div style={{ ...handleStyle, left: hs.s.x, top: hs.s.y, cursor: "ns-resize" }} />
                  <div style={{ ...handleStyle, left: hs.sw.x, top: hs.sw.y, cursor: "nesw-resize" }} />
                  <div style={{ ...handleStyle, left: hs.w.x, top: hs.w.y, cursor: "ew-resize" }} />
                </div>
              )
            })}
            {/* 当前拖拽框 + 外围遮罩 */}
            {currentRect && currentRect.w > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: currentRect.x,
                  top: currentRect.y,
                  width: currentRect.w,
                  height: currentRect.h,
                  border: "2px dashed #3b82f6",
                  boxShadow: "0 0 0 9999px rgba(15,23,42,.45)",
                  borderRadius: 3,
                  pointerEvents: "none",
                }}
              />
            )}
          </div>

          {/* 框选结果列表 */}
          {crops.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>已框选 {crops.length} 个区域（按顺序拼接）</span>
                {crops.length > 0 && (
                  <button
                    onClick={() => setCrops([])}
                    style={{ fontSize: 11, background: "none", border: "none", color: "#dc2626", cursor: "pointer" }}
                  >
                    清空全部
                  </button>
                )}
              </div>
              {crops.map((c, i) => (
                <div
                  key={c.key}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: `1.5px solid ${c.err ? "#fca5a5" : c.busy ? "#e2e8f0" : c.pending ? "#cbd5e1" : "#3b82f6"}`,
                    background: c.err ? "#fef2f2" : c.busy ? "#f8fafc" : c.pending ? "#f1f5f9" : "#eef2ff",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", minWidth: 16, marginTop: 1 }}>{i + 1}</span>
                  <span style={{ fontSize: 13, color: "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1 }}>
                    {c.busy ? "⏳ 识别中…" : c.pending ? "⏸ 待识别" : c.err ? `❌ ${c.err}` : c.text}
                  </span>
                  <button
                    onClick={() => removeCrop(c.key)}
                    style={{ fontSize: 12, background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 0 }}
                    title="删除此框"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}

          {crops.length === 0 && !anyBusy && (
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px" }}>还没有框选任何区域，在图片上拖拽即可开始。</p>
          )}

          {/* 结果预览 + 导入（可编辑） */}
          <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 4px" }}>将导入的内容（可再编辑）：{draft.length} 字</p>
          <textarea
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="框选识别后，识别文字会按顺序出现在这里，可手动修改后导入"
            style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, marginBottom: 10 }}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: disabledConfirm ? "#dc2626" : anyPending ? "#d97706" : anyBusy ? "#2563eb" : "#94a3b8", flex: 1, textAlign: "left" }}>
              {disabledConfirm
                ? "还没有可导入的文字，请框选内容并点「开始识别」"
                : anyPending
                  ? `有 ${crops.filter((c) => c.pending).length} 个区域未识别，将忽略它们、直接导入已识别内容`
                  : anyBusy
                    ? "部分区域仍在识别中…将使用已识别内容导入"
                    : ""}
            </span>
            {anyPending && (
              <button className="btn-primary" disabled={anyBusy} onClick={confirmRecognition}>
                ⚡ 开始识别
              </button>
            )}
            <button className="btn-secondary" onClick={onClose}>取消</button>
            <button
              className="btn-primary"
              disabled={disabledConfirm}
              onClick={handleConfirm}
              style={{ opacity: disabledConfirm ? 0.5 : 1, cursor: disabledConfirm ? "not-allowed" : "pointer" }}
            >
              {onConfirmResult ? "✓ 识别并查看" : "✓ 导入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
