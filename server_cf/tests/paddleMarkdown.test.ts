import { test } from "node:test"
import assert from "node:assert/strict"
import { markdownToBlocks, stripEmbeddedHtml } from "../src/lib/paddleMarkdown.js"

test("同一段落的多条物理行聚合为一个 body 块（首行 indent=1）", () => {
  const blocks = markdownToBlocks("秋天的雨，是一把钥匙。\n它带着清凉和温柔，\n把秋天的大门打开了。\n")
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, "body")
  assert.deepEqual(blocks[0].lines, [
    { text: "秋天的雨，是一把钥匙。", indent: 1 },
    { text: "它带着清凉和温柔，", indent: 0 },
    { text: "把秋天的大门打开了。", indent: 0 },
  ])
})

test("空行分隔出多个段落，段落之间不会粘在一起", () => {
  const blocks = markdownToBlocks("第一段第一行\n第一段第二行\n\n第二段第一行\n")
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].lines.length, 2)
  assert.deepEqual(blocks[1].lines, [{ text: "第二段第一行", indent: 1 }])
})

test("标题与段落保持阅读顺序，标题不吞并段落", () => {
  const blocks = markdownToBlocks("# 秋天的雨\n\n## 第一课时\n\n课文正文第一行\n课文正文第二行\n")
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["title", "heading", "body"],
  )
  assert.equal(blocks[0].lines[0].indent, 0)
  assert.equal(blocks[2].lines.length, 2)
})

test("markdown 表格转 HTML table 块，且前后段落各自成段", () => {
  const md = "表格前的正文第一行\n表格前的正文第二行\n\n| 字 | 音序 |\n| --- | --- |\n| 秋 | Q |\n\n表格后的正文\n"
  const blocks = markdownToBlocks(md)
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["body", "table", "body"],
  )
  assert.match(blocks[1].text, /<table>/)
  assert.match(blocks[1].text, /<th>字<\/th>/)
  assert.match(blocks[1].text, /<td>Q<\/td>/)
  assert.equal(blocks[0].lines.length, 2)
  assert.equal(blocks[2].lines.length, 1)
})

test("HTML 形式的表格（PP-StructureV3 开表格识别）转 table 块，不再当正文", () => {
  const md =
    "四、照样子填表。\n\n" +
    '<table><tr><th>字</th><th>音序</th></tr><tr><td>秋</td><td>Q</td></tr></table>\n\n' +
    "五、填空。\n"
  const blocks = markdownToBlocks(md)
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["body", "table", "body"],
  )
  assert.equal(blocks[0].text, "四、照样子填表。")
  assert.match(blocks[1].text, /<td>秋<\/td>/)
  assert.ok(!blocks.some((b) => b.type === "body" && b.text.includes("<table")), "HTML 表格不应留在正文块")
})

test("跨行的 HTML 表格也能被完整收集", () => {
  const md = "<table>\n<tr><td>要查</td></tr>\n</table>\n"
  const blocks = markdownToBlocks(md)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, "table")
  assert.match(blocks[0].text, /<td>要查<\/td>/)
})

test("stripEmbeddedHtml 剥掉行内子图标签", () => {
  assert.equal(stripEmbeddedHtml("文字<div><img src=\"x\"></div>更多"), "文字更多")
})

test("空输入返回空数组", () => {
  assert.deepEqual(markdownToBlocks(""), [])
  assert.deepEqual(markdownToBlocks("\n\n\n"), [])
})
