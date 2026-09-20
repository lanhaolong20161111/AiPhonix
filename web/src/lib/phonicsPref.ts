/** 英文拼读着色开关 — 委托 userPrefs 持久化（登录态同步服务端、按账户隔离，未登录回退 localStorage）。
 *
 * 与 mnemonicPref 同一套模式：页面上任意一处切换，所有已挂载的着色组件立即联动，
 * 无需刷新页面。
 */

import { useCallback, useEffect, useState } from "react"
import { getPrefs, subscribePrefs, updatePrefs } from "./userPrefs"

/** 是否按发音规律给英文单词着色（默认开） */
export function getPhonicsColor(): boolean {
  return getPrefs().phonicsColor ?? true
}

export function usePhonicsColor(): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => getPhonicsColor())
  useEffect(() => {
    const sync = (): void => setOn(getPhonicsColor())
    return subscribePrefs(sync)
  }, [])
  const toggle = useCallback(() => {
    updatePrefs({ phonicsColor: !(getPrefs().phonicsColor ?? true) })
  }, [])
  return [on, toggle]
}
