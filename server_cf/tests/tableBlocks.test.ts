import { test } from "node:test"
import assert from "node:assert/strict"
import {
  cleanBookScanBlocks,
  hoistHtmlTableBlocks,
  mergeMarkdownTableBlocks,
  stripPrintedPinyin,
  type Block,
} from "../src/lib/aiTextUtils.js"

const body = (text: string, indent = 0, poly: Record<string, string> = {}): Block => ({
  type: "body",
  text,
  align: "left",
  lines: [{ text, indent }],
  polyphones: poly,
})

test("相邻的表格行 body 块合并成一个 HTML table 块", () => {
  const blocks: Block[] = [
    body("|要查|音序查字法|部首查字法|", 1),
    body("| ---- | ---- | ---- |"),
    body("|反复| | |"),
    body("|全神贯注| | |"),
  ]
  const out = mergeMarkdownTableBlocks(blocks)
  assert.equal(out.length, 1)
  assert.equal(out[0].type, "table")
  assert.match(out[0].text, /<table>/)
  assert.match(out[0].text, /<th>要查<\/th>/)
  assert.match(out[0].text, /<td>全神贯注<\/td>/)
})

test("表格块前后正文保持顺序，普通正文不受影响", () => {
  const blocks: Block[] = [
    body("四、照样子填表。(9分)", 1),
    body("|字|音序|"),
    body("| --- | --- |"),
    body("|秋|Q|"),
    body("五、填空。(4分)", 1),
  ]
  const out = mergeMarkdownTableBlocks(blocks)
  assert.deepEqual(
    out.map((b) => b.type),
    ["body", "table", "body"],
  )
  assert.equal(out[0].text, "四、照样子填表。(9分)")
  assert.equal(out[2].text, "五、填空。(4分)")
})

test("缺分隔行的竖线文本不误判，原样保留", () => {
  const blocks: Block[] = [body("|没有分隔行的文本|"), body("|另一行|")]
  const out = mergeMarkdownTableBlocks(blocks)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((b) => b.type), ["body", "body"])
})

test("被合并块的多音字注音汇总到 table 块上", () => {
  const blocks: Block[] = [
    body("|要查|音序|", 1, { 查: "chá" }),
    body("| ---- | ---- |"),
    body("|行|X|", 0, { 行: "háng" }),
  ]
  const out = mergeMarkdownTableBlocks(blocks)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].polyphones, { 查: "chá", 行: "háng" })
})

test("没有表格行时返回等价数组", () => {
  const blocks = [body("第一段", 1), body("第二段", 1)]
  const out = mergeMarkdownTableBlocks(blocks)
  assert.equal(out.length, 2)
  assert.equal(out[0].text, "第一段")
})

test("中文模式清洗不破坏 table 块的 HTML 标签（去拼音会删拉丁字母）", () => {
  const html = '<table><thead><tr><th colspan="2">要查</th></tr></thead><tbody><tr><td>反复</td></tr></tbody></table>'
  const blk: Block = { type: "table", text: html, align: "left", lines: [{ text: html, indent: 0 }], polyphones: {} }
  const out = cleanBookScanBlocks([blk], { stripPinyin: true })
  assert.equal(out.length, 1)
  assert.equal(out[0].text, html)
  assert.match(out[0].text, /<td>反复<\/td>/)
})

test("非表格块仍照常去掉印刷拼音", () => {
  const blk: Block = { type: "body", text: "tiān 天", align: "left", lines: [{ text: "tiān 天", indent: 0 }], polyphones: {} }
  const out = cleanBookScanBlocks([blk], { stripPinyin: true })
  assert.equal(out[0].text.trim(), "天")
})

// ── HTML 表格不再被"去拼音"删成 <></>（学生看到的尖括号乱码根因） ──

const HTML_TBL = '<table><tr><td>要查</td><td>音序</td></tr><tr><td>慢</td><td>M</td></tr></table>'

test("去拼音不碰 HTML 标签：<table> 不会被删成 <>", () => {
  assert.equal(stripPrintedPinyin(HTML_TBL), HTML_TBL)
  assert.equal(stripPrintedPinyin("请看" + HTML_TBL), "请看" + HTML_TBL)
  // 普通文本照常去拼音
  assert.equal(stripPrintedPinyin("tiān 天"), " 天")
})

test("内嵌 HTML 表格的正文块被提升为 table 块，正文顺序保留", () => {
  const blocks: Block[] = [body("请看下面的表：" + HTML_TBL + "填完交上来。", 1)]
  const out = hoistHtmlTableBlocks(blocks)
  assert.deepEqual(
    out.map((b) => b.type),
    ["body", "table", "body"],
  )
  assert.equal(out[0].text, "请看下面的表：")
  assert.equal(out[1].text, HTML_TBL)
  assert.equal(out[2].text, "填完交上来。")
})

test("整块就是一张 HTML 表格时只产出 table 块", () => {
  const out = hoistHtmlTableBlocks([body(HTML_TBL, 1)])
  assert.equal(out.length, 1)
  assert.equal(out[0].type, "table")
  assert.equal(out[0].text, HTML_TBL)
})

test("跨行（lines 多行）的 HTML 表格也能提升", () => {
  const blk: Block = {
    type: "body",
    text: `<table>\n<tr><td>秋</td></tr>\n</table>`,
    align: "left",
    lines: [{ text: "<table>", indent: 1 }, { text: "<tr><td>秋</td></tr>", indent: 0 }, { text: "</table>", indent: 0 }],
    polyphones: {},
  }
  const out = hoistHtmlTableBlocks([blk])
  assert.equal(out.length, 1)
  assert.equal(out[0].type, "table")
  assert.match(out[0].text, /<td>秋<\/td>/)
})

test("中文模式清洗内嵌表格：既不产生 <></>，又提升为 table 块", () => {
  const blocks: Block[] = [body("四、照样子填表。" + HTML_TBL, 1)]
  const out = cleanBookScanBlocks(blocks, { stripPinyin: true })
  assert.deepEqual(
    out.map((b) => b.type),
    ["body", "table"],
  )
  assert.equal(out[0].text, "四、照样子填表。")
  assert.equal(out[1].text, HTML_TBL)
  assert.ok(!out.some((b) => b.text.includes("<>")), "不应残留 <></> 乱码")
  assert.match(out[1].text, /<td>要查<\/td>/)
})

test("普通正文里的 HTML 行内标签也不会被去拼音破坏", () => {
  const out = cleanBookScanBlocks([body("水的化学式 H<sub>2</sub>O", 1)], { stripPinyin: true })
  assert.equal(out[0].text, "水的化学式 H<sub>2</sub>O")
})
