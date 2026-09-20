/** 用户偏好单一数据源 — 服务端按账户持久化（跨设备/跨浏览器保留，跟随账户），
 * 未登录或请求失败回退本地 localStorage（保证功能仍可用）。
 *
 * 双源模型（P1-7 修正）：
 * - 登录态：服务端值为权威（serverPrefs），本地 localStorage 仅作离线/换设备回退缓存。
 * - 未登录态：以本地 localStorage（localPrefs）为准。
 * - 切换账号：按 user_id 重新 hydrate，旧账号的服务端值立即作废，杜绝 A→B 偏好串味。
 *
 * 整包结构：{ voiceByModule?: Record<module, VoiceId>, roleByModule?: Record<module, AiRole>, mnemonicVisible?: boolean }
 * aiPrefs / mnemonicPref 均委托本模块读写，对外 API 不变。
 */

import { useEffect, useState } from "react"
import { api } from "../services/api"
import { useAuthStore } from "../stores/authStore"

export interface UserPrefs {
  voiceByModule?: Record<string, string>
  roleByModule?: Record<string, string>
  mnemonicVisible?: boolean
  /** 英文单词是否按发音规律着色（默认开，见 lib/phonicsPref） */
  phonicsColor?: boolean
}

const LS_KEY = "aiphonix:user:prefs"

function readLocal(): UserPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as UserPrefs) : {}
  } catch {
    return {}
  }
}

function writeLocal(p: UserPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p))
  } catch {
    /* 隐私模式等忽略 */
  }
}

/** 未登录/离线缓存（始终落盘，供离线回退与换设备预填） */
let localPrefs: UserPrefs = readLocal()
/** 登录后服务端权威值；null = 尚未 hydrate 或当前未登录 */
let serverPrefs: UserPrefs | null = null
/** 已成功 hydrate 的账户 id；切换账号即作废旧服务端值 */
let hydratedUserId: number | null = null

const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribePrefs(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 当前应展示的偏好：登录态以服务端为准，未登录以本地为准 */
export function getPrefs(): UserPrefs {
  const token = useAuthStore.getState().session?.access_token
  if (token && serverPrefs) return serverPrefs
  return localPrefs
}

function persistLocal(): void {
  writeLocal(localPrefs)
}

/** 登录后从服务端拉取账户偏好（换设备/换浏览器后同步），服务端优先 */
function hydrateFromServer(): void {
  const session = useAuthStore.getState().session
  const token = session?.access_token
  const uid = session?.user?.user_id
  if (!token || !uid) return
  // 本账号已 hydrate 过则跳过；切换账号（uid 变化）时 serverPrefs 已被清，会重新拉取
  if (hydratedUserId === uid && serverPrefs) return
  api<{ prefs: UserPrefs }>("/prefs", { method: "GET", auth: true })
    .then((res) => {
      serverPrefs = res.prefs ?? {}
      hydratedUserId = uid
      // 把服务端值回写本地缓存（离线/换设备回退），本地独有键保留
      localPrefs = { ...localPrefs, ...serverPrefs }
      persistLocal()
      emit()
    })
    .catch(() => {
      /* 拉取失败：保持现有本地值，下次登录态变化再试 */
    })
}

// 模块加载时：已登录立即拉取；登录态/账号变化（含 token 刷新、切换账号）时再拉取一次
if (typeof window !== "undefined") {
  let lastToken = useAuthStore.getState().session?.access_token ?? ""
  let lastUid = useAuthStore.getState().session?.user?.user_id ?? null
  if (lastToken) hydrateFromServer()
  useAuthStore.subscribe((s) => {
    const t = s.session?.access_token ?? ""
    const u = s.session?.user?.user_id ?? null
    // 切换到不同账号：立即作废旧服务端值，避免 A 的偏好串到 B
    if (t && u !== lastUid) {
      serverPrefs = null
      hydratedUserId = null
    }
    if (t && t !== lastToken) hydrateFromServer()
    lastToken = t
    lastUid = u
  })
}

/** 局部更新偏好：合并顶层字段 → 持久化 + 通知订阅者 + 同步服务端（登录态） */
export function updatePrefs(partial: Partial<UserPrefs>): void {
  const token = useAuthStore.getState().session?.access_token
  if (token) {
    serverPrefs = { ...(serverPrefs ?? {}), ...partial }
    localPrefs = { ...localPrefs, ...partial }
  } else {
    localPrefs = { ...localPrefs, ...partial }
  }
  persistLocal()
  emit()
  if (token) {
    void api("/prefs", { method: "PUT", auth: true, body: { prefs: serverPrefs ?? localPrefs } }).catch(() => {})
  }
}

/** 订阅整包偏好的 React hook（任意字段变化均触发重渲染） */
export function usePrefs(): UserPrefs {
  const [p, setP] = useState<UserPrefs>(getPrefs())
  useEffect(() => subscribePrefs(() => setP(getPrefs())), [])
  return p
}
