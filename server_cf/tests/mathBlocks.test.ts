import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeMathBlocks, markFooterBlock, mathCacheKey, MATH_CACHE_SUFFIX } from "../src/lib/subject/math.js"
import { BLOCK_TYPES, normType, normAlign } from "../src/lib/subject/kernel.js"

// ── 背景（2026-09-15「数学试卷规格」落地）──
// 用户给出的数学试卷规格要求：type 含 table/foot、选项 indent=1、首行顶格 indent=0、
// align 按原图。落地时改了四处，这里逐条立护栏，防止以后被"优化"回去：
//   ① BLOCK_TYPES 增加 foot（否则页脚页码行被 normType 静默压成 body）
//   ② 数学不再走 finishBlocks()（内含 markOrderedIndent 会把题号行抬到 indent=1）
//   ③ align 必须原样保留（前端 2026-09-15 起真正消费）
//   ④ 缓存键加版本后缀（不加则旧图命中旧结构缓存，新提示词永远看不到效果）
// 规格原文与差距分析：docs/prompts-math-exam.md

function lines(items: [string, number?][]) {
  return items.map(([text, indent]) => ({ text, indent: indent ?? 0 }))
}

test("foot 类型被保留，不再被 normType 压成 body", () => {
  const out = finalizeMathBlocks([{ type: "foot", align: "center", lines: lines([["第 1 页 共 4 页"]]) }])
  assert.equal(out.length, 1)
  assert.equal(out[0].type, "foot")
  assert.equal(out[0].align, "center")
})

test("BLOCK_TYPES 含 foot，且 normType 不再把 foot 回退成 body", () => {
  assert.ok(BLOCK_TYPES.includes("foot"))
  assert.equal(normType("foot"), "foot")
  assert.equal(normType("不存在的类型"), "body")
})

test("题干首行顶格 indent=0 不被抬升（数学必须跳过 markOrderedIndent）", () => {
  const out = finalizeMathBlocks([
    { type: "question", align: "left", lines: lines([["1. 直接写出得数"], ["24 + 35 ="]] ) },
    { type: "question", align: "left", lines: lines([["一、填空"]]) },
  ])
  assert.equal(out[0].lines[0].indent, 0, "题号行不得被抬到 indent=1")
  assert.equal(out[1].lines[0].indent, 0, "「一、」开头的行不得被抬到 indent=1")
})

test("选项 indent=1 原样保留，且与非选项块互不影响", () => {
  const out = finalizeMathBlocks([
    { type: "question", align: "left", lines: lines([["2. 下面各数中，最大的是（  ）"]]) },
    { type: "option", align: "left", lines: lines([["A. 3050", 1], ["B. 3500", 1]]) },
  ])
  assert.equal(out[0].lines[0].indent, 0)
  assert.equal(out[1].type, "option")
  assert.equal(out[1].lines[0].indent, 1)
  assert.equal(out[1].lines[1].indent, 1)
})

test("align 原样保留：title=center、body 按原图、越界回退 left", () => {
  const out = finalizeMathBlocks([
    { type: "title", align: "center", lines: lines([["三年级数学下册期中测试卷"]]) },
    { type: "body", align: "right", lines: lines([["（满分 100 分）"]]) },
    { type: "body", align: "右侧", lines: lines([["说明文字"]]) },
  ])
  assert.equal(out[0].align, "center")
  assert.equal(out[1].align, "right")
  assert.equal(out[2].align, "left", "越界 align 回退 left")
  assert.equal(normAlign("center"), "center")
})

test("计分表：type=table 的 HTML 块原样透传", () => {
  const html = '<table><tr><td>题号</td><td>得分</td></tr><tr><td>一</td><td></td></tr></table>'
  const out = finalizeMathBlocks([{ type: "table", align: "center", lines: [{ text: html, indent: 0 }] }])
  assert.equal(out.length, 1)
  assert.equal(out[0].type, "table")
  assert.ok(out[0].text.includes("<table"), "表格 HTML 不得被清洗掉")
})

test("模型把 HTML 表格塞进 body 块 → 提升为独立 table 块", () => {
  const out = finalizeMathBlocks([
    { type: "body", align: "left", lines: [{ text: '<table><tr><td>得分</td></tr></table>', indent: 0 }] },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].type, "table")
})

test("空行仍被丢弃（既定行为；规格的「空行」用块间隔表达）", () => {
  const out = finalizeMathBlocks([
    { type: "question", align: "left", lines: lines([["1. 计算"], ["", 0], ["2. 填空"]]) },
  ])
  assert.equal(out[0].lines.length, 2, "块内空行不保留")
  assert.equal(out[0].lines[1].text, "2. 填空")
})

test("竖式行首空格与方框必须保留（数学清洗铁律）", () => {
  const out = finalizeMathBlocks([
    { type: "body", align: "left", lines: lines([["  12"], ["+ 34"], [" ____"], ["  46"]]) },
    { type: "question", align: "left", lines: lines([["3. 在 □ 里填上合适的数"]]) },
  ])
  assert.equal(out[0].lines[0].text, "  12", "行首空格是列位，不得 trim")
  assert.equal(out[0].lines[2].text, " ____")
  assert.ok(out[1].lines[0].text.includes("□"), "填空方框不得被清洗")
})

test("缓存键带版本后缀（改提示词必须换键，否则旧缓存挡住新结构）", () => {
  assert.equal(MATH_CACHE_SUFFIX, "_r2")
  assert.equal(mathCacheKey("deadbeef"), `data/ai_homework_cache/parse_deadbeef${MATH_CACHE_SUFFIX}.json`)
})

// ── 页脚归一化 ──
// 背景：提示词里已为页码行写了**独立规则段**（甚至点名"页码行写成 body 是最常见错误"），
// 但豆包连续三次实测都固执输出 body+align=center。页脚形态可判定，故服务端兜底。

test("末块是页脚形态 → 改判 foot / align=center", () => {
  const out = finalizeMathBlocks([
    { type: "question", align: "left", lines: lines([["1. 计算"]]) },
    { type: "body", align: "center", lines: lines([["第 1 页 共 4 页"]]) },
  ])
  assert.equal(out[1].type, "foot")
  assert.equal(out[1].align, "center")
})

test("四种页脚形态都能识别", () => {
  for (const t of ["第 1 页 共 4 页", "第 12 页", "共 4 页", "1 / 4", "- 3 -"]) {
    const out = finalizeMathBlocks([{ type: "body", align: "left", lines: lines([[t]]) }])
    assert.equal(out[0].type, "foot", `${t} 应判为 foot`)
  }
})

test("页脚归一化只作用于最后一个块（正文里的「1 / 2」不许误判）", () => {
  const out = finalizeMathBlocks([
    { type: "body", align: "left", lines: lines([["1 / 2"], ["3 / 4"]]) },
    { type: "question", align: "left", lines: lines([["9. 比较大小：1 / 2 和 3 / 4"]]) },
  ])
  assert.equal(out[0].type, "body", "非末块不得被改判")
})

test("非页脚形态的末块保持原样（普通说明文字不会被误判）", () => {
  const out = finalizeMathBlocks([
    { type: "body", align: "center", lines: lines([["（满分 100 分，考试时间 60 分钟）"]]) },
  ])
  assert.equal(out[0].type, "body")
})

test("末块已是 foot 时保持，且 align 被拉回 center", () => {
  const out = finalizeMathBlocks([{ type: "foot", align: "left", lines: lines([["第 3 页 共 4 页"]]) }])
  assert.equal(out[0].type, "foot")
  assert.equal(out[0].align, "center")
})

test("markFooterBlock 可独立调用，且对空数组/单块安全", () => {
  const one = [{ type: "body", align: "left", text: "第 2 页 共 3 页", lines: [{ text: "第 2 页 共 3 页", indent: 0 }] }]
  const empty: typeof one = []
  markFooterBlock(empty)
  markFooterBlock(one)
  assert.equal(one[0].type, "foot")
})
