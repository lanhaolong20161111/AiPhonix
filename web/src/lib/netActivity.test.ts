/**
 * 「网络静默等待」单测 —— 保护 SW 自动 reload 不掐死在飞请求这条逻辑。
 *
 * 背景：实测（2026-09-20）中 reload 已发出 23 秒的 `/health` 预热请求，
 * 导致冷启动代价从"用户打字期间"被推迟到"用户点击那一刻"。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { beginNet, endNet, netInFlight, whenNetIdle } from "./netActivity.js"

describe("netActivity", () => {
  it("begin/end 成对计数，归零", () => {
    assert.equal(netInFlight(), 0)
    beginNet()
    beginNet()
    assert.equal(netInFlight(), 2)
    endNet()
    assert.equal(netInFlight(), 1)
    endNet()
    assert.equal(netInFlight(), 0)
  })

  it("多余 endNet 不会把计数打成负数", () => {
    endNet()
    endNet()
    assert.equal(netInFlight(), 0)
  })

  it("空闲时 whenNetIdle 立刻返回", async () => {
    const t0 = Date.now()
    await whenNetIdle(5000)
    assert.ok(Date.now() - t0 < 50, "空闲时不应等待")
  })

  it("有在飞请求时，等到最后一个结束才返回", async () => {
    beginNet()
    beginNet()
    let done = false
    const p = whenNetIdle(5000).then(() => {
      done = true
    })
    endNet()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(done, false, "还剩 1 个在飞请求时不应返回")
    endNet()
    await p
    assert.equal(done, true)
  })

  it("超时也会返回（长轮询页面不能永远拿不到新版本）", async () => {
    beginNet()
    const t0 = Date.now()
    await whenNetIdle(30)
    const dt = Date.now() - t0
    assert.ok(dt >= 25 && dt < 500, `应在超时后返回，实际 ${dt}ms`)
    assert.equal(netInFlight(), 1, "在飞请求仍在飞（只是不再等它）")
    endNet()
  })

  it("多个等待者都会被唤醒", async () => {
    beginNet()
    const ps = [whenNetIdle(5000).then(() => "ok"), whenNetIdle(5000).then(() => "ok")]
    endNet()
    assert.deepEqual(await Promise.all(ps), ["ok", "ok"])
  })
})
