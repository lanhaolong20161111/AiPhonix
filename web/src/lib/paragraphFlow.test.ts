import { test } from "node:test"
import assert from "node:assert/strict"
import { buildParagraphs, splitInlineTables, tidyInlineSpaces } from "./paragraphFlow"

test("中文续行直拼成一段（不插空格）", () => {
  const paras = buildParagraphs([
    { text: "秋天的雨，是一把钥匙。它带着清凉和温柔，", indent: 1 },
    { text: "轻轻地，轻轻地，趁你没留意，把秋天的大门打开了。", indent: 0 },
  ])
  assert.equal(paras.length, 1)
  assert.equal(paras[0], "秋天的雨，是一把钥匙。它带着清凉和温柔，轻轻地，轻轻地，趁你没留意，把秋天的大门打开了。")
})

test("indent>=1 视作新段落起点", () => {
  const paras = buildParagraphs([
    { text: "第一段的第一行", indent: 1 },
    { text: "第一段的续行", indent: 0 },
    { text: "第二段的第一行", indent: 1 },
    { text: "第二段的续行", indent: 0 },
  ])
  assert.deepEqual(paras, ["第一段的第一行第一段的续行", "第二段的第一行第二段的续行"])
})

test("首行无缩进也会自成一段（Paddle 路径）", () => {
  const paras = buildParagraphs([
    { text: "小蝌蚪游哇游，过了几天，", indent: 0 },
    { text: "长出了两条后腿。", indent: 0 },
  ])
  assert.deepEqual(paras, ["小蝌蚪游哇游，过了几天，长出了两条后腿。"])
})

test("删掉汉字旁边的 OCR 噪声空格，保留英文词间空格", () => {
  assert.equal(tidyInlineSpaces("秋天的 雨，是 一把 钥匙。"), "秋天的雨，是一把钥匙。")
  assert.equal(tidyInlineSpaces("近义词：疑定 (  危险"), "近义词：疑定(危险")
  assert.equal(tidyInlineSpaces(")的霞光()的大狗"), ")的霞光()的大狗")
  assert.equal(tidyInlineSpaces("我会读 hello world"), "我会读hello world")
  assert.equal(tidyInlineSpaces("字 的 时 候"), "字的时候")
})

test("填空位括号原样保留（孩子要看到能填几个字）", () => {
  assert.equal(tidyInlineSpaces("（  ）的霞光 （  ）的大狗"), "（  ）的霞光（  ）的大狗")
  assert.equal(tidyInlineSpaces("( )地蹲着"), "( )地蹲着")
  assert.equal(tidyInlineSpaces("（    ）地跑着"), "（    ）地跑着")
  assert.equal(tidyInlineSpaces("在（ ）里填空"), "在（ ）里填空")
})

test("英文行合并补空格，折行连字符合并", () => {
  assert.deepEqual(
    buildParagraphs([
      { text: "The cat sat on the", indent: 1 },
      { text: "mat and looked at me.", indent: 0 },
    ]),
    ["The cat sat on the mat and looked at me."],
  )
  assert.deepEqual(
    buildParagraphs([
      { text: "This is an exam-", indent: 1 },
      { text: "ple sentence.", indent: 0 },
    ]),
    ["This is an example sentence."],
  )
})

test("空白行与空块被丢弃；空输入返回空数组", () => {
  assert.deepEqual(buildParagraphs([{ text: "  ", indent: 0 }, { text: "", indent: 1 }]), [])
  assert.deepEqual(buildParagraphs(null), [])
  assert.deepEqual(buildParagraphs([]), [])
})

test("段落内残留换行按普通空白处理（不另起段落）", () => {
  const paras = buildParagraphs([{ text: "第一行\n第二行", indent: 1 }])
  assert.deepEqual(paras, ["第一行第二行"])
})

// ── 内嵌 HTML 表格切段（表格要单独渲染成可点读表格，不能被逐字显示成尖括号） ──

const TBL = '<table><tr><td>要查</td><td>音序</td></tr></table>'

test("无表格文本原样返回单段", () => {
  assert.deepEqual(splitInlineTables("秋天的雨，是一把钥匙。"), [{ type: "text", text: "秋天的雨，是一把钥匙。" }])
  assert.deepEqual(splitInlineTables(""), [{ type: "text", text: "" }])
})

test("纯表格返回单个表格段", () => {
  assert.deepEqual(splitInlineTables(TBL), [{ type: "table", text: TBL }])
})

test("文字＋表格＋文字切成三段，前后文字不丢", () => {
  const out = splitInlineTables("四、照样子填表。" + TBL + "五、填空。")
  assert.deepEqual(
    out.map((s) => s.type),
    ["text", "table", "text"],
  )
  assert.equal(out[0].text, "四、照样子填表。")
  assert.equal(out[1].text, TBL)
  assert.equal(out[2].text, "五、填空。")
})

test("一张文本里的多张表格都能切出来", () => {
  const out = splitInlineTables("第一题：" + TBL + "第二题：" + TBL)
  assert.deepEqual(
    out.map((s) => s.type),
    ["text", "table", "text", "table"],
  )
})

test("跨行 HTML 表格也能整体切出", () => {
  const md = "<table>\n<tr><td>秋</td></tr>\n</table>"
  assert.deepEqual(splitInlineTables("看表：" + md), [
    { type: "text", text: "看表：" },
    { type: "table", text: md },
  ])
})

test("没有闭合标签的残缺表格不切段，原样返回（不丢内容）", () => {
  const broken = "四、填表。<table><tr><td>秋"
  assert.deepEqual(splitInlineTables(broken), [{ type: "text", text: broken }])
})
