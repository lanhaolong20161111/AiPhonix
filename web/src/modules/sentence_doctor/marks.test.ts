/** 句子小医生 · 两件「派生量」的自检
 *
 *  一、病灶坐标（marks.ts）
 *      最狠的一条是**重建**：把每处 mark 依次作用到 text 上，必须逐字等于 fixed。
 *      它一次能挡住三类错：
 *        · cut 抄错一个字（定位不到 → 直接抛）
 *        · 插补位置选错（重建出来是另一句话 → 不等于 fixed）
 *        · 顺序错位（35 处 mark 与 35 处 spot 对不上 → 前后文全乱）
 *      为什么值得写：修改符号要**画在原句上**，位置错了会比不画更坏 ——
 *      孩子会照着错的框去改。位置数据必须由机器盯住。
 *
 *  二、提示语位置（tags.ts）
 *      19 句的提示语文字逐个钉死。反推规则一旦被改动，这里会立刻报出是哪一句。
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { FIX_LEVELS, PUNCT_LEVELS, type FixSpot } from "./data"
import { applyMarks, findOnce, locateMark, occupiedRanges } from "./marks"
import { TAG_POS_LABEL, tagPartIndexOf, tagPositionOf } from "./tags"

/** 35 处病灶通通拍平，方便逐处报错 */
function allSpots(): { where: string; text: string; spot: FixSpot }[] {
  const out: { where: string; text: string; spot: FixSpot }[] = []
  for (const lv of FIX_LEVELS) {
    lv.items.forEach((it, i) => {
      it.spots.forEach((s, si) => {
        out.push({ where: `${lv.key} 第 ${i + 1} 句第 ${si + 1} 处`, text: it.text, spot: s })
      })
    })
  }
  return out
}

describe("病灶坐标 · 字段与工具一致", () => {
  it("cut / with / at 在原句里都只出现一次（重复就画不准）", () => {
    for (const { where, text, spot } of allSpots()) {
      const m = spot.mark
      for (const key of ["cut", "with", "at"] as const) {
        const v = m[key]
        if (v === undefined) continue
        assert.ok(v.length > 0, `${where} 的 ${key} 是空串`)
        assert.ok(
          findOnce(text, v) >= 0,
          `${where} 的 ${key}「${v}」在原句里找不到或出现多次（原句：${text}）`,
        )
      }
    }
  })

  it("四种工具各自该有的字段都在（改正/删除/增补/对调/移动）", () => {
    for (const { where, spot } of allSpots()) {
      const m = spot.mark
      switch (spot.tool) {
        case "改正":
          assert.ok(m.cut && m.put, `${where} 改正刀要 cut + put`)
          assert.ok(!m.with, `${where} 改正刀不该有 with`)
          break
        case "删除":
          assert.ok(m.cut, `${where} 删除刀要 cut`)
          assert.ok(!m.put && !m.with, `${where} 删除刀只能有 cut`)
          break
        case "增补":
          assert.ok(m.put, `${where} 增补刀要 put`)
          assert.ok(m.at || m.cut, `${where} 增补刀要 at 或 cut 指明补在哪儿`)
          assert.ok(!m.with, `${where} 增补刀不该有 with`)
          break
        case "对调":
          assert.ok(m.cut && m.with, `${where} 对调刀要 cut + with`)
          assert.ok(!m.put && !m.at, `${where} 对调刀不该有 put/at`)
          break
        case "移动":
          assert.ok(m.cut && m.with, `${where} 移动刀要 cut + with`)
          assert.ok(!m.put && !m.at, `${where} 移动刀不该有 put/at`)
          assert.notEqual(m.cut, m.with, `${where} 移动刀的两处不能是同一段`)
          break
      }
    }
  })

  it("对调刀的两处必须紧挨着（隔开一段就该用移动刀了）", () => {
    for (const { where, text, spot } of allSpots()) {
      if (spot.tool !== "对调") continue
      const g = locateMark(text, spot.mark)
      assert.ok(g.cut && g.with, `${where} 对调刀的坐标没算出来`)
      const [cs, ce] = g.cut
      const [ws] = g.with
      assert.equal(
        Math.max(cs, ws) - Math.min(ce, ws + spot.mark.with!.length),
        0,
        `${where} 对调刀的两处「${spot.mark.cut}」「${spot.mark.with}」不紧挨 —— ` +
          `中间隔着别的字，只能用移动刀`,
      )
    }
  })

  it("同一句里两处病灶的框不能重叠（画上去会叠成一团）", () => {
    for (const lv of FIX_LEVELS) {
      lv.items.forEach((it, i) => {
        const rs = occupiedRanges(it.text, it.spots)
        for (let a = 0; a < rs.length; a++) {
          for (let b = a + 1; b < rs.length; b++) {
            for (const [x0, x1] of rs[a]) {
              for (const [y0, y1] of rs[b]) {
                assert.ok(
                  x1 <= y0 || y1 <= x0,
                  `${lv.key} 第 ${i + 1} 句：第 ${a + 1} 处与第 ${b + 1} 处的框重叠了`,
                )
              }
            }
          }
        }
      })
    }
  })
})

describe("病灶坐标 · 重建", () => {
  it("★ 把每一处 mark 依次治好，必须逐字等于 fixed", () => {
    for (const lv of FIX_LEVELS) {
      lv.items.forEach((it, i) => {
        const got = applyMarks(it)
        assert.equal(
          got,
          it.fixed,
          `${lv.key} 第 ${i + 1} 句重建结果对不上：\n  得到：${got}\n  期望：${it.fixed}`,
        )
      })
    }
  })

  it("打印每句的病灶跨度（人工核对框的位置用）", () => {
    const lines: string[] = []
    for (const lv of FIX_LEVELS) {
      lines.push(`\n【${lv.name}】`)
      lv.items.forEach((it, i) => {
        const seg = it.spots.map((s) => {
          const g = locateMark(it.text, s.mark)
          const show = (r: [number, number] | null) =>
            r ? `「${it.text.slice(r[0], r[1])}」` : "—"
          return `${s.tool}${show(g.cut)}${s.mark.with ? `→${show(g.with)}` : ""}${
            s.mark.put ? `+${s.mark.put}` : ""
          }`
        })
        lines.push(`  ${i + 1}. ${seg.join(" / ")}`)
      })
    }
    console.log(lines.join("\n"))
    assert.ok(lines.length > 5)
  })
})

/** 19 句的提示语原文 —— 顺序 = PUNCT_LEVELS 的句序 */
const EXPECTED_TAGS: [string, string][] = [
  ["老屋说", "front"],
  ["蜗牛难过地告诉陶陶", "front"],
  ["我问老板", "front"],
  ["老师问", "front"],
  ["同学们激动地欢呼", "front"],
  ["说完", "back"],
  ["蜗牛几乎带着哭腔说", "back"],
  ["陶陶说", "back"],
  ["小狗对小公鸡说道", "back"],
  ["老师站在讲台上说", "back"],
  ["老师说", "mid"],
  ["他说", "mid"],
  ["爸爸大喊", "mid"],
  ["狐狸说道", "mid"],
  ["妈妈问", "mid"],
  ["小公鸡说", "front"],
  ["小公鸡说", "back"],
  ["小公鸡说", "mid"],
  ["老师问", "back"],
]

describe("提示语位置 · 反推", () => {
  it("19 句的提示语逐句对得上，位置也对", () => {
    let n = 0
    for (const lv of PUNCT_LEVELS) {
      lv.items.forEach((it, i) => {
        const [want, wantPos] = EXPECTED_TAGS[n++]
        const ti = tagPartIndexOf(it)
        const where = `${lv.key} 第 ${i + 1} 句`
        assert.ok(ti >= 0 && ti < it.parts.length, `${where} 推不出提示语所在段（ti=${ti}）`)
        assert.equal(it.parts[ti], want, `${where} 提示语推成了「${it.parts[ti]}」，应为「${want}」`)
        const pos = tagPositionOf(it)
        assert.equal(
          pos,
          wantPos,
          `${where} 位置推成了「${pos ? TAG_POS_LABEL[pos] : "null"}」，应为「${TAG_POS_LABEL[wantPos as "front"]}」`,
        )
      })
    }
    assert.equal(n, EXPECTED_TAGS.length, `PUNCT_LEVELS 的句数变了（${n} 句，期望 ${EXPECTED_TAGS.length} 句）`)
  })

  it("四关的提示语位置分布覆盖了前 / 中 / 后三种", () => {
    const got = new Set<string>()
    for (const lv of PUNCT_LEVELS) for (const it of lv.items) got.add(String(tagPositionOf(it)))
    for (const p of ["front", "mid", "back"]) assert.ok(got.has(p), `没有一句「${p}」的题`)
  })
})
