/** 登录页 */

import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "../stores/authStore"
import { detailFromError } from "../services/auth"

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError("")
    try {
      await login(username.trim(), password)
      navigate("/home", { replace: true })
    } catch (err) {
      setError(detailFromError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-logo">🧑‍🎓</div>
        <h1>AiPhonix</h1>
        <p className="auth-sub">登录开始学习</p>

        <label className="auth-field">
          <span>用户名</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="请输入用户名"
            required
          />
        </label>

        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="请输入密码"
            required
          />
        </label>

        {error && <p className="err">{error}</p>}

        <button className="auth-submit" disabled={busy || !username.trim() || !password}>
          {busy ? "登录中…" : "登录"}
        </button>

        <p className="auth-switch">
          还没有账号？{" "}
          <a href="#/register" onClick={(e) => { e.preventDefault(); navigate("/register") }}>
            去注册
          </a>
        </p>
      </form>
    </div>
  )
}
