/** ttlCache 单测 — 守护 🟠6「模块级缓存装载一次永不刷新 → TTL 化」整改。
 *
 * 该缓存是「数据源更新后各 isolate 陈旧」问题的修复本体，一旦退化会静默返回旧数据，
 * 因此把它的全部语义钉死：懒加载 / TTL 复用 / 过期重读 / 并发单飞 / 失败即失效 / refresh 重置计时。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ttlCache } from "../src/lib/ttlCache.js"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("ttlCache", () => {
  it("懒加载：构造时不触发 loader，首次 get 才装载", async () => {
    let calls = 0
    const store = ttlCache(async () => {
      calls++
      return "v1"
    }, 1000)
    assert.equal(calls, 0, "构造阶段不应产生任何装载")
    assert.equal(await store.get(), "v1")
    assert.equal(calls, 1)
  })

  it("TTL 内复用：多次 get 只装载一次", async () => {
    let calls = 0
    const store = ttlCache(async () => {
      calls++
      return "v"
    }, 1000)
    await store.get()
    await store.get()
    await store.get()
    assert.equal(calls, 1)
  })

  it("TTL 过期后重读：超过 ttl 再次触发 loader", async () => {
    let calls = 0
    const store = ttlCache(async () => {
      calls++
      return `v${calls}`
    }, 60)
    assert.equal(await store.get(), "v1")
    await sleep(90)
    assert.equal(await store.get(), "v2")
    assert.equal(calls, 2)
  })

  it("并发单飞：并发 get 合并为一次装载", async () => {
    let calls = 0
    const store = ttlCache(async () => {
      calls++
      await sleep(30)
      return "v"
    }, 1000)
    const [a, b, c] = await Promise.all([store.get(), store.get(), store.get()])
    assert.deepEqual([a, b, c], ["v", "v", "v"])
    assert.equal(calls, 1, "并发请求应共享同一个 in-flight Promise")
  })

  it("装载失败即失效：失败不缓存坏值，下次请求可重试", async () => {
    let fail = true
    let calls = 0
    const store = ttlCache(async () => {
      calls++
      if (fail) throw new Error("boom")
      return "ok"
    }, 1000)
    await assert.rejects(store.get(), /boom/)
    fail = false
    assert.equal(await store.get(), "ok", "失败后必须允许重试，不能把错误焊死到 isolate 回收")
    assert.equal(calls, 2)
  })

  it("refresh 重置计时：本地写完后不会立刻重读", async () => {
    let calls = 0
    const store = ttlCache(async () => {
      calls++
      return "v"
    }, 200)
    await store.get() // t≈0 装载
    await sleep(150)
    store.refresh() // 模拟本地写完，重置计时到 t≈150
    await sleep(130) // t≈280：距 refresh 130ms < ttl 200ms
    await store.get()
    assert.equal(calls, 1, "refresh 后应重新计时；未 refresh 时此处已过期会重读")
  })
})
