/** Responsive Audit 报告：控制台汇总（P0/P1/P2/P3）+ JSON 落盘 + 评分 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Violation } from "./rules"
import { REPORT_DIR, SHOT_DIR } from "./audit.config"

export interface PageResult {
  page: string
  url: string
  viewport: string
  group: string
  skipped?: boolean
  violations: Violation[]
}

export interface AuditReport {
  generatedAt: string
  baseUrl: string
  pages: PageResult[]
  totals: Record<string, number>
  score: number
}

/** 单个页面×视口组合的分数：有 P1=0（硬伤），有 P2=60（可用性），有 P3=85（视觉规范），干净=100 */
function comboScore(violations: Violation[]): number {
  if (violations.some((v) => v.sev === "P1")) return 0
  if (violations.some((v) => v.sev === "P2")) return 60
  if (violations.some((v) => v.sev === "P3")) return 85
  return 100
}

export function buildReport(results: PageResult[], baseUrl: string): AuditReport {
  const totals: Record<string, number> = { P1: 0, P2: 0, P3: 0 }
  for (const r of results) for (const v of r.violations) totals[v.sev] = (totals[v.sev] ?? 0) + 1
  const scored = results.filter((r) => !r.skipped)
  const score =
    scored.length > 0
      ? Math.round(scored.reduce((acc, r) => acc + comboScore(r.violations), 0) / scored.length)
      : 0
  return { generatedAt: new Date().toISOString(), baseUrl, pages: results, totals, score }
}

function sevChar(sev?: string): string {
  return sev === "P1" ? "✗" : sev === "P2" ? "⚠" : sev === "P3" ? "·" : "✓"
}

/** 打印控制台汇总并写 JSON */
export function emitReport(report: AuditReport): void {
  console.log("\n" + "═".repeat(64))
  console.log("RESPONSIVE LAYOUT AUDIT")
  console.log("═".repeat(64))
  for (const p of report.pages) {
    if (p.skipped) {
      console.log(`  ${p.viewport} ${p.page.padEnd(22)} — skipped`)
      continue
    }
    const line = `  ${p.viewport.padEnd(6)} ${p.page.padEnd(22)} ${p.violations.length === 0 ? "✓" : ""}`
    const sevList = [...new Set(p.violations.map((v) => v.sev))].sort().join("")
    console.log(`  ${p.viewport.padEnd(6)} ${p.page.padEnd(22)} ${p.violations.length} issues ${sevList}`)
    for (const v of p.violations) {
      console.log(`      ${sevChar(v.sev)} [${v.rule}] ${v.msg}`)
      for (const s of v.samples.slice(0, 3)) console.log(`          · ${s}`)
    }
    void line
  }
  console.log("─".repeat(64))
  console.log(`  TOTAL  P1×${report.totals.P1 ?? 0}  P2×${report.totals.P2 ?? 0}  P3×${report.totals.P3 ?? 0}   Score: ${report.score}/100`)
  console.log(`  截图   ${join(SHOT_DIR, "*.png")}`)
  console.log(`  报告   ${join(REPORT_DIR, "latest.json")}`)
  console.log("═".repeat(64))

  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(join(REPORT_DIR, "latest.json"), JSON.stringify(report, null, 2), "utf-8")
  // 便于 CI/脚本判断：P1=0 才算通过
  const pass = (report.totals.P1 ?? 0) === 0
  writeFileSync(join(REPORT_DIR, "pass.json"), JSON.stringify({ pass, p1: report.totals.P1 ?? 0, score: report.score }), "utf-8")
  console.log(pass ? "  RESULT: ✅ PASS (无 P1)" : "  RESULT: ❌ FAIL (存在 P1，P1=0 为门槛)")
}