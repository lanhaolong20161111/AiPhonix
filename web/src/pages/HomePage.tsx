/** 首页 — 分组模块入口（组卡片点击展开子条目）+ 独立入口 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { fetchPlan, featureById, type PlanItem } from "../services/training"
import { SettingsSheet } from "../components/SettingsSheet"
import { useVisitCounts, recordVisit, sortByVisits } from "../lib/visitCounts"

/** 已实现模块的实际路由（未实现走占位页） */
const FEATURE_ROUTES: Record<string, string> = {
  recognition: "/module/recognition",
  dictation: "/module/dictation",
  word_practice: "/module/word_practice",
  english_learning: "/module/english_learning",
  char_image: "/module/char_image",
  oral_writing: "/module/oral_writing",
  ai_practice: "/module/ai_practice",
  ai_homework: "/module/ai_homework",
  ai_chinese: "/module/ai_chinese",
  video_practice: "/module/video_practice",
  quiz_practice: "/module/quiz_practice",
  pinyin: "/pinyin",
}

interface ChildEntry {
  to: string
  emoji: string
  title: string
  subtitle: string
  /** 对应训练任务 feature（用于显示完成 ✓） */
  feature?: string
}

/** 入口分组：点击组卡片展开/收起子条目 */
const GROUPS: Array<{ key: string; emoji: string; title: string; subtitle: string; children: ChildEntry[] }> = [
  {
    key: "pinyin",
    emoji: "🔤",
    title: "拼音",
    subtitle: "拼音练习 · 拼音表",
    children: [
      { to: "/pinyin", emoji: "🔤", title: "拼音练习", subtitle: "看拼音读，SOE 评测 · 总分≥70 进下一关", feature: "pinyin" },
      { to: "/module/pinyin-index", emoji: "📖", title: "拼音表", subtitle: "声母 · 韵母 · 整体认读音节 · 点读发声" },
    ],
  },
  {
    key: "textbook",
    emoji: "📘",
    title: "课本字词",
    subtitle: "认字 · 默写 · 词语",
    children: [
      { to: "/module/recognition", emoji: "🔤", title: "认字", subtitle: "看图认汉字，跟读发音", feature: "recognition" },
      { to: "/module/dictation", emoji: "✏️", title: "默写", subtitle: "听音写字，检验掌握", feature: "dictation" },
      { to: "/module/word_practice", emoji: "📚", title: "词语", subtitle: "词语跟读与辨析", feature: "word_practice" },
    ],
  },
  {
    key: "video",
    emoji: "📺",
    title: "视频学习",
    subtitle: "视频跟读 · 字幕采集",
    children: [
      { to: "/module/video_practice", emoji: "🎬", title: "视频跟读", subtitle: "跟读视频练发音", feature: "video_practice" },
      { to: "/module/subtitle_capture", emoji: "🎞️", title: "字幕截图采集", subtitle: "框选影片字幕 · 截屏存盘带时间戳" },
    ],
  },
]

/** 不入组的独立固定入口 */
const STANDALONE: ChildEntry[] = [
  { to: "/module/murmur", emoji: "💬", title: "碎碎念", subtitle: "自由表达 → AI 纠错 → 朗读 + 测评" },
  { to: "/module/char_image", emoji: "🖼️", title: "看图识字词句", subtitle: "识字 · 识词 · 识句 · 左右滑动" },
  { to: "/module/wordbook", emoji: "📓", title: "生词本", subtitle: "长按收生字 · 每日间隔复习" },
  { to: "/module/sentence_practice", emoji: "✏️", title: "造句练习", subtitle: "用一个词写句话，AI 老师批改" },
  { to: "/module/char_map", emoji: "🗺️", title: "汉字地图", subtitle: "点亮学过的每一个字" },
  { to: "/module/diary", emoji: "📖", title: "成长日记", subtitle: "每天一句话，AI 帮你记下来" },
  { to: "/module/radical_game", emoji: "🔮", title: "偏旁魔法屋", subtitle: "声旁猜读音，形旁猜意思" },
]

function EntryCard({
  to, emoji, title, subtitle, done, hot,
}: {
  to: string
  emoji: string
  title: string
  subtitle: string
  done?: boolean
  hot?: boolean
}) {
  return (
    <Link to={to} className="home-entry" onClick={() => recordVisit(to)}>
      <span className="home-entry-icon">{emoji}</span>
      <span className="home-entry-body">
        <span className="home-entry-title">
          {title}
          {hot && <span className="home-entry-hot" title="常用入口">🔥</span>}
        </span>
        <span className="home-entry-subtitle">{subtitle}</span>
      </span>
      {done === true ? (
        <span className="home-entry-state ok">✓</span>
      ) : (
        <span className="home-entry-state">→</span>
      )}
    </Link>
  )
}

function GroupCard({
  group, open, onToggle, doneByRoute, counts,
}: {
  group: (typeof GROUPS)[number]
  open: boolean
  onToggle: () => void
  doneByRoute: Map<string, boolean>
  counts: Record<string, number>
}) {
  return (
    <div className="home-group">
      <button type="button" className="home-entry home-group-head" onClick={onToggle} aria-expanded={open}>
        <span className="home-entry-icon">{group.emoji}</span>
        <span className="home-entry-body">
          <span className="home-entry-title">{group.title}</span>
          <span className="home-entry-subtitle">{group.subtitle}</span>
        </span>
        <span className={`home-entry-chevron${open ? " open" : ""}`}>▸</span>
      </button>
      {open && (
        <div className="home-group-children">
          {group.children.map((c) => {
            const done = c.feature ? doneByRoute.get(c.to) : undefined
            const hot = (counts[c.to] ?? 0) > 0
            return (
              <Link key={c.to} to={c.to} className="home-child" onClick={() => recordVisit(c.to)}>
                <span className="home-child-icon">{c.emoji}</span>
                <span className="home-entry-body">
                  <span className="home-child-title">
                    {c.title}
                    {hot && <span className="home-entry-hot" title="常用入口">🔥</span>}
                  </span>
                  <span className="home-child-subtitle">{c.subtitle}</span>
                </span>
                {done === true ? (
                  <span className="home-entry-state ok">✓</span>
                ) : (
                  <span className="home-entry-state">→</span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function HomePage() {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)

  const planQ = useQuery({
    queryKey: ["training", "plan"],
    queryFn: fetchPlan,
    staleTime: 30_000,
  })

  // 训练任务完成状态，按路由索引（组内子条目与独立条目共用）
  const items: PlanItem[] = planQ.data?.items ?? []
  const doneByRoute = new Map<string, boolean>()
  for (const item of items) {
    if (!featureById(item.feature)?.training) continue
    doneByRoute.set(FEATURE_ROUTES[item.feature] ?? `/module/${item.feature}`, item.done)
  }

  // 分组已覆盖的子条目不再重复出现在独立列表
  const groupedRoutes = new Set(GROUPS.flatMap((g) => g.children.map((c) => c.to)))
  const standaloneRoutes = new Set([...STANDALONE.map((s) => s.to), ...groupedRoutes])
  const planEntries = items
    .filter((i) => featureById(i.feature)?.training)
    .map((item) => {
      const feature = featureById(item.feature)!
      const to = FEATURE_ROUTES[item.feature] ?? `/module/${item.feature}`
      return { to, emoji: feature.emoji, title: feature.title, subtitle: feature.subtitle, done: item.done }
    })
    .filter((e) => !standaloneRoutes.has(e.to))

  // 访问频次：点击越多的入口排得越靠前（登录态走服务端，跟随账户）
  const { counts } = useVisitCounts()
  const sortedGroups = GROUPS.map((g) => ({ ...g, children: sortByVisits(g.children, counts) }))
  const sortedStandalone = sortByVisits(STANDALONE, counts)
  const sortedPlan = sortByVisits(planEntries, counts)

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
      <div className="home-entries">
        {sortedGroups.map((g) => (
          <GroupCard
            key={g.key}
            group={g}
            open={openKeys.has(g.key)}
            onToggle={() => toggle(g.key)}
            doneByRoute={doneByRoute}
            counts={counts}
          />
        ))}
        {sortedStandalone.map((s) => (
          <EntryCard key={s.to} {...s} done={doneByRoute.get(s.to)} hot={(counts[s.to] ?? 0) > 0} />
        ))}
        {sortedPlan.map((e) => (
          <EntryCard key={e.to} {...e} hot={(counts[e.to] ?? 0) > 0} />
        ))}
      </div>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
