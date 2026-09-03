/** Responsive Layout Audit 配置
 * 视口三档标准尺寸 + 页面清单（真实路由，取自 routes.tsx）。
 * 页面可带期望（Layout Contract 的轻量版）：maxContentWidth / mobileColumns。
 */

export interface ViewportDef { name: string; width: number; height: number; group: "mobile" | "tablet" | "desktop" }

export const VIEWPORTS: ViewportDef[] = [
  // Mobile
  { name: "m375", width: 375, height: 812, group: "mobile" },
  { name: "m390", width: 390, height: 844, group: "mobile" },
  { name: "m430", width: 430, height: 932, group: "mobile" },
  // Tablet
  { name: "t768", width: 768, height: 1024, group: "tablet" },
  { name: "t820", width: 820, height: 1180, group: "tablet" },
  { name: "t1024", width: 1024, height: 1366, group: "tablet" },
  // Desktop
  { name: "d1280", width: 1280, height: 800, group: "desktop" },
  { name: "d1440", width: 1440, height: 900, group: "desktop" },
  { name: "d1920", width: 1920, height: 1080, group: "desktop" },
]

/** 每页默认跑的视口：移动三档 + 平板 820 + 桌面 1440（9 档全跑会让报告爆炸） */
export const DEFAULT_VIEWPORTS: string[] = ["m375", "m390", "m430", "t820", "d1440"]

export interface PageExpect {
  /** 桌面主要内容期望的最大内容宽度（px）——R009 检 max-width 约束 */
  maxContentWidth?: number
  /** 移动端期望列数（1=单列规范）——R008 检 grid 孤列/异常列 */
  mobileColumns?: 1 | 2 | 3
}

export interface PageTarget {
  name: string
  url: string
  /** 需要登录（默认 true；/login 等免登录页传 false） */
  auth?: boolean
  /** 覆盖每页视口清单（默认 DEFAULT_VIEWPORTS） */
  viewports?: string[]
  expect?: PageExpect
  /** 渲染等待：goto 后额外等待 ms（懒加载/LLM 页给多点） */
  settleMs?: number
}

export const PAGES: PageTarget[] = [
  { name: "首页", url: "/web/home", settleMs: 1500 },
  { name: "认字", url: "/web/module/recognition", settleMs: 1800 },
  { name: "词语练习", url: "/web/module/word_practice", settleMs: 1800 },
  { name: "英语学习", url: "/web/module/english_learning", settleMs: 1800 },
  { name: "拼音表", url: "/web/module/pinyin-index", settleMs: 1800 },
  { name: "看图识字入口", url: "/web/module/char_image", settleMs: 1500 },
  { name: "看图识字·字卡(重)", url: "/web/module/char_image/practice?type=字", settleMs: 4000 },
  { name: "字幕采集", url: "/web/module/subtitle_capture", settleMs: 2500 },
  { name: "AI 语文", url: "/web/module/ai_chinese", settleMs: 2500 },
  { name: "AI 作业", url: "/web/module/ai_homework", settleMs: 2500 },
  { name: "登录页", url: "/web/login", auth: false, settleMs: 1000 },
]

/** 测试账号（对齐 PROJECT_MEMORY：webtest / test1234） */
export const TEST_USER = { username: "webtest", password: "test1234" }

export const BASE_URL = "https://127.0.0.1:5173"

/** 截图输出目录（相对 web/） */
export const SHOT_DIR = "responsive/shots"
/** 报告输出目录 */
export const REPORT_DIR = "responsive/reports"