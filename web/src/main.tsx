import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"
import "./tailwind.css"
import "./index.css"
import "./App.css"
import { router } from "./routes"

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
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/web/sw.js", { scope: "/web/" })
      .then((reg) => {
        // SPA 内无整页导航，浏览器不会频繁检查 SW 更新 → 主动轮询，
        // 保证部署后即使一直停留在页面也能在 30s 内发现新版本并自动刷新。
        setInterval(() => {
          reg.update().catch(() => {})
        }, 30_000)

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
        })
      })
      .catch(() => {})
  })
  // 新 SW 安装完成并接管页面 → 自动刷新一次，让新 bundle 生效
  let refreshing = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return
    refreshing = true
    location.reload()
  })
}
