/** 识别结果会话 store — 图片识别完成后，从输入页跳转到独立结果页展示（内存态，刷新即清） */

import { create } from "zustand"
import type { TextBlock } from "../services/aiImage"

export interface ParseSession {
  /** 会话 id：问答 scope 前缀，识别/回看时生成（crypto.randomUUID） */
  sessionId: string
  module: "chinese" | "math" | "english"
  text: string
  questions: string[]
  blocks: TextBlock[]
  pageBounds: { left: number; top: number; right: number; bottom: number } | null
  /** 原图预览（objectURL，当前会话有效） */
  previewUrl: string
  /** 原图文件（重新识别 / 旋转用；历史回看时为 null） */
  file: File | Blob | null
  /** 带图提问时的初始问题（由输入框文本带入，结果页识别后自动问答） */
  initialQuestion?: string
  /** 是否为回看历史（点击历史条目进入），回看不应再次自动保存 */
  fromHistory?: boolean
  /** 纯文本多轮对话（回看历史对话时展示；正常识别无此字段） */
  turns?: { role: "user" | "assistant"; content: string }[]
  /** 页面按题目/区域裁剪的小图（Vision bbox 检测），前端附图对照 */
  crops?: { id: number; title: string; image: string; bbox: number[] }[]
}

interface ParseSessionState {
  session: ParseSession | null
  setSession: (s: ParseSession) => void
  clearSession: () => void
  /**
   * 回填异步补到的多音字（2026-09-02）。
   * 服务端为缩短首屏把注音挪到后台，补丁就绪后调这里合并进当前会话的 blocks，
   * 结果页是 zustand 订阅组件 → 自动重渲染，用户无感看到注音出现。
   * @param poly 字→拼音映射
   * @param start/end 仅回填 blocks[start,end)（切块/多框选时每段各补各的）
   */
  patchPolyphones: (poly: Record<string, string>, start?: number, end?: number) => void
}

export const useParseSessionStore = create<ParseSessionState>()((set) => ({
  session: null,
  setSession: (s) => set({ session: s }),
  clearSession: () => set({ session: null }),
  patchPolyphones: (poly, start = 0, end = Number.MAX_SAFE_INTEGER) =>
    set((st) => {
      const s = st.session
      if (!s || !poly || !Object.keys(poly).length || !Array.isArray(s.blocks)) return st
      const blocks = s.blocks.map((b, i) =>
        i >= start && i < end && b && b.type && b.type !== "table"
          ? { ...b, polyphones: { ...(b.polyphones || {}), ...poly } }
          : b,
      )
      return { session: { ...s, blocks } }
    }),
}))

/** 生成一个新的会话 id（问答 scope 前缀） */
export function newSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
