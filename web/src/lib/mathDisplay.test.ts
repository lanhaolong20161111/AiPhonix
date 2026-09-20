import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isTableSeg,
  mathAlignTextAlign,
  mathDisplaySegments,
  mathIndentEm,
  segLines,
} from "./mathDisplay"

// ── 背景（2026-09-15）──
// 数学页此前只用 blocks 的 `{text, type}`，**align 与 indent 被整段丢掉** ——
// 服务端按试卷规格输出的居中标题、缩进选项在前端永远看不见。
// 这里把「带字段」的行为立成护栏。规格：docs/prompts-math-exam.md

test("align 原样带到前端；越界回退 left", () => {
  const segs = mathDisplaySegments(
    [
      { type: "title", align: "center", text: "三年级数学下册期中测试卷", lines: [{ text: "三年级数学下册期中测试卷", indent: 0 }] },
      { type: "foot", align: "center", text: "第 1 页 共 4 页", lines: [{ text: "第 1 页 共 4 页", indent: 0 }] },
      { type: "body", align: "右侧", text: "说明", lines: [{ text: "说明", indent: 0 }] },
    ],
    [],
    "",
  )
  assert.equal(segs[0].align, "center")
  assert.equal(segs[1].align, "center")
  assert.equal(segs[1].type, "foot", "foot 类型不得被前端改写")
  assert.equal(segs[2].align, "left")
})

test("逐行 indent 原样保留（选项=1、题干顶格=0）", () => {
  const segs = mathDisplaySegments(
    [
      { type: "question", align: "left", text: "2. 最大的是（  ）", lines: [{ text: "2. 最大的是（  ）", indent: 0 }] },
      { type: "option", align: "left", text: "A. 3050\nB. 3500", lines: [{ text: "A. 3050", indent: 1 }, { text: "B. 3500", indent: 1 }] },
    ],
    [],
    "",
  )
  assert.deepEqual(segs[0].lines, [{ text: "2. 最大的是（  ）", indent: 0 }])
  assert.deepEqual(segs[1].lines, [{ text: "A. 3050", indent: 1 }, { text: "B. 3500", indent: 1 }])
})

test("块文本与 lines 同源：text 由 lines 拼接时两者一致", () => {
  const segs = mathDisplaySegments(
    [{ type: "body", align: "left", text: "  12\n+ 34", lines: [{ text: "  12", indent: 0 }, { text: "+ 34", indent: 0 }] }],
    [],
    "",
  )
  assert.equal(segs[0].lines[0].text, "  12", "行首空格（竖式列位）必须保留")
  assert.equal(segs[0].lines.map((l) => l.text).join("\n"), segs[0].text)
})

test("服务端没给 lines 时由 text 拆行兜底（旧缓存结构）", () => {
  const segs = mathDisplaySegments([{ type: "question", text: "甲\n乙" }], [], "")
  assert.deepEqual(segs[0].lines, [{ text: "甲", indent: 0 }, { text: "乙", indent: 0 }])
  assert.equal(segs[0].align, "left")
})

test("表格识别：type=table 与正文内嵌 <table> 都算", () => {
  assert.ok(isTableSeg({ type: "table", text: "<table><tr><td>1</td></tr></table>" }))
  assert.ok(isTableSeg({ type: "body", text: "看表：<table><tr><td>1</td></tr></table>" }))
  assert.ok(!isTableSeg({ type: "body", text: "3 × 4 = 12" }))
})

test("indent → em 夹取：0/负/越界", () => {
  assert.equal(mathIndentEm(0), 0)
  assert.equal(mathIndentEm(1), 2)
  assert.equal(mathIndentEm(2), 4)
  assert.equal(mathIndentEm(9), 6, "越界夹到 3 级")
  assert.equal(mathIndentEm(-1), 0)
})

test("align 归一化与渲染用值同口径", () => {
  assert.equal(mathAlignTextAlign("center"), "center")
  assert.equal(mathAlignTextAlign("right"), "right")
  assert.equal(mathAlignTextAlign(" Left "), "left")
  assert.equal(mathAlignTextAlign(undefined), "left")
})

test("segLines 丢空行、裁行尾不裁行首", () => {
  assert.deepEqual(segLines("  12  \n\n  46"), [{ text: "  12", indent: 0 }, { text: "  46", indent: 0 }])
})

test("无 blocks 时退回 questions（type=question 而非 body，避免长题干失去折行）", () => {
  const segs = mathDisplaySegments(undefined, ["1. 计算", "2. 填空"], "整页文本")
  assert.equal(segs.length, 2)
  assert.equal(segs[0].type, "question")
  assert.equal(segs[0].text, "1. 计算")
})

test("blocks 全为空/纯 image 时继续向下退回 text", () => {
  const segs = mathDisplaySegments([{ type: "image", text: "" }], [], "整页文本")
  assert.equal(segs.length, 1)
  assert.equal(segs[0].text, "整页文本")
})
