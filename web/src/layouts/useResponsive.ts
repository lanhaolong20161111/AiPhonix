/** 响应式断点 hook — 按 viewport 宽度返回布局档位，不做设备判断 */

import { useEffect, useState } from "react"

export type ResponsiveMode = "mobile" | "tablet" | "desktop"

export const BREAKPOINTS = {
  tablet: 640,
  desktop: 1100,
} as const

export function getMode(width: number): ResponsiveMode {
  if (width < BREAKPOINTS.tablet) return "mobile"
  if (width < BREAKPOINTS.desktop) return "tablet"
  return "desktop"
}

export function useResponsive(): ResponsiveMode {
  const [mode, setMode] = useState<ResponsiveMode>(() =>
    getMode(typeof window === "undefined" ? 800 : window.innerWidth),
  )

  useEffect(() => {
    const onResize = () => setMode(getMode(window.innerWidth))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return mode
}
