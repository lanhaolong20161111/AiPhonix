/** SRT 字幕解析单测（P2-10d）—— 跟读/字幕链路的关键行为 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseSrt, findCurrentSubtitle, toSentences } from "./srtParser.js"

const SAMPLE = `1
00:00:01,000 --> 00:00:04,000
你好，世界

2
00:00:05,500 --> 00:00:08,200
<b>第二句</b> {样式} [音乐]
`

describe("parseSrt", () => {
  it("解析块为字幕条目（索引 + 时间轴）", () => {
    const subs = parseSrt(SAMPLE)
    assert.equal(subs.length, 2)
    assert.equal(subs[0].index, 1)
    assert.equal(subs[0].startMs, 1000)
    assert.equal(subs[0].endMs, 4000)
    assert.equal(subs[0].text, "你好，世界")
  })
  it("剥离 HTML / {} / [] 标记", () => {
    assert.equal(parseSrt(SAMPLE)[1].text, "第二句")
  })
  it("时间轴容错（, 与 . 分隔符）", () => {
    const subs = parseSrt(SAMPLE)
    assert.equal(subs[1].startMs, 5500)
    assert.equal(subs[1].endMs, 8200)
  })
  it("空输入返回空数组", () => {
    assert.deepEqual(parseSrt(""), [])
  })
})

describe("findCurrentSubtitle", () => {
  it("按播放时间命中所属字幕", () => {
    const subs = parseSrt(SAMPLE)
    assert.equal(findCurrentSubtitle(subs, 2000)?.index, 1)
    assert.equal(findCurrentSubtitle(subs, 6000)?.index, 2)
  })
  it("超出范围返回 null", () => {
    assert.equal(findCurrentSubtitle(parseSrt(SAMPLE), 99999), null)
  })
})

describe("toSentences", () => {
  // 模拟儿歌类切分：一句完整话被拆成两块（第二块以 . 结尾）
  const SPLIT = `1
00:00:01,000 --> 00:00:04,000
Head and shoulders, knees and toes,

2
00:00:04,200 --> 00:00:06,000
knees and toes.

3
00:00:07,000 --> 00:00:09,000
Eyes and mouth and ears and nose.
`
  it("把以逗号结尾的半句块合并到下一块", () => {
    const sentences = toSentences(parseSrt(SPLIT))
    assert.equal(sentences.length, 2)
    assert.equal(sentences[0].text, "Head and shoulders, knees and toes, knees and toes.")
    assert.equal(sentences[0].startMs, 1000)
    assert.equal(sentences[0].endMs, 6000)
  })
  it("句末标点块不再合并下一块", () => {
    const sentences = toSentences(parseSrt(SPLIT))
    assert.equal(sentences[1].text, "Eyes and mouth and ears and nose.")
    assert.equal(sentences[1].startMs, 7000)
  })
  it("空输入返回空数组", () => {
    assert.deepEqual(toSentences([]), [])
  })
  it("无句末标点时受最大块数限制", () => {
    // 8 块全无标点，应被 MAX_BLOCKS(6) 截断
    const raw = Array.from({ length: 8 }, (_, i) => ({
      index: i + 1,
      startMs: i * 1000,
      endMs: i * 1000 + 800,
      text: `word${i}`,
    }))
    const sentences = toSentences(raw)
    assert.equal(sentences.length, 2) // 前6块一句 + 后2块一句
  })
})
