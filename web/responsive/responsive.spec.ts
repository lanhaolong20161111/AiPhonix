/** Responsive Layout Audit — Playwright 入口
 * 流程：登录一次（共享 context）→ 对每个页面×视口：
 *   1) setViewportSize + goto
 *   2) 等待渲染 → captureDOM() 采集几何
 *   3) runRules() 在 Node 侧跑规则
 *   4) 截图存档
 * 汇总 → emitReport()（控制台 + JSON）
 */
import { test } from "@playwright/test"
import type { BrowserContext } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { BASE_URL, DEFAULT_VIEWPORTS, PAGES, SHOT_DIR, TEST_USER, VIEWPORTS } from "./audit.config"
import { captureDOM, runRules } from "./rules"
import { buildReport, emitReport, type PageResult } from "./report"

async function uiLogin(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage()
  try {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${BASE_URL}/web/login`, { waitUntil: "domcontentloaded", timeout: 20000 })
    await page.getByPlaceholder("请输入用户名").fill(TEST_USER.username)
    await page.getByPlaceholder("请输入密码").fill(TEST_USER.password)
    await page.locator("button.auth-submit").click()
    await page.waitForURL("**/web/home", { timeout: 15000 })
    await page.close()
    return true
  } catch (e) {
    console.warn(`[login] failed: ${String(e)}`)
    await page.close().catch(() => {})
    return false
  }
}

test("responsive layout audit", async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const loggedIn = await uiLogin(context)
  if (!loggedIn) console.warn("[audit] 登录失败——审计只能覆盖免登录页面，受限页会全部落在登录页")

  mkdirSync(SHOT_DIR, { recursive: true })
  const results: PageResult[] = []

  for (const target of PAGES) {
    const viewportNames = target.viewports ?? DEFAULT_VIEWPORTS
    for (const vpName of viewportNames) {
      const vp = VIEWPORTS.find((v) => v.name === vpName)!
      const page = await context.newPage()
      const res: PageResult = { page: target.name, url: target.url, viewport: vpName, group: vp.group, violations: [] }
      try {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        // 登录失败时给受限页一次机会：直接注入 homepage 后重定向的场景跳过（见下）
        await page.goto(`${BASE_URL}${target.url}`, { waitUntil: "domcontentloaded", timeout: 25000 })
        // 若被 RequireAuth 弹回登录页（登录态丢失），跳过该组合
        if (target.auth && page.url().includes("/web/login")) {
          res.skipped = true
          results.push(res)
          await page.close()
          continue
        }
        await page.waitForTimeout(target.settleMs ?? 1500)
        // 等待首个交互内容出现（兜底懒加载页）
        await page.waitForSelector("body > *", { timeout: 5000 }).catch(() => {})
        const cap = await page.evaluate(captureDOM)
        res.violations = runRules(cap, { viewportName: vpName, group: vp.group, expect: target.expect })
        // 截图（视口首屏；fullPage 对长列表页太大，统一首屏）
        const slug = target.name.replace(/[^\w\u4e00-\u9fa5]+/g, "_")
        await page.screenshot({ path: join(SHOT_DIR, `${slug}__${vpName}.png`) }).catch(() => {})
      } catch (e) {
        res.violations = [{ rule: "G000", sev: "P1", msg: `页面加载/审计异常: ${String(e)}`, n: 1, samples: [] }]
      } finally {
        await page.close().catch(() => {})
        results.push(res)
      }
    }
  }

  await context.close()
  const report = buildReport(results, BASE_URL)
  emitReport(report)
})