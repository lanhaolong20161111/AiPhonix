/** 横向翻页吸附工具 — 滑动结束后平滑吸附到相邻一页（最多翻一页）
 *
 * 替代 CSS scroll-snap：scroll-snap 在快速滑动时会被浏览器预测到好几页之外。
 * 这里限制吸附目标 = 当前页 ± 1，保证"一次最多翻一页"。
 */

export function scheduleSwipeSnap(
  el: HTMLDivElement,
  timerRef: { current: number | undefined },
  getCurrent: () => number,
  onSnap: (target: number) => void,
) {
  window.clearTimeout(timerRef.current)
  timerRef.current = window.setTimeout(() => {
    const w = el.clientWidth
    if (!w) return
    const cur = getCurrent()
    const raw = Math.round(el.scrollLeft / w)
    // 最多相邻一页：从当前页出发，目标 ∈ [cur-1, cur+1]
    const target = Math.min(Math.max(raw, cur - 1), cur + 1)
    const targetLeft = target * w
    if (Math.abs(el.scrollLeft - targetLeft) > w * 0.02) {
      el.scrollTo({ left: targetLeft, behavior: "smooth" })
    }
    onSnap(target)
  }, 140)
}
