/** 样式裁剪自检 —— 保证 App.css 的 `@skill` 标记与 catalog 一致，且不裁剪时逐字节不变。 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

import { ALL_MODULES } from "./catalog"
import { ALWAYS_ON_SKILLS } from "./skillsSwitch"
import { checkSkillCss, filterCssBySkills, listSkillCssIds, scanSkillBlocks } from "./skillsCss"

const APP_CSS = fs.readFileSync(new URL("../App.css", import.meta.url), "utf8")
const KNOWN_IDS = [...ALL_MODULES.map((m) => m.id), ...ALWAYS_ON_SKILLS]
const TAGGED = listSkillCssIds(APP_CSS)

describe("skillsCss（样式裁剪）", () => {
  it("App.css 的 @skill 标记成对，且 id 都是已知页面（catalog ∪ always-on）", () => {
    const problems = checkSkillCss(APP_CSS, KNOWN_IDS)
    assert.deepEqual(problems, [], problems.join("；"))
    assert.ok(TAGGED.length > 20, "标注了归属的页面太少，标记脚本可能没跑")
  })

  it("样式重头的页面都标了归属（否则说明归属判定漏了）", () => {
    const tagged = new Set(TAGGED)
    for (const id of [
      "math_units",
      "math_mul_one",
      "math_equation_move",
      "math_compound_expr",
      "ai_parse_result",
      "recognition",
      "home",
    ]) {
      assert.ok(tagged.has(id), `${id} 没有样式块（它的规则应该归它）`)
    }
  })

  it("不裁剪（enabled = null）⇒ 与原文逐字节相同", () => {
    assert.equal(filterCssBySkills(APP_CSS, null), APP_CSS)
  })

  it("全部启用 ⇒ 与原文逐字节相同", () => {
    assert.equal(filterCssBySkills(APP_CSS, TAGGED), APP_CSS)
  })

  it("裁剪掉一个模块 ⇒ 该模块的标记块整体消失，其余不动", () => {
    const drop = TAGGED.find((id) => !ALWAYS_ON_SKILLS.includes(id))!
    assert.ok(drop, "没有可裁的模块，测试前提不成立")
    const out = filterCssBySkills(APP_CSS, TAGGED.filter((i) => i !== drop))

    assert.ok(out.length < APP_CSS.length, "输出没有变小，说明没裁掉东西")
    assert.equal(scanSkillBlocks(out).some((b) => b.id === drop), false, `「${drop}」的块还在`)
    // 其余模块块数不变
    const before = scanSkillBlocks(APP_CSS).filter((b) => b.id !== drop).length
    assert.equal(scanSkillBlocks(out).length, before)
    // 没被裁的模块内容原样保留
    const keep = TAGGED.find((i) => i !== drop)!
    const kb = scanSkillBlocks(APP_CSS).find((b) => b.id === keep)!
    const chunk = APP_CSS.split("\n").slice(kb.start + 1, kb.end).join("\n")
    assert.ok(out.includes(chunk), `未裁的「${keep}」块内容变了`)
  })

  it("always-on 页面（登录/注册/占位/home）无论怎么裁都留着", () => {
    const out = filterCssBySkills(APP_CSS, [])
    for (const id of ALWAYS_ON_SKILLS) {
      if (!TAGGED.includes(id)) continue
      assert.ok(
        scanSkillBlocks(out).some((b) => b.id === id),
        `always-on 的「${id}」被裁掉了 —— 页面在、样式没了`,
      )
    }
    // 空集合裁剪应当只留下 always-on 的部分
    assert.ok(out.length < APP_CSS.length)
  })

  it("安全网本身有效：坏标记必须被抓出来", () => {
    const bad = [
      ["未闭合", "a { color: red }\n/* @skill: math_units */\nb { color: blue }\n"],
      ["无开标记", "a { color: red }\n/* @skill:end */\n"],
      ["嵌套", "/* @skill: a */\n/* @skill: b */\nx { }\n/* @skill:end */\n/* @skill:end */\n"],
    ] as const
    for (const [name, css] of bad) {
      assert.throws(() => scanSkillBlocks(css), /@skill/, `${name} 没被抓出来`)
    }
    // 未知 id 要被报出来
    assert.equal(
      checkSkillCss("/* @skill: 不存在的模块 */\nx { }\n/* @skill:end */\n", KNOWN_IDS).length,
      1,
    )
    // 同一个 id 挨着的两块要提示合并
    assert.equal(
      checkSkillCss("/* @skill: a */\nx { }\n/* @skill:end */\n/* @skill: a */\ny { }\n/* @skill:end */\n", ["a"]).length,
      1,
    )
  })
})
