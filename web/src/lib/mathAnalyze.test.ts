import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildMathMarks,
  findNumber,
  mathAnalyzeSegments,
  relationText,
} from "./mathAnalyze"

// ── 背景（2026-09-22）──
// 数学块此前复用语文的 BlockHighlight（/ai-chinese/highlight-mark），标的是
// 「核心句/优美词句/重点词」——「优美词句」对数学题毫无意义。
// 改用数学专用的 /ai-homework/analyze 后，规则是应用题「审题三步」：
// 量数（已知数据）/ 关系词（运算线索）/ 问题句（所求）。这里把规则立成护栏。

test("量数/关系词/问题句 三类同段共存，按优先级叠加（问题句里的量数仍单独标出）", () => {
  const text = "小明有15个苹果，小红有8个苹果，两人一共有多少个苹果？"
  const segs = mathAnalyzeSegments(text, {
    quantities: [
      { name: "小明", value: 15, unit: "个" },
      { name: "小红", value: 8, unit: "个" },
      { name: "总数", value: null, unit: "个" }, // 未知量：不落正文
    ],
    relations: [{ a: "总数", b: "", type: "total", amount: 0, parts: ["小明", "小红"] }],
    questions: [{ text: "两人一共有多少个苹果？", target: "总数", needs: [], hint: "把两人的合起来" }],
  })

  assert.deepEqual(segs, [
    { text: "小明有", kind: null },
    { text: "15个", kind: "qty" },
    { text: "苹果，小红有", kind: null },
    { text: "8个", kind: "qty" },
    { text: "苹果，", kind: null },
    { text: "两人", kind: "ask" },
    { text: "一共", kind: "rel" },        // 关系词压在问题句之上
    { text: "有多少个苹果？", kind: "ask" },
  ])

  // 拼回原文必须一字不差（高亮只叠加样式，绝不改字）
  assert.equal(segs.map((s) => s.text).join(""), text)
})

test("量数必须独立命中：value=2 不得标到 \"20\" 里的 \"2\"", () => {
  assert.equal(findNumber("20个苹果，吃了2个", "2"), 8)
  assert.equal(findNumber("20个苹果", "2"), -1)
  const segs = mathAnalyzeSegments("20个苹果，吃了2个", {
    quantities: [{ name: "吃了", value: 2, unit: "个" }],
  })
  assert.deepEqual(segs, [
    { text: "20个苹果，吃了", kind: null },
    { text: "2个", kind: "qty" },
  ])
})

test("关系词按类型定向找词：total→一共 / times→…倍 / more→比…多", () => {
  const total = buildMathMarks("一共多少个？", { relations: [{ type: "total" }] })
  assert.equal("一共多少个？".slice(total[0].start, total[0].end), "一共")

  const times = buildMathMarks("小红的苹果数是小明的3倍，小红有几个？", {
    relations: [{ a: "小红", b: "小明", type: "times", amount: 3 }],
  })
  assert.equal(
    "小红的苹果数是小明的3倍，小红有几个？".slice(times[0].start, times[0].end),
    "是小明的3倍",
  )

  const more = buildMathMarks("小明比小红多几个？", { relations: [{ type: "more" }] })
  assert.equal("小明比小红多几个？".slice(more[0].start, more[0].end), "比小红多")
})

test("「多少」里的「多/少」不得被当成关系词误标（more/less 兜底模式）", () => {
  const t = "一共有多少个苹果？"
  assert.equal(buildMathMarks(t, { relations: [{ type: "more" }] }).length, 0)
  assert.equal(buildMathMarks(t, { relations: [{ type: "less" }] }).length, 0)
  // less 的兜底也要放过「多少」：只有真正的「比…少」才标
  const less = buildMathMarks("小明比小红少几个？", { relations: [{ type: "less" }] })
  assert.equal("小明比小红少几个？".slice(less[0].start, less[0].end), "比小红少")
})

test("未知量（value=null）与定位不到的量都不落正文，也不产生空片段", () => {
  assert.deepEqual(buildMathMarks("小明有多少个苹果？", {
    quantities: [{ name: "总数", value: null, unit: "个" }],
  }), [])
  // 中文数字（value=15 但正文写「十五」）定位不到 → 跳过，不报错
  assert.deepEqual(buildMathMarks("小明有十五个苹果", {
    quantities: [{ name: "小明", value: 15, unit: "个" }],
  }), [])
})

test("关系式中文描述：不给答案、不剧透运算结果", () => {
  assert.equal(relationText({ a: "总数", type: "total", parts: ["小明", "小红"] }), "总数 = 小明 + 小红")
  assert.equal(relationText({ a: "小红", b: "小明", type: "times", amount: 3 }), "小红 是 小明 的 3 倍")
  assert.equal(relationText({ a: "小明", b: "小红", type: "more", amount: 5 }), "小明 比 小红 多 5")
  assert.equal(relationText({ a: "小明", b: "小红", type: "less", amount: 5 }), "小明 比 小红 少 5")
  assert.equal(relationText({ type: "unknown" }), "")
})

test("无标记时整段原样返回（单片段 kind=null）", () => {
  assert.deepEqual(mathAnalyzeSegments("纯粹的题干没有任何数字", {}), [
    { text: "纯粹的题干没有任何数字", kind: null },
  ])
})
