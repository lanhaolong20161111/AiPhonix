/** 句子小医生 · 内容数据自检
 *
 * 这里只查**结构**和**标点方向**——不查「答案对不对」（那要看原练习册）。
 * 两类错误最容易悄悄溜进来：
 *   ① parts 和 slots 数量对不上 ⇒ 句子中间的标点会跑到别的位置上，页面不报错，只是答案错位；
 *   ② 前后引号写反（\u201C / \u201D 看着几乎一样）⇒ 「提示语在中间」那关里
 *      「逗号+后引号」和「逗号+前引号」会变成同一个串，孩子怎么填都被判对。
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { CQ, FIX_LEVELS, FIX_TOOLS, OQ, PUNCT_LEVELS, SLOT_HINT } from "./data"

/** 把一句话按标准答案拼出来（和页面 composeSentence 同口径） */
function model(item: (typeof PUNCT_LEVELS)[number]["items"][number]): string {
  let out = item.slots[0]?.a ?? ""
  item.parts.forEach((p, i) => {
    out += p + (item.slots[i + 1]?.a ?? "")
  })
  return out
}

describe("提示语标点 · 结构", () => {
  it("每一句的 slots 数量 = parts 数量 + 1", () => {
    for (const lv of PUNCT_LEVELS) {
      lv.items.forEach((it, i) => {
        assert.equal(
          it.slots.length,
          it.parts.length + 1,
          `${lv.key} 第 ${i + 1} 句：slots=${it.slots.length} 但 parts=${it.parts.length}（应为 parts+1）`,
        )
      })
    }
  })

  it("每句至少有两个练习空位，且 tip 不为空", () => {
    for (const lv of PUNCT_LEVELS) {
      lv.items.forEach((it, i) => {
        const real = it.slots.filter(Boolean).length
        assert.ok(real >= 2, `${lv.key} 第 ${i + 1} 句只有 ${real} 个空位`)
        assert.ok(it.tip.trim().length > 6, `${lv.key} 第 ${i + 1} 句的 tip 太短`)
      })
    }
  })

  it("每个空位的 kind 都有对应的提示语", () => {
    for (const lv of PUNCT_LEVELS) {
      for (const it of lv.items) {
        for (const s of it.slots) {
          if (!s) continue
          assert.ok(SLOT_HINT[s.kind], `未定义的 kind：${s.kind}`)
          assert.ok(s.why.trim().length > 8, `空位「${s.a}」的理由太短`)
        }
      }
    }
  })

  it("引号方向正确：前引号只出现在开头/中段，后引号只出现在收尾", () => {
    for (const lv of PUNCT_LEVELS) {
      lv.items.forEach((it, i) => {
        it.slots.forEach((s, si) => {
          if (!s) return
          const where = `${lv.key} 第 ${i + 1} 句第 ${si + 1} 空（${s.kind}，「${s.a}」）`
          for (const alt of [s.a, ...(s.ok ?? [])]) {
            if (s.kind === "tag" || s.kind === "mid") {
              assert.ok(alt.startsWith("：") || alt.startsWith("，"), `${where} 提示语后面应从冒号或逗号起头`)
              if (alt.includes(OQ)) assert.ok(alt.endsWith(OQ), `${where} 前引号应在末尾`)
              assert.ok(!alt.includes(CQ), `${where} 提示语后面不该出现后引号`)
            }
            if (s.kind === "open") {
              assert.ok(alt.startsWith(OQ), `${where} 话的开头应是前引号`)
              assert.ok(!alt.includes(CQ), `${where} 不该出现后引号`)
            }
            if (s.kind === "close") {
              assert.ok(alt.endsWith(CQ), `${where} 收尾必须以后引号结束`)
              assert.ok(!alt.includes(OQ), `${where} 不该出现前引号`)
            }
            if (s.kind === "in") {
              assert.equal(alt, "，", `${where} 话中间只能用逗号`)
            }
            if (s.kind === "end" || s.kind === "narr") {
              assert.ok(!alt.includes('"') && !alt.includes(OQ) && !alt.includes(CQ), `${where} 引号外不该有引号`)
            }
          }
        })
      })
    }
  })

  it("打印标准句子（人工核对错位用）", () => {
    const lines: string[] = []
    for (const lv of PUNCT_LEVELS) {
      lines.push(`\n【${lv.name}】${lv.rule}`)
      lv.items.forEach((it, i) => lines.push(`  ${i + 1}. ${model(it)}`))
    }
    console.log(lines.join("\n"))
    assert.ok(lines.length > 5)
  })
})

describe("修改病句 · 结构", () => {
  it("答案下标在选项范围内，且选项不重复", () => {
    for (const lv of FIX_LEVELS) {
      lv.items.forEach((it, i) => {
        it.spots.forEach((s, si) => {
          const where = `${lv.key} 第 ${i + 1} 句第 ${si + 1} 处`
          assert.ok(s.answer >= 0 && s.answer < s.options.length, `${where} 的 answer 越界`)
          assert.equal(new Set(s.options).size, s.options.length, `${where} 有重复选项`)
          assert.ok(s.options.length >= 3, `${where} 选项太少（${s.options.length}）`)
          assert.ok(FIX_TOOLS.some((t) => t.key === s.tool), `${where} 手术刀不合法：${s.tool}`)
          assert.ok(s.why.trim().length > 15, `${where} 的理由太短`)
        })
      })
    }
  })

  it("五个符号都在题目里出现过（工具栏不留死按钮）", () => {
    const used = new Set<string>()
    for (const lv of FIX_LEVELS) {
      for (const it of lv.items) for (const s of it.spots) used.add(s.tool)
    }
    for (const t of FIX_TOOLS) {
      assert.ok(
        used.has(t.key),
        `「${t.key}号」摆在工具栏上，但没有任何一道题用到它 —— 孩子点了没反应，会以为是坏了`,
      )
    }
    assert.equal(
      new Set(FIX_TOOLS.map((t) => t.key)).size,
      FIX_TOOLS.length,
      "FIX_TOOLS 里有重复的符号",
    )
  })

  it("每句都有订正句，且订正句与病句不同", () => {
    for (const lv of FIX_LEVELS) {
      lv.items.forEach((it, i) => {
        assert.ok(it.fixed.trim().length > 0, `${lv.key} 第 ${i + 1} 句缺订正句`)
        assert.notEqual(it.fixed, it.text, `${lv.key} 第 ${i + 1} 句的订正句和原句一样，等于没治病`)
      })
    }
  })

  it("打印病句题的题量分布", () => {
    const lines: string[] = []
    let total = 0
    for (const lv of FIX_LEVELS) {
      const spots = lv.items.reduce((n, it) => n + it.spots.length, 0)
      total += lv.items.length
      lines.push(`  ${lv.name}：${lv.items.length} 句 / ${spots} 处`)
    }
    console.log(`\n【修改病句】共 ${total} 句\n` + lines.join("\n"))
    assert.ok(total >= 20)
  })
})
