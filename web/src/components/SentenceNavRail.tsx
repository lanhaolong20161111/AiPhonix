/** 句子导航条（固定在页面右侧）— 每句一个小圆圈
 *
 * - 一个小圆圈对应一个句子（文章/古诗的逐句练习）
 * - 已经跟读测评过（EchoLadder 过关）的圆圈亮起（绿色）
 * - 当前所在句子有高亮环
 * - 点圆圈跳到对应句子
 * 用在 SpeechComposePage 的文章 / 古诗模式。
 */
import { useEffect, useRef } from "react"

interface SentenceNavRailProps {
  /** 句子总数 */
  total: number
  /** 当前句子下标 */
  current: number
  /** 已测评（过关）的句子下标集合 */
  evaluated: Set<number>
  /** 跳到某句 */
  onJump: (i: number) => void
  /** 朗读/评测进行中时禁用跳转（与正文点击行为一致） */
  disabled?: boolean
}

export function SentenceNavRail({ total, current, evaluated, onJump, disabled }: SentenceNavRailProps) {
  const railRef = useRef<HTMLDivElement>(null)

  // 当前圈滚进可视区：句子多（长文章）时，导航条可滚动，自动把当前句圈带进视野
  useEffect(() => {
    const el = railRef.current?.querySelector<HTMLElement>(`.sentence-dot[data-i="${current}"]`)
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [current])

  if (total <= 1) return null // 只有一句没必要导航

  return (
    <div className="sentence-nav" ref={railRef} role="navigation" aria-label="句子导航">
      {Array.from({ length: total }, (_, i) => {
        const done = evaluated.has(i)
        const isCur = i === current
        return (
          <button
            key={i}
            type="button"
            className={`sentence-dot${done ? " done" : ""}${isCur ? " current" : ""}`}
            data-i={i}
            disabled={disabled}
            title={`第 ${i + 1} 句${done ? "（已测评）" : ""}`}
            aria-current={isCur ? "true" : undefined}
            onClick={() => onJump(i)}
          >
            {i + 1}
          </button>
        )
      })}
    </div>
  )
}
