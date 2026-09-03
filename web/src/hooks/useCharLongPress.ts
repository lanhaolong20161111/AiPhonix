/** 长按手势 hook —— 修复移动端 pointerleave 误杀 + 系统手势冲突
 *
 * 旧实现在单字 span（~20px 宽）上用 onPointerLeave 取消 550ms 定时器，
 * 手指轻微抖动移出边界即取消 → 长按几乎永远触发不了。
 *
 * 修复：pointerdown 时 setPointerCapture，捕获期间 pointerleave 被抑制；
 * 改用 onPointerMove 移动超过 12px 才取消（真实滑动/滚动），onPointerCancel 兜底。
 *
 * 用法：const makeHandlers = useCharLongPressFactory(onLongPress)
 *       <span {...makeHandlers(ch)}>字</span>
 */
import { useCallback, useEffect, useRef } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

/** 移动阈值平方（12px）—— 超过视为滑动/滚动，取消长按 */
const MOVE_THRESHOLD_SQ = 144
const DEFAULT_MS = 550

export function useCharLongPressFactory(onLongPress: (ch: string) => void, ms = DEFAULT_MS) {
  const timerRef = useRef<number | null>(null)
  const posRef = useRef<{ x: number; y: number } | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    posRef.current = null
  }, [])

  // 卸载时清理
  useEffect(() => () => cancel(), [cancel])

  /**
   * 为指定字符生成 pointer 事件处理器。
   * 多个 span 调用此函数，共享同一个 timer/pos ref —— 同一时刻只会有一个长按在进行。
   */
  const makeHandlers = useCallback(
    (ch: string) => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        cancel()
        const el = e.currentTarget
        try {
          el.setPointerCapture(e.pointerId)
        } catch {
          /* 部分环境不支持 capture，降级为无 capture（move 阈值仍生效） */
        }
        posRef.current = { x: e.clientX, y: e.clientY }
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          posRef.current = null
          onLongPress(ch)
        }, ms)
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (timerRef.current === null || !posRef.current) return
        const dx = e.clientX - posRef.current.x
        const dy = e.clientY - posRef.current.y
        if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
          cancel()
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* noop */
          }
        }
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        cancel()
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
      },
      onPointerLeave: () => {
        // capture 期间 pointerleave 被抑制，不会误杀；
        // 仅在 capture 不可用时作为兜底取消。
        cancel()
      },
      onPointerCancel: () => {
        cancel()
      },
    }),
    [cancel, onLongPress, ms],
  )

  return makeHandlers
}
