import { test } from "node:test"
import assert from "node:assert/strict"
import { splitSentences, mergeShorts } from "./articleSplit"

// ── splitSentences ──

test("按中文句末标点切句，标点保留在句中", () => {
  assert.deepEqual(splitSentences("我爱祖国。我爱人民。"), ["我爱祖国。", "我爱人民。"])
})

test("感叹号/问号/分号/英文标点都能断句", () => {
  assert.deepEqual(splitSentences("多美啊！是吗？好；走吧!Go?"), ["多美啊！", "是吗？", "好；", "走吧!", "Go?"])
})

test("换行强制断句", () => {
  assert.deepEqual(splitSentences("第一段内容\n第二段内容"), ["第一段内容", "第二段内容"])
})

test("吸收句末右引号与省略号，不切到下一句", () => {
  assert.deepEqual(splitSentences("他说：“好。”然后走了。"), ["他说：“好。”", "然后走了。"])
  assert.deepEqual(splitSentences("他想了很久……最后笑了。"), ["他想了很久……", "最后笑了。"])
})

test("去空白、丢空段、末尾无标点也成句", () => {
  assert.deepEqual(splitSentences("  你好。  \n\n  再见"), ["你好。", "再见"])
})

test("空输入返回空数组", () => {
  assert.deepEqual(splitSentences(""), [])
  assert.deepEqual(splitSentences("   \n  "), [])
})

// ── mergeShorts ──

test("按归一化文本匹配（忽略标点差异）", () => {
  const got = mergeShorts(["我爱祖国。", "我爱人民。"], [
    { text: "我爱人民", short: "人民" },
    { text: "我爱祖国", short: "祖国" },
  ])
  assert.deepEqual(got, [
    { text: "我爱祖国。", short: "祖国" },
    { text: "我爱人民。", short: "人民" },
  ])
})

test("文本对不上时按下标兜底；缺失的句子给空串", () => {
  const got = mergeShorts(["甲。", "乙。", "丙。"], [{ text: "完全不同", short: "X" }])
  assert.deepEqual(got, [
    { text: "甲。", short: "X" },
    { text: "乙。", short: "" },
    { text: "丙。", short: "" },
  ])
})

test("items 为空/undefined 时全部给空串", () => {
  assert.deepEqual(mergeShorts(["甲。"], undefined), [{ text: "甲。", short: "" }])
  assert.deepEqual(mergeShorts(["甲。"], []), [{ text: "甲。", short: "" }])
})
