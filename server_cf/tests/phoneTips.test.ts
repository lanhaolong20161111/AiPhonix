/** 发音要领服务端纯逻辑单测 —— 缓存键归一化 / 入参清洗 / 出参三道闸门 / JSON 抠取 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  tipCacheKey,
  normalizeTipRequest,
  cleanTipResponse,
  extractJson,
  MAX_TIP_PHONES,
  MAX_TIP_LEN,
} from "../src/lib/phoneTips.js"

describe("tipCacheKey", () => {
  it("音素去尾随重音数字并小写", () => {
    assert.equal(tipCacheKey("TH1", "the"), tipCacheKey("th", "the"))
    assert.equal(tipCacheKey("ah0", "about"), "ah|about")
  })

  it("单词小写 + 丢标点，保留撇号", () => {
    assert.equal(tipCacheKey("r", "RED"), tipCacheKey("r", "red"))
    assert.equal(tipCacheKey("t", "don't"), "t|don't")
    assert.equal(tipCacheKey("n", "Apple,"), "n|apple")
  })

  it("缩写：直撇号保留、弯撇号被当标点丢弃（已知取舍）", () => {
    assert.equal(tipCacheKey("t", "don't"), "t|don't")
    // ⚠️ 弯撇号 U+2019 不在 `[a-z0-9']` 白名单里，会被剥掉。
    //    这只会让「智能引号」来源的同一个词落成另一个缓存键（多花一次 LLM），不会出错。
    assert.equal(tipCacheKey("t", "don\u2019t"), "t|dont")
  })

  it("★ 同一个音素在不同词里是不同的键（这是带词的设计目的）", () => {
    // th 在 think 里是清音、在 the 里是浊音，提示文案必须分开缓存
    assert.notEqual(tipCacheKey("th", "think"), tipCacheKey("th", "the"))
  })

  it("空格/大小写不影响命中", () => {
    assert.equal(tipCacheKey("  TH  ", "  The  "), "th|the")
  })
})

describe("normalizeTipRequest", () => {
  it("正常入参原样通过", () => {
    const r = normalizeTipRequest("apple", [{ phone: "ae", score: 49 }])
    assert.equal(r.word, "apple")
    assert.deepEqual(r.items, [{ phone: "ae", score: 49 }])
  })

  it("丢弃空音素与非数字分数", () => {
    const r = normalizeTipRequest("apple", [
      { phone: "", score: 50 },
      { phone: "ae", score: "abc" },
      { phone: "p", score: 30 },
    ])
    assert.deepEqual(r.items, [{ phone: "p", score: 30 }])
  })

  it("非数组 items → 空数组（不抛异常）", () => {
    assert.deepEqual(normalizeTipRequest("apple", null).items, [])
    assert.deepEqual(normalizeTipRequest("apple", "oops").items, [])
    assert.deepEqual(normalizeTipRequest("apple", { a: 1 }).items, [])
  })

  it("上限截断到 MAX_TIP_PHONES", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ phone: `p${i}`, score: 10 }))
    const r = normalizeTipRequest("apple", many)
    assert.equal(r.items.length, MAX_TIP_PHONES)
  })

  it("单词清掉中文/符号等非英文内容（防注入+防撑爆）", () => {
    assert.equal(normalizeTipRequest("苹果apple。", []).word, "apple")
    assert.equal(normalizeTipRequest("a".repeat(200), []).word.length, 60)
  })

  it("★ 中文场景：单词被清空 → 调用方据此走 empty 分支", () => {
    assert.equal(normalizeTipRequest("苹果", [{ phone: "o1", score: 20 }]).word, "")
  })
})

describe("cleanTipResponse", () => {
  const asked = ["th", "ih", "ng"]

  it("正常返回全部保留", () => {
    const r = cleanTipResponse(
      { tips: [{ phone: "th", tip: "舌尖吐出来" }, { phone: "ih", tip: "嘴角放松" }] },
      asked,
    )
    assert.equal(r.length, 2)
    assert.equal(r[0].category, "llm")
  })

  it("★ 丢弃没问过的音素（模型自作主张多给）", () => {
    const r = cleanTipResponse(
      { tips: [{ phone: "th", tip: "ok" }, { phone: "zz", tip: "我没问这个" }] },
      asked,
    )
    assert.deepEqual(r.map((x) => x.phone), ["th"])
  })

  it("★ 丢弃超长文案（宁可退回本地表，也不塞小作文）", () => {
    const long = "很长的提示".repeat(20)
    assert.ok(long.length > MAX_TIP_LEN)
    const r = cleanTipResponse({ tips: [{ phone: "th", tip: long }] }, asked)
    assert.deepEqual(r, [])
  })

  it("恰好等于上限的文案保留（边界）", () => {
    const exact = "x".repeat(MAX_TIP_LEN)
    const r = cleanTipResponse({ tips: [{ phone: "th", tip: exact }] }, asked)
    assert.equal(r.length, 1)
  })

  it("同音素去重，只留第一条", () => {
    const r = cleanTipResponse(
      { tips: [{ phone: "th", tip: "第一句" }, { phone: "th", tip: "第二句" }] },
      asked,
    )
    assert.equal(r.length, 1)
    assert.equal(r[0].tip, "第一句")
  })

  it("空 phone / 空 tip 被丢弃", () => {
    const r = cleanTipResponse(
      { tips: [{ phone: "", tip: "x" }, { phone: "th", tip: "" }, { phone: "ih", tip: "  " }] },
      asked,
    )
    assert.deepEqual(r, [])
  })

  it("形状不对（null / 字符串 / tips 非数组）→ 空数组，不抛异常", () => {
    assert.deepEqual(cleanTipResponse(null, asked), [])
    assert.deepEqual(cleanTipResponse("nope", asked), [])
    assert.deepEqual(cleanTipResponse({ tips: "oops" }, asked), [])
    assert.deepEqual(cleanTipResponse({}, asked), [])
  })

  it("清洗后的文案不含危险 HTML 字符（兜底，即使模型输出尖括号）", () => {
    // 这里不断言「一定被过滤」—— 只断言 cleanTipResponse 不做转义、
    // 因此渲染层必须用文本节点（React 默认即是），不能 dangerouslySetInnerHTML。
    const r = cleanTipResponse({ tips: [{ phone: "th", tip: "<b>bold</b>" }] }, asked)
    assert.equal(r.length, 1)
    assert.equal(r[0].tip, "<b>bold</b>")
  })
})

describe("extractJson", () => {
  it("剥 ```json 围栏", () => {
    const raw = '```json\n{"tips":[]}\n```'
    assert.equal(extractJson(raw), '{"tips":[]}')
  })

  it("剥无语言标记的围栏", () => {
    assert.equal(extractJson('```\n{"a":1}\n```'), '{"a":1}')
  })

  it("去掉前后解释文字，只留最外层对象", () => {
    assert.equal(extractJson('好的，结果如下：{"a":1} 希望有帮助'), '{"a":1}')
  })

  it("嵌套对象取到最后一个 }（不截断内层）", () => {
    assert.equal(extractJson('{"a":{"b":1}}'), '{"a":{"b":1}}')
  })

  it("抠不出 JSON → 原样返回（JSON.parse 会抛，调用方当失败处理）", () => {
    // ⚠️ 行为说明：extractJson **不负责判断有效性**，没有大括号时原样返回输入。
    //    调用方 `JSON.parse(extractJson(raw))` 会抛异常，被 try/catch 兜住 → 返回空 tips。
    //    这样职责更单一：extractJson 只做「抠取」，有效性交给 JSON.parse。
    assert.equal(extractJson("没有任何大括号"), "没有任何大括号")
    assert.equal(extractJson(""), "")
    assert.throws(() => JSON.parse(extractJson("没有任何大括号")))
  })
})
