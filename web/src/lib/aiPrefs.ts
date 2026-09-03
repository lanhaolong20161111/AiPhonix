/** AI 对话偏好 — 角色（按模块）与音色（按模块），统一委托 userPrefs 持久化。
 *
 * 登录态：写入服务端、按账户隔离（跨设备 / 跨浏览器保留，跟随账户）。
 * 未登录态：回退本地 localStorage（见 userPrefs.ts）。
 * 本文件只保留对外 API（getVoice/setVoice/useVoice、getAiRole/setAiRole/useAiRole）与目录常量。
 */

import { useCallback, useEffect, useState } from "react"
import { getPrefs, subscribePrefs, updatePrefs } from "./userPrefs"

export type AiRole = "" | "libai" | "wukong" | "foreigner" | "teacher_gao" | "student"
export type VoiceId = "0" | "1" | "3" | "4"

/** 音色目录（百度 TTS speaker id） */
export const VOICES: Array<{ id: VoiceId; label: string }> = [
  { id: "0", label: "🧑‍🏫 老师" },
  { id: "1", label: "🧑‍🎓 学长" },
  { id: "3", label: "🙇 爷爷" },
  { id: "4", label: "👧 童声" },
]

/** 角色目录（语文模块显示；空 = 默认老师） */
export const ROLES: Array<{ id: AiRole; label: string; emoji: string }> = [
  { id: "", label: "老师", emoji: "🧑‍🏫" },
  { id: "libai", label: "李白", emoji: "🍶" },
  { id: "wukong", label: "悟空", emoji: "🐒" },
  { id: "foreigner", label: "Mike", emoji: "🇺🇸" },
  { id: "teacher_gao", label: "高老师", emoji: "📚" },
  { id: "student", label: "小豆(学生)", emoji: "🧒" },
]

// ── 角色（按模块） ──

export function getAiRole(module: string): AiRole {
  return (getPrefs().roleByModule?.[module] ?? "") as AiRole
}

export function setAiRole(module: string, role: AiRole): void {
  updatePrefs({ roleByModule: { ...getPrefs().roleByModule, [module]: role } })
}

export function useAiRole(module: string): [AiRole, (r: AiRole) => void] {
  const [role, setRole] = useState<AiRole>(() => getAiRole(module))
  useEffect(() => {
    const fn = () => setRole(getAiRole(module))
    return subscribePrefs(fn)
  }, [module])
  const set = useCallback((r: AiRole) => setAiRole(module, r), [module])
  return [role, set]
}

// ── 音色（按模块：语文 chinese / 英语 english / 数学 math 各存一个默认音色） ──

const MODULES = ["english", "math", "chinese"]

function normModule(module: string): string {
  return MODULES.includes(module) ? module : "chinese"
}

/** 该模块的默认音色（未设置时落回 "0" 老师） */
export function getVoice(module: string): VoiceId {
  const m = normModule(module)
  return (getPrefs().voiceByModule?.[m] ?? "0") as VoiceId
}

export function setVoice(module: string, v: VoiceId): void {
  const m = normModule(module)
  updatePrefs({ voiceByModule: { ...getPrefs().voiceByModule, [m]: v } })
}

export function useVoice(module: string): [VoiceId, (v: VoiceId) => void] {
  const [v, setV] = useState<VoiceId>(() => getVoice(module))
  useEffect(() => {
    const fn = () => setV(getVoice(module))
    return subscribePrefs(fn)
  }, [module])
  const set = useCallback((nv: VoiceId) => setVoice(module, nv), [module])
  return [v, set]
}
