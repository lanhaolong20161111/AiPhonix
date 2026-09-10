/** IncrementalLineExtractor 单测 — 守护流式识图的「边识别边出字」正确性。
 *
 * 该解析器决定学生多快能读到第一行文字，边界情况多（分块切断、转义、重复），
 * 一旦退化会静默出现「半行/乱码/丢字」，因此把语义钉死：
 * 分块闭合才吐 / 转义正确 / 去重 / 跨块拼接 / 表格块级 text。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { IncrementalLineExtractor } from "../src/lib/incrementalJsonText.js"

describe("IncrementalLineExtractor", () => {
  it("完整 JSON 一次喂入：按顺序吐所有 text", () => {
    const ex = new IncrementalLineExtractor()
    const json = '{"blocks":[{"type":"title","lines":[{"text":"静夜思","indent":0}]},{"type":"body","lines":[{"text":"床前明月光","indent":1},{"text":"疑是地上霜","indent":0}]}]}'
    assert.deepEqual(ex.push(json), ["静夜思", "床前明月光", "疑是地上霜"])
  })

  it("逐字符喂入：只在字符串闭合后才吐，绝不吐半行", () => {
    const ex = new IncrementalLineExtractor()
    const json = '{"blocks":[{"lines":[{"text":"春眠不觉晓"}]}]}'
    const out: string[] = []
    for (const ch of json) out.push(...ex.push(ch))
    assert.deepEqual(out, ["春眠不觉晓"], "应收敛为一次完整行")
  })

  it("在字符串中间切断：不提前吐，补齐后吐出完整行", () => {
    const ex = new IncrementalLineExtractor()
    const a = '{"blocks":[{"lines":[{"text":"欲穷千'
    const b = '里目，更上一层楼"}]}]}'
    assert.deepEqual(ex.push(a), [], "未闭合不得吐字")
    assert.deepEqual(ex.push(b), ["欲穷千里目，更上一层楼"])
  })

  it("转义：\\n 还原为换行、\\\" 不误判为结束", () => {
    const ex = new IncrementalLineExtractor()
    const json = '{"lines":[{"text":"第一行\\n第二行"},{"text":"带\\"引号\\"的行"}]}'
    const out = ex.push(json)
    assert.deepEqual(out, ["第一行\n第二行", '带"引号"的行'])
  })

  it("转义符恰好落在块尾：不吐字，下一块补齐", () => {
    const ex = new IncrementalLineExtractor()
    // 值末尾是 \" 被切成 "…\" + "…"
    assert.deepEqual(ex.push('{"lines":[{"text":"引号\\'), [])
    assert.deepEqual(ex.push('"结束"}]}'), ['引号"结束'])
  })

  it("去重：模型重跑/重复回显同一行只吐一次", () => {
    const ex = new IncrementalLineExtractor()
    assert.deepEqual(ex.push('{"lines":[{"text":"重复行"}]}'), ["重复行"])
    assert.deepEqual(ex.push('{"lines":[{"text":"重复行"},{"text":"新行"}]}'), ["新行"])
  })

  it("空 text 不吐", () => {
    const ex = new IncrementalLineExtractor()
    assert.deepEqual(ex.push('{"lines":[{"text":""},{"text":"  "},{"text":"有内容"}]}'), ["有内容"])
  })

  it("表格块级 text（HTML）也能取到", () => {
    const ex = new IncrementalLineExtractor()
    const json = '{"blocks":[{"type":"table","text":"<table><tr><td>甲</td></tr></table>","lines":[{"text":"<table><tr><td>甲</td></tr></table>"}]}]}'
    assert.deepEqual(ex.push(json), ["<table><tr><td>甲</td></tr></table>"])
  })

  it("lines getter 返回全部已吐行", () => {
    const ex = new IncrementalLineExtractor()
    ex.push('{"lines":[{"text":"甲"},{"text":"乙"}]}')
    assert.deepEqual(ex.lines, ["甲", "乙"])
  })

  it("非 JSON 前缀噪声不影响提取", () => {
    const ex = new IncrementalLineExtractor()
    const json = '好的，以下是识别结果：\n{"lines":[{"text":"正文行"}]}'
    assert.deepEqual(ex.push(json), ["正文行"])
  })
})
