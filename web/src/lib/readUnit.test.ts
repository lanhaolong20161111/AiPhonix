import { test } from "node:test"
import assert from "node:assert/strict"
import { splitSentences, sentenceAt, toReadableBlockText } from "./readUnit"

test("中文按句末标点切句，标点归前句", () => {
  const spans = splitSentences("秋天的雨，是一把钥匙。它带着清凉和温柔。")
  assert.equal(spans.length, 2)
  assert.equal(spans[0].text, "秋天的雨，是一把钥匙。")
  assert.equal(spans[1].text, "它带着清凉和温柔。")
})

test("句末右引号/右括号归前句，不甩到下一句", () => {
  const spans = splitSentences("他说：“走吧。”然后就走了。")
  assert.equal(spans.length, 2)
  assert.equal(spans[0].text, "他说：“走吧。”")
  assert.equal(spans[1].text, "然后就走了。")
})

test("英文句点需跟空白/结尾，小数 3.5 与 Mr. 不误切", () => {
  const spans = splitSentences("You will read more than 3,600 pages. That is a lot.")
  assert.equal(spans.length, 2)
  assert.equal(spans[0].text, "You will read more than 3,600 pages.")
  const dec = splitSentences("The value is 3.5 and Mr. Li agrees.")
  assert.equal(dec.length, 1)
  assert.equal(dec[0].text, "The value is 3.5 and Mr. Li agrees.")
})

test("首字母缩写（J. K. Rowling）不切句", () => {
  const spans = splitSentences("J. K. Rowling wrote it. We like it.")
  assert.equal(spans.length, 2)
  assert.equal(spans[0].text, "J. K. Rowling wrote it.")
})

test("换行不是句子边界（段落内部不该有换行）", () => {
  const spans = splitSentences("第一句\n第二句")
  assert.equal(spans.length, 1)
})

test("offset 落在哪句就返回哪句", () => {
  const text = "秋天的雨，是一把钥匙。它带着清凉和温柔。"
  assert.equal(sentenceAt(text, 0), "秋天的雨，是一把钥匙。")
  assert.equal(sentenceAt(text, 3), "秋天的雨，是一把钥匙。")
  assert.equal(sentenceAt(text, 11), "它带着清凉和温柔。")
})

test("offset 越界夹到首句/末句", () => {
  const text = "第一句。第二句。"
  assert.equal(sentenceAt(text, -5), "第一句。")
  assert.equal(sentenceAt(text, 999), "第二句。")
})

test("段落前置缩进（两个全角空格）不产生空句", () => {
  const spans = splitSentences("\u3000\u3000春天的花开了。")
  assert.equal(spans.length, 1)
  assert.equal(spans[0].text, "\u3000\u3000春天的花开了。")
})

test("没有句末标点时整段算一句", () => {
  assert.equal(sentenceAt("没有标点的一段话", 3), "没有标点的一段话")
})

test("纯空白/纯标点段落原样返回", () => {
  assert.equal(sentenceAt("   ", 1), "")
  assert.equal(sentenceAt("。", 0), "。")
})

// ── 整块朗读文本（段落模式的朗读单位是整个块）──────────────────────

test("整块文本：OCR 物理换行折成单空格（TTS 不需要硬换行）", () => {
  assert.equal(toReadableBlockText("春天的雨\n是一把钥匙\n它带着温柔"), "春天的雨 是一把钥匙 它带着温柔")
})

test("整块文本：段落首行缩进的全角空格不留进朗读串", () => {
  assert.equal(toReadableBlockText("\u3000\u3000花儿开了。"), "花儿开了。")
})

test("整块文本：表格 HTML 去标签但保留单元格文字", () => {
  const html = "<table><thead><tr><th>题号</th><th>得分</th></tr></thead><tbody><tr><td>一</td><td>10</td></tr></tbody></table>"
  assert.equal(toReadableBlockText(html), "题号 得分 一 10")
})

test("整块文本：数学小于号不能被当成 HTML 标签吃掉", () => {
  assert.equal(toReadableBlockText("3 < 5 且 7 > 2"), "3 < 5 且 7 > 2")
  assert.equal(toReadableBlockText("a<br>3 <b>b</b>"), "a 3 b")
})

test("整块文本：多段拼接结果与逐段读一致（缩进空格已归一）", () => {
  const block = "\u3000\u3000第一段。\n\u3000\u3000第二段。"
  assert.equal(toReadableBlockText(block), "第一段。 第二段。")
})

test("整块文本：空串/空白安全返回空", () => {
  assert.equal(toReadableBlockText(""), "")
  assert.equal(toReadableBlockText("  \n\t "), "")
})
