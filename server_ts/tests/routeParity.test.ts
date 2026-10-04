/**
 * 路由 parity 门禁 —— 补 `contractParity.test.ts` 的盲区。
 *
 * `contractParity` 只比 zod schema 的结构指纹；它**抓不到**路由/端点漂移。
 * 本测试从两端 Hono 实例取端点全集（`METHOD /path`）逐条比对，
 * 差异必须**恰好等于** `tests/routeDivergence.ts` 里显式冻结的部分。
 *
 * ## ⚠️ 为什么用「集合」而不是「数组」
 * Hono 会把 `router.get(path, mw, handler)` 里的**每个 handler 各存成一条同路径条目**
 * （实测 `visits.ts` 只有 1 个 `router.get("/visits", requireAuth(), h)`，
 * 路由表里却是 2 条：中间件一条、处理器一条）。不去重就会把每个带守卫的路由都数成两次。
 * 也因此这份门禁只管「端点集合」，**不管注册顺序** —— 顺序仍需靠人（见 manifest 文件头警告）。
 *
 * ## 环境
 * ★ 必须用**系统 Node 24** 跑（better-sqlite3 按 Node 24 编译，受管 Node 22 会 ERR_DLOPEN_FAILED）。
 * 导入 `server_ts/src/index.ts` 会连带执行 `src/db/index.ts` 的顶层建库逻辑，
 * 故先把 `DATABASE_PATH` 指到临时目录，避免碰开发者真实的 `shared/data/app.db`。
 */
import { after, describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ROUTE_DIVERGENCE } from "./routeDivergence.js"

// ★ 顺序关键：必须先设 DATABASE_PATH，再动态 import 两端入口（静态 import 会被提升到前面）
const TMP_DIR = mkdtempSync(join(tmpdir(), "aiphonix-routeparity-"))
process.env.DATABASE_PATH = join(TMP_DIR, "parity-probe.db")

const cfApp = (await import("../../server_cf/src/index.js")).app
const tsApp = (await import("../src/index.js")).app
const cfModules = (await import("../../server_cf/src/modules/manifest.js")).MODULES
const tsModules = (await import("../src/modules/manifest.js")).MODULES

after(() => {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* Windows 上 sqlite 句柄可能未释放，临时目录留着也无害 */
  }
})

/** 真实 HTTP 方法；`ALL`（Hono 的 `.use()`）与 `OPTIONS` 不算业务端点。 */
const REAL_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"])

function endpointsOf(app: unknown): Set<string> {
  const routes = (app as { routes?: { method: string; path: string }[] }).routes ?? []
  const out = new Set<string>()
  for (const r of routes) {
    const m = String(r.method).toUpperCase()
    if (!REAL_METHODS.has(m)) continue
    out.add(`${m} ${r.path}`)
  }
  return out
}

const cfEndpoints = endpointsOf(cfApp)
const tsEndpoints = endpointsOf(tsApp)

const sorted = (s: Iterable<string>): string[] => [...s].sort()
const paste = (arr: string[]): string => JSON.stringify(arr, null, 2).replace(/^/gm, "      ")

/**
 * 断言白名单自身是干净的（无重复条目）。
 * 刻意**不**要求字典序：声明文件按「为什么分叉」分组书写，可读性优先于排序；
 * 比对时两侧都会 `sorted()` 归一，故顺序不影响判定。
 */
function assertNoDuplicate(name: string, list: string[]): void {
  const dup = list.filter((x, i) => list.indexOf(x) !== i)
  assert.deepEqual(dup, [], `${name} 里有重复条目：${JSON.stringify([...new Set(dup)])}`)
}

describe("route parity（路由/端点漂移护栏）", () => {
  it("两端导出的模块 id 集合一致（差异须在 routeDivergence 里声明）", () => {
    const cfIds = new Set(cfModules.map((m) => m.id))
    const tsIds = new Set(tsModules.map((m) => m.id))

    const cfOnly = sorted([...cfIds].filter((x) => !tsIds.has(x)))
    const tsOnly = sorted([...tsIds].filter((x) => !cfIds.has(x)))

    assert.deepEqual(
      cfOnly,
      [...ROUTE_DIVERGENCE.cfOnlyModules].sort(),
      `server_cf 独有模块与声明不符。\n  实际：${JSON.stringify(cfOnly)}\n  声明：${JSON.stringify(sorted(ROUTE_DIVERGENCE.cfOnlyModules))}`,
    )
    assert.deepEqual(
      tsOnly,
      [...ROUTE_DIVERGENCE.tsOnlyModules].sort(),
      `server_ts 独有模块与声明不符。\n  实际：${JSON.stringify(tsOnly)}\n  声明：${JSON.stringify(sorted(ROUTE_DIVERGENCE.tsOnlyModules))}`,
    )
  })

  it("两端模块 id 无重复（同 id 出现两次说明清单被误复制）", () => {
    for (const [label, mods] of [
      ["server_cf", cfModules],
      ["server_ts", tsModules],
    ] as const) {
      const ids = mods.map((m) => m.id)
      const dup = ids.filter((x, i) => ids.indexOf(x) !== i)
      assert.deepEqual(dup, [], `${label} 的 manifest 里有重复模块 id：${JSON.stringify(dup)}`)
    }
  })

  it("两端端点集合仅差「已声明」的部分", () => {
    const cfOnly = sorted([...cfEndpoints].filter((x) => !tsEndpoints.has(x)))
    const tsOnly = sorted([...tsEndpoints].filter((x) => !cfEndpoints.has(x)))

    const declaredCf = [...ROUTE_DIVERGENCE.cfOnly].sort()
    const declaredTs = [...ROUTE_DIVERGENCE.tsOnly].sort()

    assert.deepEqual(
      cfOnly,
      declaredCf,
      "server_cf 独有端点 ≠ 声明。新增/删除的端点要么镜像到 server_ts，要么写进 tests/routeDivergence.ts。\n" +
        `  实际 cfOnly：\n${paste(cfOnly)}\n`,
    )
    assert.deepEqual(
      tsOnly,
      declaredTs,
      "server_ts 独有端点 ≠ 声明。\n" + `  实际 tsOnly：\n${paste(tsOnly)}\n`,
    )
  })

  it("差异声明文件本身是干净的（各列表均无重复条目）", () => {
    assertNoDuplicate("cfOnly", ROUTE_DIVERGENCE.cfOnly)
    assertNoDuplicate("tsOnly", ROUTE_DIVERGENCE.tsOnly)
    assertNoDuplicate("cfOnlyModules", ROUTE_DIVERGENCE.cfOnlyModules)
    assertNoDuplicate("tsOnlyModules", ROUTE_DIVERGENCE.tsOnlyModules)
  })

  it("端点规模未意外缩水（防止误删整片路由）", () => {
    // 基线（2026-10-04）：server_cf 214 / server_ts 180 个唯一端点。
    // 只设下界：正常开发只会加端点；掉到之下说明有整块路由没挂上。
    assert.ok(cfEndpoints.size >= 200, `server_cf 端点骤降到 ${cfEndpoints.size}（基线 214），疑似整片路由未挂载`)
    assert.ok(tsEndpoints.size >= 170, `server_ts 端点骤降到 ${tsEndpoints.size}（基线 180），疑似整片路由未挂载`)
  })
})
