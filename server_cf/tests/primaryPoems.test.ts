/** 小学古诗库搜索单测 — 守护「按诗题/作者一键填入」的正确性。
 *
 * 回归两类已发生过的线上问题：
 *  1) 搜「山行」被《三衢道中》正文「小溪泛尽却山行」抢走 → 短题不得命中别的诗正文；
 *  2) 搜「夜书所见」被拆成「所见」误配 → 去掉「query 含标题」的反向匹配，且库内需有《夜书所见》。
 * 另覆盖：作者搜索、首句反查、重名同题（悯农）区分、空/无结果。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { searchPrimaryPoems, PRIMARY_POEMS } from "../src/data/primary_poems.js"

const titles = (q: string) => searchPrimaryPoems(q).map((p) => p.title)

describe("searchPrimaryPoems 标题搜索", () => {
  it("库内数量合理（≥100）且字段完整", () => {
    assert.ok(PRIMARY_POEMS.length >= 100, `实际 ${PRIMARY_POEMS.length}`)
    for (const p of PRIMARY_POEMS) {
      assert.ok(p.title && p.dynasty && p.author && p.text, `缺字段: ${JSON.stringify(p)}`)
    }
  })

  it("「山行」只返回《山行》杜牧，不把《三衢道中》带出来", () => {
    const r = searchPrimaryPoems("山行")
    assert.equal(r.length, 1)
    assert.equal(r[0].title, "山行")
    assert.equal(r[0].author, "杜牧")
    assert.ok(r[0].text.startsWith("远上寒山石径斜"))
  })

  it("「夜书所见」精确命中《夜书所见》叶绍翁（不再退回《所见》）", () => {
    const r = searchPrimaryPoems("夜书所见")
    assert.equal(r[0].title, "夜书所见")
    assert.equal(r[0].author, "叶绍翁")
  })

  it("「所见」返回三种含「所见」的诗，供按作者区分", () => {
    const t = titles("所见")
    assert.ok(t.includes("所见"))
    assert.ok(t.includes("夜书所见"))
    assert.ok(t.includes("舟夜书所见"))
    assert.equal(t[0], "所见") // 精确题名排第一
  })

  it("「悯农」返回两首，题名含区分信息", () => {
    const t = titles("悯农")
    assert.equal(t.length, 2)
    assert.ok(t.every((x) => x.startsWith("悯农（")))
  })

  it("长句反查仍可用：首句/正文 ≥4 字才匹配", () => {
    assert.deepEqual(titles("床前明月光"), ["静夜思"])
    assert.deepEqual(titles("霜叶红于二月花"), ["山行"])
    // 短串不触发正文反查
    assert.ok(!titles("黄鹂").includes("三衢道中"))
  })

  it("按作者搜索（≥2 字）", () => {
    const li = titles("李白")
    assert.ok(li.length >= 5)
    assert.ok(li.every((t) => PRIMARY_POEMS.find((p) => p.title === t)?.author === "李白"))
    assert.ok(titles("白居易").includes("池上"))
  })

  it("空查询与无结果返回空数组", () => {
    assert.deepEqual(searchPrimaryPoems(""), [])
    assert.deepEqual(searchPrimaryPoems("   "), [])
    assert.deepEqual(searchPrimaryPoems("不存在的诗"), [])
  })
})
