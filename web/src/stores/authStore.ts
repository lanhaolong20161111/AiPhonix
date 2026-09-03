/** Zustand Auth Store — 登录态 / JWT / 用户信息，localStorage 持久化 */

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { login as apiLogin, register as apiRegister, refresh as apiRefresh, fetchMe } from "../services/auth"

export interface AuthUser {
  user_id: number
  username: string
  nickname: string
  role: string
  grade: string
  age: number
}

export interface AuthSession {
  access_token: string
  refresh_token: string
  user: AuthUser
}

interface AuthState {
  session: AuthSession | null
  setSession: (s: AuthSession) => void
  /** 调用服务端登录，成功后写入 session */
  login: (username: string, password: string) => Promise<void>
  /** 调用服务端注册，成功后写入 session */
  register: (username: string, password: string, nickname: string, grade: string, age: number) => Promise<void>
  /** 刷新 token（供 api.ts 401 时调用） */
  refreshTokens: () => Promise<AuthSession | null>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,

      setSession: (s) => set({ session: s }),

      login: async (username, password) => {
        const res = await apiLogin(username, password)
        const me = await fetchMe(res.access_token)
        set({
          session: {
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            user: {
              user_id: res.user_id,
              username: me.username,
              nickname: me.nickname,
              role: me.role,
              grade: me.grade,
              age: me.age,
            },
          },
        })
      },

      register: async (username, password, nickname, grade, age) => {
        const res = await apiRegister(username, password, nickname, grade, age)
        const me = await fetchMe(res.access_token)
        set({
          session: {
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            user: {
              user_id: res.user_id,
              username: me.username,
              nickname: me.nickname,
              role: me.role,
              grade: me.grade,
              age: me.age,
            },
          },
        })
      },

      refreshTokens: async () => {
        const cur = get().session
        if (!cur?.refresh_token) return null
        try {
          const res = await apiRefresh(cur.refresh_token)
          const next: AuthSession = {
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            user: cur.user,
          }
          set({ session: next })
          return next
        } catch {
          set({ session: null })
          return null
        }
      },

      logout: () => set({ session: null }),
    }),
    { name: "ai_phonix_web_auth" },
  ),
)

/** 便捷选择器：当前 access token（可能为空串） */
export const selectAccessToken = (s: AuthState): string => s.session?.access_token ?? ""
