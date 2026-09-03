import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./responsive",
  timeout: 180_000,
  workers: 1, // 串行：审计共享登录 context，且避免多浏览器实例同时打同一后端
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ignoreHTTPSErrors: true,
    headless: true,
    trace: "off",
  },
})