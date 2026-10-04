/** 首页 — 宫格磁贴布局：小节标签 + 紧凑方块（图标+标题），一屏尽收、无需反复滚动
 *
 *  磁贴内容来自 modules/registry（唯一真源），本文件只负责渲染与「常用靠前」排序；
 *  ★ 新增入口请改 src/modules/catalog.ts，不要在这里加死数据。
 *
 *  分组（拼音/课本字词/视频/动画学数学/学习工具）不再折叠展开，直接拍平为小节磁贴；
 *  副标题收入 title 悬停提示；训练任务完成态以 ✓ 角标展示；
 *  访问频次只影响节内排序（常用靠前），不再显示 🔥 徽标。
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { fetchPlan, featureById, type PlanItem } from "../services/training"
import { SettingsSheet } from "../components/SettingsSheet"
import { useVisitCounts, recordVisit, sortByVisits } from "../lib/visitCounts"
import { APP_VERSION } from "../lib/appVersion"
import { ENABLED_ROUTES, FEATURE_ROUTES, HOME_SECTIONS } from "../modules/registry"
import type { SkillModule } from "../modules/types"

interface TileEntry {
  to: string
  emoji: string
  title: string
  /** 副标题：悬停提示用，不占版面 */
  subtitle: string
  /** 对应训练任务 feature（用于显示完成 ✓） */
  feature?: string
}

/** 模块声明 → 磁贴（首页只认这个形状，其余字段一律不关心） */
function toTile(m: SkillModule): TileEntry {
  return {
    to: m.route,
    emoji: m.icon,
    title: m.title,
    subtitle: m.subtitle ?? "",
    feature: m.training === true ? m.id : undefined,
  }
}

/** 首页小节：扁平磁贴，不再折叠（分组与顺序由 registry 决定） */
const SECTIONS = HOME_SECTIONS.map((s) => ({
  key: s.key,
  label: s.label,
  entries: s.modules.map(toTile),
}))

function Tile({ to, emoji, title, subtitle, done }: TileEntry & { done?: boolean }) {
  return (
    <Link to={to} className="home-tile" title={subtitle} onClick={() => recordVisit(to)}>
      {done === true && <span className="home-tile-done" title="今日已完成">✓</span>}
      <span className="home-tile-icon">{emoji}</span>
      <span className="home-tile-title">{title}</span>
    </Link>
  )
}

function Section({ label, entries, doneByRoute }: {
  label: string
  entries: TileEntry[]
  doneByRoute: Map<string, boolean>
}) {
  if (entries.length === 0) return null
  return (
    <section className="home-section">
      <p className="home-section-label">{label}</p>
      <div className="home-grid">
        {entries.map((e) => (
          <Tile key={e.to} {...e} done={e.feature ? doneByRoute.get(e.to) : undefined} />
        ))}
      </div>
    </section>
  )
}

export function HomePage() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const planQ = useQuery({
    queryKey: ["training", "plan"],
    queryFn: fetchPlan,
    staleTime: 30_000,
  })

  // 训练任务完成状态，按路由索引
  const items: PlanItem[] = planQ.data?.items ?? []
  const doneByRoute = new Map<string, boolean>()
  for (const item of items) {
    if (!featureById(item.feature)?.training) continue
    doneByRoute.set(FEATURE_ROUTES[item.feature] ?? `/module/${item.feature}`, item.done)
  }

  // 小节已覆盖的条目不再重复出现在「今日任务」；指向已裁剪模块的链接一并挡掉
  const sectionRoutes = new Set(SECTIONS.flatMap((s) => s.entries.map((e) => e.to)))
  const planEntries: TileEntry[] = items
    .filter((i) => featureById(i.feature)?.training)
    .map((item) => {
      const feature = featureById(item.feature)!
      const to = FEATURE_ROUTES[item.feature] ?? `/module/${item.feature}`
      return { to, emoji: feature.emoji, title: feature.title, subtitle: feature.subtitle }
    })
    .filter((e) => !sectionRoutes.has(e.to) && ENABLED_ROUTES.has(e.to))

  // 访问频次：点击越多的入口在节内排得越靠前（登录态走服务端，跟随账户）
  const { counts } = useVisitCounts()

  return (
    <div className="page home-page">
      <header className="module-header home-header">
        <h1>🏠 AiPhonix</h1>
        <button
          className="home-settings-btn"
          onClick={() => setSettingsOpen(true)}
          title="设置：音色 / 助记词"
          aria-label="打开设置"
        >
          ⚙️
        </button>
      </header>

      {SECTIONS.map((s) => (
        <Section key={s.key} label={s.label} entries={sortByVisits(s.entries, counts)} doneByRoute={doneByRoute} />
      ))}
      {planEntries.length > 0 && (
        <Section label="今日任务" entries={sortByVisits(planEntries, counts)} doneByRoute={doneByRoute} />
      )}

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* 版号角标：部署核对用（与部署汇报的版号对照） */}
      <span className="app-version" title="当前版本（部署后请对照核对）">v{APP_VERSION}</span>
    </div>
  )
}
