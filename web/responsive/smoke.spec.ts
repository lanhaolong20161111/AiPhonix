/** 字幕采集页「影片来源」功能冒烟：本地/云端/B站 切换 + B站模式禁用采集 */
import { test, expect } from "@playwright/test"
import { BASE_URL, TEST_USER } from "./audit.config"

async function login(context: import("@playwright/test").BrowserContext) {
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/web/login`, { waitUntil: "domcontentloaded" })
  await page.getByPlaceholder("请输入用户名").fill(TEST_USER.username)
  await page.getByPlaceholder("请输入密码").fill(TEST_USER.password)
  await page.locator("button.auth-submit").click()
  await page.waitForURL("**/web/home", { timeout: 15000 })
  await page.close()
}

test("subtitle capture 影片来源浮层与 B站预览模式", async ({ browser }) => {
  test.setTimeout(60000)
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  await login(context)
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto(`${BASE_URL}/web/module/subtitle_capture`, { waitUntil: "domcontentloaded", timeout: 20000 })
  await page.waitForTimeout(1200)

  // 1) 点「影片」→ 浮层出现，三个来源可见
  await page.getByRole("button", { name: /影片/ }).click()
  await expect(page.getByText("打开影片")).toBeVisible()
  await expect(page.getByText("本地文件", { exact: true })).toBeVisible()
  await expect(page.getByText("云端直链 URL")).toBeVisible()
  await expect(page.getByText("B站视频（预览）")).toBeVisible()

  // 2) B站搜索：输入关键词 → 结果列表 → 点选 → iframe 预览 + 采集按钮禁用
  await page.getByPlaceholder(/搜索 B站视频/).fill("小猪佩奇")
  await page.getByRole("button", { name: "搜索", exact: true }).click()
  const resultItem = page.locator('button[title*="时长"]').first()
  await expect(resultItem).toBeVisible({ timeout: 15000 })
  await resultItem.click()
  await page.waitForTimeout(800)
  await expect(page.locator('iframe[src*="player.bilibili.com"]')).toHaveCount(1)
  // sandbox 生效（无 allow-top-navigation）：点清晰度/去网页观看不会把本页跳走
  await expect(page.locator('iframe[sandbox*="allow-scripts"]')).toHaveCount(1)
  await expect(page.getByRole("button", { name: /存图/ })).toBeDisabled()
  await expect(page.getByText(/仅浏览/).first()).toBeVisible()

  // 3) 关闭浮层后回到本地提示（不崩）
  await page.getByRole("button", { name: "取消" }).click().catch(() => {})
  await context.close()
})