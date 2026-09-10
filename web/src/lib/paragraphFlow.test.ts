import { test } from "node:test"
import assert from "node:assert/strict"
import { buildParagraphs, reflowText, splitBlanks, splitInlineTables, stripMdHeaders, tidyInlineSpaces } from "./paragraphFlow"

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

// ── reflowText：把「按图片物理行硬折行」的纯文本并回段落 ──

test("中文续行并回同一段（不保留物理换行）", () => {
  const raw = "秋天的雨，是一把钥匙。它带着清凉和温柔，\n轻轻地，轻轻地，趁你没留意，把秋天的大门打开了。"
  assert.deepEqual(reflowText(raw), [
    "秋天的雨，是一把钥匙。它带着清凉和温柔，轻轻地，轻轻地，趁你没留意，把秋天的大门打开了。",
  ])
})

test("空行强制分段", () => {
  assert.deepEqual(reflowText("第一段话\n\n第二段话"), ["第一段话", "第二段话"])
})

test("有序项各自成段，不被并进上一段", () => {
  assert.deepEqual(reflowText("1．今天天气很好。\n2．我们去公园。\n① 带上水壶\n② 戴上帽子"), [
    "1．今天天气很好。",
    "2．我们去公园。",
    // 序号与汉字之间的空格按行内噪声清理掉（与其它中文行一致）
    "①带上水壶",
    "②戴上帽子",
  ])
})

test("英文续行补空格、行尾连字符合并", () => {
  assert.deepEqual(reflowText("The quick brown\nfox jumps over\nthe lazy dog."), [
    "The quick brown fox jumps over the lazy dog.",
  ])
  assert.deepEqual(reflowText("inter-\nnational"), ["international"])
})

test("行内噪声空格照旧清掉，但填空位保留", () => {
  assert.deepEqual(reflowText("秋天的 雨，是 一把 钥匙。\n（  ）的霞光"), [
    "秋天的雨，是一把钥匙。（  ）的霞光",
  ])
})

// ── splitBlanks：填空位必须整体不可断 ──

test("切出填空位片段，其余为普通文本", () => {
  assert.deepEqual(splitBlanks("（  ）的霞光（  ）的大狗"), [
    { blank: true, text: "（  ）" },
    { blank: false, text: "的霞光" },
    { blank: true, text: "（  ）" },
    { blank: false, text: "的大狗" },
  ])
})

test("没有填空位时原样返回单片段", () => {
  assert.deepEqual(splitBlanks("秋天的雨"), [{ blank: false, text: "秋天的雨" }])
})

// ── markdown 管道表 → 真表格（数学/英语题目路径）──

test("管道表转成 HTML 表格，不再显示竖线噪声", () => {
  const md = "| 要查的字 | 音序 |\n| --- | --- |\n| 慢 | M |\n| 深 | S |"
  assert.deepEqual(splitInlineTables("四、填表。\n" + md), [
    { type: "text", text: "四、填表。" },
    {
      type: "table",
      text:
        "<table><thead><tr><th>要查的字</th><th>音序</th></tr></thead>" +
        "<tbody><tr><td>慢</td><td>M</td></tr><tr><td>深</td><td>S</td></tr></tbody></table>",
    },
  ])
})

test("缺分隔行的单行竖线文本不当表格（避免误判）", () => {
  assert.deepEqual(splitInlineTables("请看 | 这里 | 只是文本"), [{ type: "text", text: "请看 | 这里 | 只是文本" }])
})

test("HTML 表格与管道表混排都能切出", () => {
  const html = "<table><tr><td>甲</td></tr></table>"
  const segs = splitInlineTables("前" + html + "中\n| a | b |\n| --- | --- |\n| 1 | 2 |\n后")
  assert.deepEqual(
    segs.map((s) => s.type),
    ["text", "table", "text", "table", "text"],
  )
})

// ── markdown 标题记号清理（英语模块常见 `## Tom's Family`）──

test("去掉行首 markdown 标题记号，正文不受影响", () => {
  assert.equal(stripMdHeaders("## Tom's Family\nMy name is Tom."), "Tom's Family\nMy name is Tom.")
  assert.equal(stripMdHeaders("# 一、看拼音写词语"), "一、看拼音写词语")
  assert.equal(stripMdHeaders("###### 小标题"), "小标题")
})

test("井号后没有空格不当标题（题号/标签不误伤）", () => {
  assert.equal(stripMdHeaders("#1 苹果"), "#1 苹果")
  assert.equal(stripMdHeaders("C# 语言"), "C# 语言")
  assert.equal(stripMdHeaders("价格# 已改"), "价格# 已改")
})

test("行中的井号不动，只吃行首", () => {
  assert.equal(stripMdHeaders("见 ## 说明"), "见 ## 说明")
})

test("tidyInlineSpaces 一并清掉标题记号（语文/数学路径同样生效）", () => {
  assert.equal(tidyInlineSpaces("## Tom's Family"), "Tom's Family")
})

// ── 标签项（近义词：/ 反义词：/ 答：）各自成段 ──

test("行首标签项不并进上一段（避免「反义 / 词」词内断行）", () => {
  assert.deepEqual(reflowText("近义词：镇定—减少—寒冷—危险—\n反义词：美丽—模糊—镇静—凶猛—"), [
    "近义词：镇定—减少—寒冷—危险—",
    "反义词：美丽—模糊—镇静—凶猛—",
  ])
})

test("标签行与其内容行仍并回同一段（标签后换行是折行）", () => {
  // 中文↔西文边界按既定规则补一个空格（joinPieces）
  assert.deepEqual(reflowText("答：\n3 个"), ["答： 3个"])
})

test("行首 1~6 字 + 冒号一律视作标签项（折行偶会误判，接受此取舍：试卷里标签行远比折行冒号常见）", () => {
  assert.deepEqual(reflowText("他说，这个问题\n很大的：需要仔细想"), [
    "他说，这个问题",
    "很大的：需要仔细想",
  ])
})
