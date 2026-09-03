/**
 * 双端路由 parity 检查（P1-5 护栏）
 * 比对 server_cf 与 server_ts 的 /api/v1 路由注册表，捕获双端漂移：
 *  - 仅当「同一路径在两端的 HTTP 方法集合不相交」时硬失败（真正的契约不一致）；
 *  - 仅存在于某一端的路由按 feature 前缀归类，列为「需人工确认的有意差异」(warning)。
 *
 * 用法: npx tsx scripts/parity-check.mts   (在 AiPhonix 根目录运行)
 * 退出码: 0 = 无致命不一致（仅警告）；1 = 检测到真正的契约漂移。
 */
import { app as cfApp } from "../server_cf/src/index.js"
import { app as tsApp } from "../server_ts/src/index.js"

type RouteEntry = { path: string; method: string }

const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])

function collect(app: { routes: RouteEntry[] }): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const r of app.routes) {
    const method = (r.method || "").toUpperCase()
    if (!METHODS.has(method)) continue
    const path = r.path.replace(/\/+$/, "") || "/"
    if (!path.startsWith("/api/v1")) continue
    if (!m.has(path)) m.set(path, new Set())
    m.get(path)!.add(method)
  }
  return m
}

const cf = collect(cfApp as any)
const ts = collect(tsApp as any)

const allPaths = new Set([...cf.keys(), ...ts.keys()])
const onlyCf: string[] = []
const onlyTs: string[] = []
const methodConflicts: string[] = []

for (const p of allPaths) {
  const c = cf.get(p)
  const t = ts.get(p)
  if (c && !t) onlyCf.push(p)
  else if (t && !c) onlyTs.push(p)
  else if (c && t) {
    const shared = [...c].filter((m) => t.has(m))
    if (shared.length === 0) {
      methodConflicts.push(`${p}  cf=[${[...c]}] ts=[${[...t]}]`)
    }
  }
}

function featurePrefix(path: string): string {
  const parts = path.split("/") // ["", "api", "v1", "xxx", ...]
  return parts.slice(0, 4).join("/") || path
}

function group(paths: string[]): Record<string, number> {
  const g: Record<string, number> = {}
  for (const p of paths) {
    const f = featurePrefix(p)
    g[f] = (g[f] || 0) + 1
  }
  return g
}

console.log("=== 双端 /api/v1 路由 parity 报告 ===")
console.log(`server_cf 路由数: ${cf.size}  server_ts 路由数: ${ts.size}`)
console.log("")
console.log(`## 仅存在于 server_cf (${onlyCf.length}) —— 按 feature 前缀:`)
for (const [f, n] of Object.entries(group(onlyCf)).sort()) console.log(`  ${f}  (${n})`)
console.log("")
console.log(`## 仅存在于 server_ts (${onlyTs.length}) —— 按 feature 前缀:`)
for (const [f, n] of Object.entries(group(onlyTs)).sort()) console.log(`  ${f}  (${n})`)
console.log("")
if (methodConflicts.length) {
  console.log(`## ❌ 致命：同路径方法集合不相交 (${methodConflicts.length}) ##`)
  for (const c of methodConflicts) console.log(`  ${c}`)
} else {
  console.log("## ✅ 无方法集合不相交的契约漂移 ##")
}

// 仅存在于某一端的路由属「设计性差异」(cf=生产 Cloudflare 专属 / ts=本地 SQLite 专属)，
// 这里只告警不阻断；真正需要双端一致的特性请以 contracts 为准并在 review 中确认。
const fatal = methodConflicts.length > 0
process.exit(fatal ? 1 : 0)
