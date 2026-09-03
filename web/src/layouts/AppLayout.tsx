/** 三端应用外壳 — 移动端顶部返回主页 + 右上角退出（去掉底部/侧边导航） */

import { Outlet, useNavigate, useLocation } from "react-router-dom"
import { useResponsive } from "./useResponsive"
import { useAuthStore } from "../stores/authStore"

export function AppLayout() {
  const mode = useResponsive()
  const nickname = useAuthStore((s) => s.session?.user.nickname ?? "")
  const username = useAuthStore((s) => s.session?.user.username ?? "")
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const location = useLocation()

  const initial = (nickname || username || "?").charAt(0)
  const onHome = location.pathname === "/home"

  const handleLogout = () => {
    logout()
    navigate("/login", { replace: true })
  }

  // 右侧操作组：返回主页（非首页时显示）+ 退出（带"退出"文字）
  const topActions = (
    <div className="app-top-actions">
      {!onHome && (
        <button className="app-home-btn" onClick={() => navigate("/home")}>🏠 主页</button>
      )}
      <button className="app-logout-btn" onClick={handleLogout}>🚪 退出</button>
    </div>
  )

  if (mode === "mobile") {
    return (
      <div className="app-shell mobile">
        <main className="app-main">
          <header className="app-topbar">
            <span className="app-avatar" title={nickname || username || ""}>{initial}</span>
            <span className="app-greeting">
              {nickname || username || "同学"}
            </span>
            {topActions}
          </header>
          <Outlet />
        </main>
      </div>
    )
  }

  // tablet / desktop
  return (
    <div className={`app-shell ${mode}`}>
      <main className="app-main">
        <header className="app-topbar">
          <span className="app-avatar" title={nickname || username || ""}>{initial}</span>
          <span className="app-greeting">AiPhonix · {nickname || username || "同学"}</span>
          {topActions}
        </header>
        <Outlet />
      </main>
    </div>
  )
}
