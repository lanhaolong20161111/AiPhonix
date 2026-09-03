/** P2-10b 契约漂移护栏：server_cf 必须转发 server_ts 的单一事实来源，不得复制 schema */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as tsContracts from "../src/contracts/index.js"
import * as cfContracts from "../../server_cf/src/contracts/index.js"

type AnyContracts = Record<string, unknown>

describe("contract parity (P2-10b)", () => {
  it("两端导出的契约名称集合一致", () => {
    const ts = Object.keys(tsContracts).sort()
    const cf = Object.keys(cfContracts).sort()
    assert.deepEqual(cf, ts, "导出名称不一致即漂移")
  })

  it("曾漂移字段 weights 在双端解析行为一致", () => {
    const fixture = { weights: { a: "1", b: "2" } }
    const ra = (tsContracts as AnyContracts).PracticeWeightsResponseSchema.safeParse(fixture)
    const rb = (cfContracts as AnyContracts).PracticeWeightsResponseSchema.safeParse(fixture)
    assert.equal(rb.success, ra.success)
    if (ra.success && rb.success) assert.deepEqual(rb.data, ra.data)
  })

  it("server_cf 是 server_ts 的纯转发（同一 schema 实例，单一事实来源）", () => {
    assert.equal(
      (cfContracts as AnyContracts).PracticeWeightsResponseSchema,
      (tsContracts as AnyContracts).PracticeWeightsResponseSchema,
      "server_cf 的 schema 应与 server_ts 同一对象（转发而非复制），否则会再次漂移",
    )
  })
})
