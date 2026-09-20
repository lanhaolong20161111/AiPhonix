import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"
import "./tailwind.css"
import "./index.css"
import "./App.css"
import { router } from "./routes"
import { whenNetIdle } from "./lib/netActivity"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

// ── PWA 自动更新：部署新版本后自动刷新一次，无需手动硬刷新 ──
// 原理：sw.js 由 vite-plugin-pwa(registerType:autoUpdate) 生成，已内置 skipWaiting + clientsClaim；
// 这里负责：注册 SW + 每 30s 主动检查更新 + 新 SW 安装完成后发 SKIP_WAITING 让其立即接管 + controllerchange 自动 reload。
if ("serviceWorker" in navigator) {
  /** 已成功拿到 registration（拿不到就不起定时器，避免每 30s 抛一次未捕获异常） */
  let updateChecker: (() => void) | null = null

  const ensureRegistered = async (why: string): Promise<void> => {
    if (updateChecker) {
      updateChecker()
      return
    }
    try {
      const reg = await navigator.serviceWorker.register("/web/sw.js", { scope: "/web/" })
      // ⚠️ 某些环境（WebView / 被策略限制的浏览器）register() 会**兑现成 undefined**，
      //    此时后面 reg.update()/addEventListener 全会抛未捕获异常，且更新检查静默失效
      //    → 页面就永久停在旧 bundle（用户报过「改了代码但看不到」，2026-09-16）。
      if (!reg || typeof reg.update !== "function") {
        console.warn("[sw] 注册未返回可用 registration，跳过版本检查：", why)
        return
      }
      // 检查更新：失败只告警不抛错（旧写法把错误吞在空 catch 里，出问题时完全查不出）。
      updateChecker = () => {
        reg.update().catch((e) => console.warn("[sw] 检查更新失败", e))
      }
      // SPA 内无整页导航，浏览器不会频繁检查 SW 更新 → 主动轮询，
      // 保证部署后即使一直停留在页面也能在 30s 内发现新版本并自动刷新。
      setInterval(() => updateChecker?.(), 30_000)

      // 新 SW 下载并安装完成 → 如果已有旧 SW 在控制页面（非首次安装），
      // 主动发 SKIP_WAITING 消息让新 SW 立即跳过 waiting 激活。
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener("statechange", () => {
          // installed 且有 controller → 是更新而非首次安装 → 让新 SW 接管
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            nw.postMessage({ type: "SKIP_WAITING" })
          }
        })
        // 新 SW 下载失败（弱网/代理中断）→ 装不上就不会有 controllerchange，
        //   页面会一直停在旧版本；打个警告便于排查。
        nw.addEventListener("error", () => console.warn("[sw] 新版本下载失败，仍在旧版本上运行"))
      })
    } catch (e) {
      console.warn("[sw] 注册失败（本次不做自动更新检查，回到前台会重试）", e)
    }
  }

  // ★ 手机浏览器会**冻结后台标签页的定时器**（iOS/Android 都如此）：用户切后台再回来时，
  //   30s 轮询可能整段时间都没跑过 → 旧 app shell 一直由 SW 从自己的 precache 端上来。
  //   回到前台 / 重新联网 / 窗口重新聚焦时各补一次检查；**若此前注册就没成功，这里会重新注册**。
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ensureRegistered("visible")
  })
  window.addEventListener("focus", () => void ensureRegistered("focus"))
  window.addEventListener("online", () => void ensureRegistered("online"))

  window.addEventListener("load", () => void ensureRegistered("load"))

  // 新 SW 安装完成并接管页面 → 自动刷新一次，让新 bundle 生效。
  // ⚠️ 但必须**等网络静默**再刷：整页 reload 会销毁当前 JS 上下文，把在飞请求连同它们的
  //    超时/重试定时器一起带走（没有任何"reload 后补做"的机会）。
  //    实测（2026-09-20）：`reg.update()` 在页面打开约 30s 时触发的一次 controllerchange
  //    掐掉了已发出 23s 的 /health 预热请求 ⇒ 本该在用户打字期间被吃掉的冷启动，
  //    被推迟到用户点下「登录」那一刻才付出（实测点击→响应 70.8s）。
  let refreshing = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return
    refreshing = true
    console.warn("[sw] 新版本已接管，等网络静默后刷新")
    void whenNetIdle().then(() => location.reload())
  })
}
