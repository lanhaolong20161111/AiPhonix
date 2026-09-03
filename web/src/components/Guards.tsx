/** 路由守卫组件 */

import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { useAuthStore } from "../stores/authStore"

/** 登录守卫：无 session 重定向到 /login */
export function RequireAuth({ children }: { children: ReactNode }) {
  const loggedIn = useAuthStore((s) => !!s.session)
  if (!loggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 反向守卫：已登录访问 /login → /home */
export function GuestOnly({ children }: { children: ReactNode }) {
  const loggedIn = useAuthStore((s) => !!s.session)
  if (loggedIn) return <Navigate to="/home" replace />
  return <>{children}</>
}
