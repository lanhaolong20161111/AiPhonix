/** 拼音纯函数单测（P2-10d）—— 练字/识拼音链路的关键行为，无 DOM 依赖 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  normalizePinyin,
  stripPinyin,
  stripPinyinKeepDelimiters,
  parsePinyin,
  isPinyinCorrect,
  tokenizePinyinText,
  splitRunPinyin,
} from "./pinyin.js"

describe("normalizePinyin", () => {
  it("带声调符号 → 数字声调", () => {
    assert.equal(normalizePinyin("xī guā"), "xi1 gua1")
  })
  it("ü 写作 v", () => {
    assert.equal(normalizePinyin("nǚ"), "nv3")
  })
  it("无声调原样保留", () => {
    assert.equal(normalizePinyin("hua"), "hua")
  })
})

describe("stripPinyin", () => {
  it("只留汉字（连写）", () => {
    assert.equal(stripPinyin("我(wǒ)爱(ài)你(nǐ)"), "我爱你")
  })
  it("separate=true 逐字空格", () => {
    assert.equal(stripPinyin("我们爱", true), "我 们 爱")
  })
  it("残留无声调拼音（拉丁字母串）也去除", () => {
    assert.equal(stripPinyin("pin yin 测试"), "测试")
  })
  it("空输入", () => {
    assert.equal(stripPinyin(""), "")
  })
})

describe("stripPinyinKeepDelimiters", () => {
  it("保留分隔符与汉字，去拼音", () => {
    assert.equal(stripPinyinKeepDelimiters("我们women 爱ai"), "我们 爱")
  })
})

describe("parsePinyin", () => {
  it("拆分声母 + 声调", () => {
    const r = parsePinyin("gua1")
    assert.equal(r.initial, "g")
    assert.equal(r.tone, 1)
  })
  it("整体认读音节", () => {
    const r = parsePinyin("zhi4")
    assert.equal(r.isOverall, true)
    assert.equal(r.final, "zhi")
    assert.equal(r.tone, 4)
  })
  it("j/q/x + üan 读 van（内部归并为介母）", () => {
    const r = parsePinyin("juan1")
    assert.equal(r.initial, "j")
    assert.equal(r.tone, 1)
  })
})

describe("isPinyinCorrect", () => {
  it("整体认读只比韵母 + 声调", () => {
    assert.equal(isPinyinCorrect("zhi4", "zhi4"), true)
    assert.equal(isPinyinCorrect("zhi3", "zhi4"), false)
  })
  it("普通拼音比声母/韵母/声调", () => {
    assert.equal(isPinyinCorrect("gua1", "gua1"), true)
    assert.equal(isPinyinCorrect("kua1", "gua1"), false)
  })
})

describe("tokenizePinyinText", () => {
  it("把带声调拼音切为 pinyin 片段、其余为 text", () => {
    const toks = tokenizePinyinText("你好xīng")
    const pinyin = toks.find((t) => t.type === "pinyin")
    assert.ok(pinyin)
    assert.equal(pinyin!.text, "xīng")
  })
})

describe("splitRunPinyin", () => {
  it("最短可用：单音节直接成段", () => {
    assert.deepEqual(splitRunPinyin("ma"), ["ma"])
  })
})
