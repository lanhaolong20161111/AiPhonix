/** 多音字注音值校验回归测试
 *
 * 事故：模型把「(非多音，跳过)」写进 polyphones 的**值**里，旧解析只判非空，
 * 导致结果页在汉字上方的拼音位渲染出这句话。这里锁住「值必须是真拼音」这条规则。
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { isPinyinValue, cleanPolyphones, sanitizeBlockPolyphones } from "../src/lib/pinyinValue.js"

test("非法值：模型写进值里的说明文字必须被拒", () => {
  const bad = [
    "(非多音，跳过)", // 现场截图里的原话
    "（非多音）",
    "非多音",
    "跳过",
    "无需标注",
    "样",
    "yang4 样",
    "",
    "   ",
    "a1b2c3d4e5f6g7",
    "zhong4!", // 带标点
  ]
  for (const v of bad) {
    assert.equal(isPinyinValue(v), false, `应判非法: ${JSON.stringify(v)}`)
  }
})

test("合法值：带调号与数字调的拼音都要放行", () => {
  const good = [
    "zhòng", "háng", "zhuó", "chóng", "yàng", "xíng", "lè", "yuè", "lǜ", "de", "n",
    "zhong4", "hang2", "de5", "lv4",
  ]
  for (const v of good) {
    assert.equal(isPinyinValue(v), true, `应判合法: ${JSON.stringify(v)}`)
  }
})

test("cleanPolyphones：只保留合法项，说明文字那条被丢掉", () => {
  const out = cleanPolyphones({
    "样": "(非多音，跳过)", // ← 必须被丢掉
    "行": "háng",
    "乐": "yuè",
    "地": "非多音",
  })
  assert.deepEqual(out, { "行": "háng", "乐": "yuè" })
})

test("cleanPolyphones：多字 key 与非对象入参安全处理", () => {
  assert.deepEqual(cleanPolyphones({ "行动": "xíng" }), {})
  assert.deepEqual(cleanPolyphones(null), {})
  assert.deepEqual(cleanPolyphones("x"), {})
})

test("sanitizeBlockPolyphones：命中旧缓存也能清掉已落库的脏值", () => {
  const blocks = [
    { type: "body", text: "一模样", polyphones: { "样": "(非多音，跳过)", "模": "mú" } },
    { type: "body", text: "干净", polyphones: { "干": "gān" } },
    { type: "table", text: "<table></table>" }, // 无 polyphones 字段，原样返回
  ]
  const out = sanitizeBlockPolyphones(blocks) as typeof blocks
  assert.deepEqual(out[0].polyphones, { "模": "mú" })
  assert.deepEqual(out[1].polyphones, { "干": "gān" })
  assert.equal(out[2].polyphones, undefined)
})

test("sanitizeBlockPolyphones：全非法时返回空对象而非留着脏值", () => {
  const out = sanitizeBlockPolyphones([{ polyphones: { "样": "非多音" } }]) as { polyphones: Record<string, string> }[]
  assert.deepEqual(out[0].polyphones, {})
})

test("sanitizeBlockPolyphones：非数组入参原样返回", () => {
  assert.equal(sanitizeBlockPolyphones(null), null)
  assert.equal(sanitizeBlockPolyphones(undefined), undefined)
})
