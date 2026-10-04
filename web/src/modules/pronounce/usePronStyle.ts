/** 英式/美式音标记法偏好（localStorage 持久化，默认英式，与 Android 一致） */

import { useState } from "react"
import type { PronStyle } from "../../lib/arpabet"

const KEY = "ai_phonix_pron_style"

function readInitial(): PronStyle {
  try {
    return localStorage.getItem(KEY) === "us" ? "us" : "uk"
  } catch {
    return "uk"
  }
}

export function usePronStyle() {
  const [style, setStyle] = useState<PronStyle>(readInitial)

  const set = (s: PronStyle) => {
    setStyle(s)
    try {
      localStorage.setItem(KEY, s)
    } catch {
      /* 忽略 */
    }
  }

  return { style, setStyle: set }
}
