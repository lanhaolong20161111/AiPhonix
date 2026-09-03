/** SRT 字幕解析单测（P2-10d）—— 跟读/字幕链路的关键行为 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseSrt, findCurrentSubtitle } from "./srtParser.js"

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
