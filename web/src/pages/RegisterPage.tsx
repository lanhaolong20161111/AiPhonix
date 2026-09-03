/** 注册页 */

import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "../stores/authStore"
import { detailFromError } from "../services/auth"

const GRADES = ["幼儿园", "一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三"]

export function RegisterPage() {
  const navigate = useNavigate()
  const register = useAuthStore((s) => s.register)
  const [username, setUsername] = useState("")
  const [nickname, setNickname] = useState("")
  const [password, setPassword] = useState("")
  const [grade, setGrade] = useState("")
  const [age, setAge] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError("")
    try {
      await register(username.trim(), password, nickname.trim() || username.trim(), grade, age)
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
        <h1>注册账号</h1>
        <p className="auth-sub">创建学习账号</p>

        <label className="auth-field">
          <span>用户名</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用于登录" required />
        </label>

        <label className="auth-field">
          <span>昵称</span>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="显示名称（可不填）" />
        </label>

        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="设置密码"
            required
          />
        </label>

        <label className="auth-field">
          <span>年级</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">选择年级</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>

        <label className="auth-field">
          <span>年龄</span>
          <input
            type="number"
            min={3}
            max={18}
            value={age}
            onChange={(e) => setAge(Number(e.target.value) || 7)}
          />
        </label>

        {error && <p className="err">{error}</p>}

        <button className="auth-submit" disabled={busy || !username.trim() || !password}>
          {busy ? "注册中…" : "注册并登录"}
        </button>

        <p className="auth-switch">
          已有账号？{" "}
          <a href="#/login" onClick={(e) => { e.preventDefault(); navigate("/login") }}>
            去登录
          </a>
        </p>
      </form>
    </div>
  )
}
