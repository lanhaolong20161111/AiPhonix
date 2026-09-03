/** 用户偏好单一数据源 — 服务端按账户持久化（跨设备/跨浏览器保留，跟随账户），
 * 未登录或请求失败回退本地 localStorage（保证功能仍可用，登录后会被服务端覆盖）。
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

let prefs: UserPrefs = readLocal()
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

export function getPrefs(): UserPrefs {
  return prefs
}

function persistLocal(): void {
  writeLocal(prefs)
}

/** 登录态：整包写入服务端（与已存合并由服务端负责） */
function syncToServer(): void {
  const token = useAuthStore.getState().session?.access_token
  if (!token) return
  void api("/prefs", { method: "PUT", auth: true, body: { prefs } }).catch(() => {})
}

let hydrateStarted = false

/** 登录后从服务端拉取账户偏好（换设备/换浏览器后同步），服务端优先合并 */
function hydrateFromServer(): void {
  const token = useAuthStore.getState().session?.access_token
  if (!token || hydrateStarted) return
  hydrateStarted = true
  api<{ prefs: UserPrefs }>("/prefs", { method: "GET", auth: true })
    .then((res) => {
      const server = res.prefs ?? {}
      prefs = { ...prefs, ...server }
      persistLocal()
      emit()
    })
    .catch(() => {
      hydrateStarted = false
    })
}

// 模块加载时：已登录立即拉取；登录态变化（含 token 刷新）时再拉取一次
if (typeof window !== "undefined") {
  let lastToken = useAuthStore.getState().session?.access_token ?? ""
  if (lastToken) hydrateFromServer()
  useAuthStore.subscribe((s) => {
    const t = s.session?.access_token ?? ""
    if (t && t !== lastToken) hydrateFromServer()
    lastToken = t
  })
}

/** 局部更新偏好：合并顶层字段 → 本地持久化 + 通知订阅者 + 同步服务端 */
export function updatePrefs(partial: Partial<UserPrefs>): void {
  prefs = { ...prefs, ...partial }
  persistLocal()
  emit()
  syncToServer()
}

/** 订阅整包偏好的 React hook（任意字段变化均触发重渲染） */
export function usePrefs(): UserPrefs {
  const [p, setP] = useState<UserPrefs>(prefs)
  useEffect(() => subscribePrefs(() => setP(prefs)), [])
  return p
}
