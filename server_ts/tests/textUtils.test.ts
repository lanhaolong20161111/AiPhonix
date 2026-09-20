/** OCR 文本工具单测 — 清洗/去重/拆题/恢复，这些是 AI 语文/数学链路的关键行为 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  dedupeLines,
  cleanOcrText,
  splitQuestions,
  splitProblemsByNumber,
  recoverTextFromJson,
} from "../src/lib/aiTextUtils.js"

describe("dedupeLines", () => {
  it("去除重复行（跨空行也视为重复）；不同内容保留", () => {
    assert.equal(dedupeLines("春天\n春天\n小草"), "春天\n小草")
    // 空行不重置"上一个非空行"，因此第二个 a 被去掉，空行保留
    assert.equal(dedupeLines("a\n\na"), "a\n")
    assert.equal(dedupeLines("a\nb\na"), "a\nb\na")
  })
})

describe("cleanOcrText", () => {
  it("LaTeX 分数转斜杠、上下标标签剥离、乱码占位符清除", () => {
    assert.equal(cleanOcrText("\\frac{1}{2}"), "1/2")
    assert.equal(cleanOcrText("H<sub>2</sub>O 和 x<sup>2</sup>"), "H2O 和 x2")
    assert.equal(cleanOcrText("答案□是\uFFFD的"), "答案是的")
  })
})

describe("splitQuestions", () => {
  it("【题N】标记优先切分", () => {
    const out = splitQuestions("【题1】计算 1+1\n【题2】背诵古诗")
    assert.deepEqual(out, ["计算 1+1", "背诵古诗"])
  })

  it("无标记时空行分隔生效", () => {
    const out = splitQuestions("第一题内容\n\n第二题内容")
    assert.equal(out.length, 2)
  })

  it("行首题号作为兜底切分", () => {
    const out = splitQuestions("1. 计算\n2. 默写")
    assert.equal(out.length, 2)
    assert.match(out[1], /^2\./)
  })

  it("空输入返回空数组", () => {
    assert.deepEqual(splitQuestions(""), [])
  })
})

describe("splitProblemsByNumber", () => {
  it("【题N】标记优先切分", () => {
    assert.deepEqual(splitProblemsByNumber("【题1】计算 1+1\n【题2】背诵古诗"), ["计算 1+1", "背诵古诗"])
  })

  it("空行不参与分题（保住段落空行后数学仍按题号一题一块）", () => {
    const text = "1. 计算下面各题\n\n(1) 12+35=  (2) 4×5=\n\n2. 填空"
    // 通用拆题按空行切成 3 段 → 题干与小题被切散
    assert.equal(splitQuestions(text).length, 3)
    // 数学专用只认题号 → 2 题，小题跟着题干
    const out = splitProblemsByNumber(text)
    assert.equal(out.length, 2)
    assert.match(out[0], /^1\./)
    assert.match(out[1], /^2\./)
    assert.match(out[0], /12\+35=/)
  })

  it("无题号时整段返回（不按空行切）", () => {
    assert.deepEqual(splitProblemsByNumber("计算下面各题\n\n12+35=\n\n4×5="), ["计算下面各题\n\n12+35=\n\n4×5="])
  })

  it("空输入返回空数组", () => {
    assert.deepEqual(splitProblemsByNumber(""), [])
  })
})

describe("recoverTextFromJson", () => {
  it("{blocks:[{text}]} 提取各块文本拼接", () => {
    const s = '{"blocks":[{"text":"第一段"},{"text":"第二段"}]}'
    assert.equal(recoverTextFromJson(s), "第一段\n\n第二段")
  })

  it("普通文本原样透传", () => {
    assert.equal(recoverTextFromJson("就是一段课文"), "就是一段课文")
  })
})
