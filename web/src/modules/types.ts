/** 模块（skill）契约 —— 全应用唯一的「有哪些功能」声明。
 *
 * 设计意图：路由表、首页磁贴、训练打卡目录，全部由 modules/registry 从这份声明**派生**，
 * 不再各处手抄（此前散落 4 处：routes.tsx / HomePage.SECTIONS / HomePage.FEATURE_ROUTES /
 * services/training.FEATURES，漏改就出现「首页有入口、路由没有」）。
 *
 * 新增一个功能 = catalog.ts 里加一条 + 建一个页面文件，别的都不用动。
 *
 * ⚠️ 训练模块的 `id` 同时充当**打卡 feature id**（与后端 /training/plan 的 feature 字段对齐），
 *    改 id 必须同步后端已有 plan 数据与 Android 侧 FeatureCatalog。
 */

import type { ComponentType } from "react"

/** 首页分组；决定磁贴归到哪个小节 */
export type SkillGroup = "pinyin" | "textbook" | "video" | "math" | "tools"

/** 路由守卫：auth = 需登录（默认）；guest = 仅未登录可见（登录/注册页） */
export type ModuleGuard = "auth" | "guest"

/** 页面懒加载工厂（React.lazy 的入参形状） */
export type ModuleLoader = () => Promise<{ default: ComponentType<any> }>

export interface SkillModule {
  /** 唯一 id；训练模块同时是打卡 feature id */
  id: string
  /** 路由路径，必须以 "/" 开头 */
  route: string
  /** 首页磁贴标题（也用于占位页/开发工具） */
  title: string
  /** 首页磁贴图标（emoji） */
  icon: string
  /** 磁贴悬停副标题 */
  subtitle?: string
  /** 归属分组（tile !== false 时必填，由 registry 自检强制） */
  group?: SkillGroup
  /** 是否出现在首页磁贴；false = 只在路由里可达（详情页、跳转页、调试页） */
  tile?: boolean
  /** 路由守卫，默认 "auth" */
  guard?: ModuleGuard
  /** 是否纳入每日训练打卡（家长 plan / 首页 ✓ 角标 / FEATURES 目录） */
  training?: boolean
  /** 页面组件懒加载入口 */
  load: ModuleLoader
}
