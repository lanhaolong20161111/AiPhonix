/** 应用路由表 — 由 modules/registry 派生，页面级懒加载（首屏只拉当前页代码）
 *
 *  ✱ 新增功能不要在本文件里加路由：去 src/modules/catalog.ts 加一条声明即可，
 *    首页磁贴、打卡目录、裁剪开关都会跟着一起生效。
 */

import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppLayout } from "./layouts/AppLayout"
import { RequireAuth, GuestOnly } from "./components/Guards"
import { AUTH_MODULES, GUEST_MODULES } from "./modules/registry"
import type { SkillModule } from "./modules/types"

const HomePage = lazy(() => import("./modules/home").then((m) => ({ default: m.HomePage })))

/** 懒加载分片加载中的占位（居中轻量提示，避免白屏闪烁） */
function PageFallback() {
  return (
    <div className="page center-card">
      <p className="empty">加载中…</p>
    </div>
  )
}

/** 模块 → 路由元素：懒加载 + 统一 fallback（每个模块只构造一次 lazy 组件） */
function pageOf(m: SkillModule) {
  const Page = lazy(m.load)
  return (
    <Suspense fallback={<PageFallback />}>
      <Page />
    </Suspense>
  )
}

/** 登录守卫下的子路由。react-router 子路由 path 不带前导斜杠 */
const appChildren = [
  { index: true, element: <Navigate to="/home" replace /> },
  { path: "home", element: <HomePage /> },
  ...AUTH_MODULES.map((m) => ({
    path: m.route.replace(/^\//, ""),
    element: pageOf(m),
  })),
]

/** 仅未登录可达的页面（登录 / 注册） */
const guestRoutes = GUEST_MODULES.map((m) => ({
  path: m.route,
  element: <GuestOnly>{pageOf(m)}</GuestOnly>,
}))

export const router = createBrowserRouter(
  [
    ...guestRoutes,
    {
      path: "/",
      element: (
        <RequireAuth>
          {/* Suspense 包住 AppLayout：其 Outlet 渲染的懒加载子页共用此 fallback */}
          <Suspense fallback={<PageFallback />}>
            <AppLayout />
          </Suspense>
        </RequireAuth>
      ),
      children: appChildren,
    },
    { path: "*", element: <Navigate to="/" replace /> },
  ],
  { basename: "/web" },
)
