/** 模块注册表 —— 由 catalog 派生出路由、首页磁贴、打卡目录，并提供自检。
 *
 * 消费方：
 *   routes.tsx             → AUTH_MODULES / GUEST_MODULES
 *   modules/home/index.tsx → HOME_SECTIONS / FEATURE_ROUTES / ENABLED_ROUTES
 *   services/training.ts   → TRAINING_MODULES
 *   modules/registry.test.ts → checkRegistry
 */

import { ALL_MODULES } from "./catalog"
import { ALWAYS_ON_SKILLS, parseEnabledSkills } from "./skillsSwitch"
import type { SkillGroup, SkillModule } from "./types"

export { ALL_MODULES }
export type { SkillGroup, SkillModule, ModuleGuard, ModuleLoader } from "./types"

/** 首页分组顺序 */
export const GROUP_ORDER: readonly SkillGroup[] = ["pinyin", "textbook", "video", "math", "tools"]

/** 首页分组显示名 */
export const GROUP_LABEL: Record<SkillGroup, string> = {
  pinyin: "拼音",
  textbook: "课本字词",
  video: "视频",
  math: "动画学数学",
  tools: "学习工具",
}

/** 即使被裁剪也必须保留的系统页（与 skillsCss.ts / vite.config.ts 共用一份清单，见 skillsSwitch.ts） */
const ALWAYS_ON = new Set(ALWAYS_ON_SKILLS)

/**
 * 构建期裁剪开关 `VITE_SKILLS`：解析规则见 `skillsSwitch.parseEnabledSkills`。
 * ⚠️ 纯 Node 环境（单测）没有 import.meta.env，必须容错。
 */
function readEnabledIds(): Set<string> | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  const list = parseEnabledSkills(env?.VITE_SKILLS)
  return list === null ? null : new Set(list)
}

const enabledIds = readEnabledIds()

/** 当前构建实际启用的模块（裁剪后） */
export const MODULES: SkillModule[] = enabledIds
  ? ALL_MODULES.filter((m) => enabledIds.has(m.id) || ALWAYS_ON.has(m.id))
  : ALL_MODULES

/** 挂在登录守卫下的模块（默认） */
export const AUTH_MODULES: SkillModule[] = MODULES.filter((m) => (m.guard ?? "auth") === "auth")

/** 仅在未登录时可达的模块（登录 / 注册） */
export const GUEST_MODULES: SkillModule[] = MODULES.filter((m) => m.guard === "guest")

export interface HomeSection {
  key: SkillGroup
  label: string
  modules: SkillModule[]
}

/** 首页磁贴（按分组顺序，组内顺序 = catalog 声明顺序） */
export const HOME_SECTIONS: HomeSection[] = GROUP_ORDER.map((key) => ({
  key,
  label: GROUP_LABEL[key],
  modules: MODULES.filter((m) => m.tile !== false && m.group === key),
})).filter((s) => s.modules.length > 0)

/** 纳入每日打卡的模块（services/training 的 FEATURES 由它派生） */
export const TRAINING_MODULES: SkillModule[] = MODULES.filter((m) => m.training === true)

/** feature id → 路由（首页 ✓ 角标映射用） */
export const FEATURE_ROUTES: Record<string, string> = Object.fromEntries(
  ALL_MODULES.filter((m) => m.training === true).map((m) => [m.id, m.route]),
)

/** 本次构建实际注册的路由集合（用于挡掉指向已裁剪模块的链接） */
export const ENABLED_ROUTES: ReadonlySet<string> = new Set(MODULES.map((m) => m.route))

/**
 * 注册表自检 —— 返回问题清单，空数组 = 通过。
 * 这是「清单只留一处」的安全网：漏 group / 路由撞车 / id 重复都会在这里当场炸出来。
 */
export function checkRegistry(mods: readonly SkillModule[] = ALL_MODULES): string[] {
  const problems: string[] = []
  const seenId = new Set<string>()
  const seenRoute = new Set<string>()
  const seenTitle = new Set<string>()

  for (const m of mods) {
    if (!/^[a-z][a-z0-9_]*$/.test(m.id)) problems.push(`id 不合法（只允许小写字母/数字/下划线）：${JSON.stringify(m.id)}`)
    if (seenId.has(m.id)) problems.push(`id 重复：${m.id}`)
    seenId.add(m.id)

    if (!m.route.startsWith("/")) problems.push(`${m.id} 的 route 必须以 / 开头：${m.route}`)
    if (seenRoute.has(m.route)) problems.push(`route 重复：${m.route}`)
    seenRoute.add(m.route)

    if (typeof m.load !== "function") problems.push(`${m.id} 缺少 load()`)

    if (m.group !== undefined && !GROUP_ORDER.includes(m.group)) {
      problems.push(`${m.id} 的 group 不在 GROUP_ORDER 里：${m.group}`)
    }

    if (m.tile !== false) {
      if (!m.group) problems.push(`${m.id} 进首页磁贴，但没有 group`)
      if (!m.title) problems.push(`${m.id} 进首页磁贴，但没有 title`)
      if (!m.icon) problems.push(`${m.id} 进首页磁贴，但没有 icon`)
      const tileKey = `${m.group}/${m.title}`
      if (seenTitle.has(tileKey)) problems.push(`同组内磁贴标题重复：${tileKey}`)
      seenTitle.add(tileKey)
    }

    if (m.guard === "guest" && m.tile !== false) {
      problems.push(`${m.id} 是 guest 守卫页（登录/注册），不应出现在首页磁贴`)
    }
  }
  return problems
}
