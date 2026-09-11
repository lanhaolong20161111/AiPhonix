/** 首页 — 宫格磁贴布局：小节标签 + 紧凑方块（图标+标题），一屏尽收、无需反复滚动
 *
 * 分组（拼音/课本字词/视频）不再折叠展开，直接拍平为小节磁贴；
 * 副标题收入 title 悬停提示；训练任务完成态以 ✓ 角标展示；
 * 访问频次只影响节内排序（常用靠前），不再显示 🔥 徽标。
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { fetchPlan, featureById, type PlanItem } from "../services/training"
import { SettingsSheet } from "../components/SettingsSheet"
import { useVisitCounts, recordVisit, sortByVisits } from "../lib/visitCounts"
import { APP_VERSION } from "../lib/appVersion"

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

interface TileEntry {
  to: string
  emoji: string
  title: string
  /** 副标题：悬停提示用，不占版面 */
  subtitle: string
  /** 对应训练任务 feature（用于显示完成 ✓） */
  feature?: string
}

/** 首页小节：扁平磁贴，不再折叠 */
const SECTIONS: Array<{ key: string; label: string; entries: TileEntry[] }> = [
  {
    key: "pinyin",
    label: "拼音",
    entries: [
      { to: "/pinyin", emoji: "🔤", title: "拼音练习", subtitle: "看拼音读，SOE 评测 · 总分≥70 进下一关", feature: "pinyin" },
      { to: "/module/pinyin-index", emoji: "📖", title: "拼音表", subtitle: "声母 · 韵母 · 整体认读音节 · 点读发声" },
    ],
  },
  {
    key: "textbook",
    label: "课本字词",
    entries: [
      { to: "/module/recognition", emoji: "🔤", title: "认字", subtitle: "看图认汉字，跟读发音", feature: "recognition" },
      { to: "/module/dictation", emoji: "✏️", title: "默写", subtitle: "听音写字，检验掌握", feature: "dictation" },
      { to: "/module/word_practice", emoji: "📚", title: "词语", subtitle: "词语跟读与辨析", feature: "word_practice" },
    ],
  },
  {
    key: "video",
    label: "视频",
    entries: [
      { to: "/module/video_practice", emoji: "🎬", title: "视频跟读", subtitle: "跟读视频练发音", feature: "video_practice" },
      { to: "/module/subtitle_capture", emoji: "🎞️", title: "字幕采集", subtitle: "框选影片字幕 · 截屏存盘带时间戳" },
    ],
  },
  {
    key: "tools",
    label: "学习工具",
    entries: [
      { to: "/module/murmur", emoji: "💬", title: "碎碎念", subtitle: "自由表达 → AI 纠错 → 朗读 + 测评" },
      { to: "/module/char_image", emoji: "🖼️", title: "看图识字", subtitle: "识字 · 识词 · 识句 · 左右滑动" },
      { to: "/module/wordbook", emoji: "📓", title: "生词本", subtitle: "点读收生字 · 每日间隔复习" },
      { to: "/module/memory_joy", emoji: "🌟", title: "记忆快乐本", subtitle: "今日字词自动编成小故事" },
      { to: "/module/sentence_practice", emoji: "✏️", title: "造句练习", subtitle: "用一个词写句话，AI 老师批改" },
      { to: "/module/oral_writing", emoji: "🎙️", title: "口述作文", subtitle: "看图/听题口述表达，AI 评分润色" },
      { to: "/module/speech_compose", emoji: "🤖", title: "AI 对话学语文", subtitle: "一问一答学语文，粘贴文章分句背诵跟读" },
      { to: "/module/ai_english_talk", emoji: "💬", title: "AI 英语对话", subtitle: "和 AI 用英语聊天，卡住有提示" },
      { to: "/module/char_map", emoji: "🗺️", title: "汉字地图", subtitle: "点亮学过的每一个字" },
      { to: "/module/diary", emoji: "📖", title: "成长日记", subtitle: "每天一句话，AI 帮你记下来" },
      { to: "/module/radical_game", emoji: "🔮", title: "偏旁魔法屋", subtitle: "声旁猜读音，形旁猜意思" },
      { to: "/module/courseware_manager", emoji: "📚", title: "课件库", subtitle: "上传/管理语数英课件图片" },
    ],
  },
]

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

  // 小节已覆盖的条目不再重复出现在「今日任务」
  const sectionRoutes = new Set(SECTIONS.flatMap((s) => s.entries.map((e) => e.to)))
  const planEntries: TileEntry[] = items
    .filter((i) => featureById(i.feature)?.training)
    .map((item) => {
      const feature = featureById(item.feature)!
      const to = FEATURE_ROUTES[item.feature] ?? `/module/${item.feature}`
      return { to, emoji: feature.emoji, title: feature.title, subtitle: feature.subtitle }
    })
    .filter((e) => !sectionRoutes.has(e.to))

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
