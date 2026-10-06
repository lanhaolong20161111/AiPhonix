/**
 * 模块注册表自检。
 *
 * 这是「清单只留一处」的安全网：以后任何人往 catalog.ts 加模块，
 * 漏 group / 路由撞车 / id 重复 / 打卡目录对不上 / 磁贴死链，
 * 都会在这里当场炸出来，而不是留到线上表现为「首页有入口、点进去空白」。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  ALL_MODULES,
  AUTH_MODULES,
  ENABLED_ROUTES,
  FEATURE_ROUTES,
  GUEST_MODULES,
  GROUP_ORDER,
  HOME_SECTIONS,
  MODULES,
  TRAINING_MODULES,
  checkRegistry,
} from "./registry.js"
import { FEATURES, featureById } from "../services/training.js"
import type { SkillModule } from "./types.js"

const stubLoad = async () => ({ default: () => null })

describe("模块注册表", () => {
  it("checkRegistry 在真实目录上无问题", () => {
    assert.deepEqual(checkRegistry(), [])
  })

  it("模块规模与唯一性", () => {
    assert.ok(ALL_MODULES.length >= 40, `模块数异常：${ALL_MODULES.length}`)
    assert.equal(new Set(ALL_MODULES.map((m) => m.id)).size, ALL_MODULES.length, "id 有重复")
    assert.equal(new Set(ALL_MODULES.map((m) => m.route)).size, ALL_MODULES.length, "route 有重复")
    assert.ok(ALL_MODULES.every((m) => m.title.length > 0), "有模块缺 title")
  })

  it("结构门禁：每个模块都有目录 modules/<id>/index.tsx，且没有孤儿目录", () => {
    const here = fileURLToPath(new URL(".", import.meta.url))
    const dirs = new Set(
      readdirSync(here, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    )
    for (const m of ALL_MODULES) {
      assert.ok(dirs.has(m.id), `模块 ${m.id} 没有对应目录 modules/${m.id}/`)
      assert.ok(existsSync(`${here}${m.id}/index.tsx`), `modules/${m.id}/ 缺 index.tsx`)
    }
    // 反向：目录必须在 catalog 里（home 是内核页，不在 catalog，白名单放行）
    const ids = new Set(ALL_MODULES.map((m) => m.id))
    const orphans = [...dirs].filter((d) => !ids.has(d) && d !== "home")
    assert.deepEqual(orphans, [], `有目录不在 catalog 里：${orphans.join("、")}`)
  })

  it("默认不裁剪（未设 VITE_SKILLS 时全量启用）", () => {
    assert.equal(MODULES.length, ALL_MODULES.length)
    assert.equal(ENABLED_ROUTES.size, ALL_MODULES.length)
  })

  it("路由划分不重不漏：auth + guest = 全部", () => {
    assert.equal(AUTH_MODULES.length + GUEST_MODULES.length, MODULES.length)
    assert.deepEqual(
      GUEST_MODULES.map((m) => m.route).sort(),
      ["/login", "/register"],
      "只有登录/注册该走 guest 守卫",
    )
  })

  it("首页磁贴与 tile 模块一一对应，且分组合法、非空", () => {
    const tiled = MODULES.filter((m) => m.tile !== false)
    const covered = HOME_SECTIONS.flatMap((s) => s.modules)
    assert.equal(covered.length, tiled.length, "有 tile 模块没进首页，或进了两次")
    assert.deepEqual(
      new Set(covered.map((m) => m.id)),
      new Set(tiled.map((m) => m.id)),
    )
    for (const s of HOME_SECTIONS) {
      assert.ok(GROUP_ORDER.includes(s.key), `未知分组：${s.key}`)
      assert.ok(s.modules.length > 0, `空分组不该出现在首页：${s.key}`)
      assert.ok(s.label.length > 0, `分组 ${s.key} 缺显示名`)
    }
  })

  it("磁贴不会指向已裁剪/不存在的路由（防死链）", () => {
    for (const s of HOME_SECTIONS) {
      for (const m of s.modules) {
        assert.ok(ENABLED_ROUTES.has(m.route), `死链：${m.id} → ${m.route}`)
      }
    }
  })

  it("打卡目录：TRAINING_MODULES ≡ FEATURES，且 FEATURE_ROUTES 指向自身路由", () => {
    assert.deepEqual(
      TRAINING_MODULES.map((m) => m.id),
      FEATURES.map((f) => f.id),
      "注册表的 training 标记与派生出的 FEATURES 不一致",
    )
    for (const m of TRAINING_MODULES) {
      assert.equal(FEATURE_ROUTES[m.id], m.route, `${m.id} 的 FEATURE_ROUTES 不等于模块 route`)
      assert.ok(featureById(m.id), `featureById 查不到 ${m.id}`)
    }
  })

  it("打卡条目带 title/subtitle（首页「今日任务」磁贴要显示）", () => {
    for (const f of FEATURES) {
      assert.ok(f.title.length > 0, `${f.id} 缺 title`)
      assert.ok(f.subtitle.length > 0, `${f.id} 缺 subtitle`)
      assert.ok(f.emoji.length > 0, `${f.id} 缺 emoji`)
    }
  })

  it("路由快照：与重构前 routes.tsx 逐条一致（一个页面都没丢）", () => {
    const expected = [
      "/login",
      "/register",
      "/module/:featureId",
      "/soe-demo",
      "/pinyin",
      "/module/pinyin-index",
      "/module/pinyin/:id",
      "/module/recognition",
      "/module/dictation",
      "/module/word_practice",
      "/module/english_learning",
      "/module/letters",
      "/module/letter/:char",
      "/module/phoneme-index",
      "/module/phoneme/:symbol",
      "/module/pronounce/:wordId",
      "/module/video_practice",
      "/module/subtitle_capture",
      "/module/quiz_practice",
      "/module/daily_practice",
      "/module/daily_chinese",
      "/module/daily_english",
      "/module/math_compound_expr",
      "/module/math_equation_move",
      "/module/math_units",
      "/module/math_mul_one",
      "/module/math_relations",
      "/module/murmur",
      "/module/char_image",
      "/module/wordbook",
      "/module/memory_joy",
      "/module/sentence_practice",
      "/module/oral_writing",
      "/module/speech_compose",
      "/module/ai_english_talk",
      "/module/char_map",
      "/module/diary",
      "/module/radical_game",
      "/module/courseware_manager",
      "/module/char_image/practice",
      "/module/soe_history",
      "/module/parent_report",
      "/module/ai_practice",
      "/module/ai-practice-chat/:sessionId",
      "/module/ai_homework",
      "/module/ai_chinese",
      "/module/ai_english",
      "/module/ai_parse_result",
      "/module/ai_history",
    ]
    const actual = ALL_MODULES.map((m) => m.route)
    assert.deepEqual([...actual].sort(), [...expected].sort())
  })

  it("首页磁贴快照：分组与小节内顺序与重构前一致", () => {
    assert.deepEqual(
      HOME_SECTIONS.map((s) => [s.label, s.modules.map((m) => m.route)]),
      [
        ["拼音", ["/pinyin", "/module/pinyin-index"]],
        ["课本字词", ["/module/recognition", "/module/dictation", "/module/word_practice"]],
        ["视频", ["/module/video_practice", "/module/subtitle_capture"]],
        ["动画学数学", [
          "/module/math_compound_expr",
          "/module/math_equation_move",
          "/module/math_units",
          "/module/math_mul_one",
          "/module/math_relations",
        ]],
        ["学习工具", [
          "/module/murmur",
          "/module/char_image",
          "/module/wordbook",
          "/module/memory_joy",
          "/module/sentence_practice",
          "/module/oral_writing",
          "/module/speech_compose",
          "/module/ai_english_talk",
          "/module/char_map",
          "/module/diary",
          "/module/radical_game",
          "/module/courseware_manager",
        ]],
      ],
    )
  })

  it("安全网本身有效：坏数据必须被抓出来", () => {
    const bad = [
      { id: "dup", route: "/a", title: "A", icon: "x", load: stubLoad },
      { id: "dup", route: "/a", title: "B", icon: "x", load: stubLoad },
      { id: "ok_id", route: "no-slash", title: "C", icon: "x", load: stubLoad },
      { id: "BadId", route: "/d", title: "D", icon: "x", load: stubLoad },
      { id: "e", route: "/e", title: "E", icon: "x", group: "nope" as never, load: stubLoad },
      { id: "f", route: "/f", title: "F", icon: "x", guard: "guest", load: stubLoad },
    ] satisfies SkillModule[]
    const problems = checkRegistry(bad)
    const joined = problems.join(" | ")
    for (const frag of ["id 重复", "route 重复", "必须以 / 开头", "id 不合法", "不在 GROUP_ORDER", "没有 group", "guest 守卫页"]) {
      assert.ok(problems.some((p) => p.includes(frag)), `漏抓「${frag}」：${joined}`)
    }
  })
})
