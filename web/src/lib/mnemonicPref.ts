/** 助记词显示偏好 — 委托 userPrefs 持久化（登录态同步服务端、按账户隔离，未登录回退 localStorage）。
 *
 * 页面上每个「隐藏助记」开关、以及内部读取助记词的组件（PinyinChips 等）
 * 都通过 useMnemonicVisible() 得到同一份实时状态：任意一处点击切换，
 * 所有已挂载的组件立即联动更新，无需刷新页面。
 */

import { useCallback, useEffect, useState } from "react"
import { getPrefs, subscribePrefs, updatePrefs } from "./userPrefs"

/** 是否显示助记词（默认显示） */
export function getMnemonicVisible(): boolean {
  return getPrefs().mnemonicVisible ?? true
}

export function useMnemonicVisible(): [boolean, () => void] {
  const [visible, setVisible] = useState<boolean>(() => getMnemonicVisible())
  useEffect(() => {
    const sync = (): void => setVisible(getMnemonicVisible())
    return subscribePrefs(sync)
  }, [])
  const toggle = useCallback(() => {
    updatePrefs({ mnemonicVisible: !(getPrefs().mnemonicVisible ?? true) })
  }, [])
  return [visible, toggle]
}
