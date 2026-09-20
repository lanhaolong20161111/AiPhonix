import { test } from "node:test"
import assert from "node:assert/strict"
import { stripQuestionNoise } from "../src/lib/aiTextUtils.js"

// ── 背景 ──
// 三学科识图提示词都要求「空白的填空横线按原样输出下划线」（prompts.ts:10/28/59/101/117），
// 但 `stripQuestionNoise` 此前是**无条件**删 `_+`，把行内填空位一起吃掉。
// 2026-09-15 修正为「只删整行只有下划线的批注线/分隔线」。详见 docs/layout-contract.md §0.5。

test("行内下划线（填空位）必须保留", () => {
  assert.equal(stripQuestionNoise("1. 看拼音写词语：____"), "1. 看拼音写词语：____")
})

test("整行只有下划线的批注线/分隔线被删除", () => {
  assert.equal(stripQuestionNoise("课文的开头\n________\n课文的结尾"), "课文的开头\n\n课文的结尾")
})

test("全角下划线 ＿ 与 ASCII 下划线一视同仁", () => {
  assert.equal(stripQuestionNoise("第一段\n＿＿＿＿\n第二段"), "第一段\n\n第二段")
})

test("行内下划线保留 + 整行下划线删除，同段内可共存", () => {
  assert.equal(stripQuestionNoise("填一填：____\n______\n答：____"), "填一填：____\n\n答：____")
})

test("整行含下划线但还有其它可见字符 → 不删（不是纯批注线）", () => {
  assert.equal(stripQuestionNoise("____ 的霞光"), "____ 的霞光")
})

test("单个下划线整行也按批注线删除（不保留裸露的孤立 _）", () => {
  assert.equal(stripQuestionNoise("上\n_\n下"), "上\n\n下")
})

test("括号删除行为不变（含空括号）", () => {
  assert.equal(stripQuestionNoise("在（ ）里填空"), "在里填空")
  assert.equal(stripQuestionNoise("（答案）这是题干"), "这是题干")
})

test("连续空行归一为单个空行，行首尾空白被清理", () => {
  assert.equal(stripQuestionNoise("甲  \n\n\n\n  乙  "), "甲\n\n乙")
})

// ── 回归护栏：数学绝不能调用本函数 ──
// 竖式的计算横线正是「整行 ____」，且竖式靠**行首空格**对齐。本函数会：
//   ① 把整行 `____` 当批注线删掉；② 顺手 trim 掉行首空格 → 列位全散。
test("整行 ____ 会被删除、行首空格会被 trim —— 数学竖式不得走本函数", () => {
  assert.equal(stripQuestionNoise("  12\n+ 34\n ____\n  46"), "12\n+ 34\n\n46")
})
