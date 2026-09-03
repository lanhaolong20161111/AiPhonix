/** 识别计时器 — 大模型识别图片文本期间的实时耗时显示（识别全程累计计数） */

import { useEffect, useState } from "react"

export function ParseTimer({ active }: { active: boolean }) {
  const [sec, setSec] = useState(0)

  useEffect(() => {
    if (!active) {
      setSec(0)
      return
    }
    const t0 = Date.now()
    setSec(Math.floor((Date.now() - t0) / 1000))
    const t = window.setInterval(function () {
      setSec(Math.floor((Date.now() - t0) / 1000))
    }, 500)
    return function () {
      window.clearInterval(t)
    }
  }, [active])

  if (!active) return null
  return (
    <span className="parse-timer">
      ⏱ {sec} 秒
    </span>
  )
}
