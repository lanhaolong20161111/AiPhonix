/** AI 识别历史存储 — localStorage 按模块（语文/数学）保存识别会话，供「历史会话」回看 */

import type { TextBlock } from "../services/aiImage"
import type { PosTagItem, StoryElementItem } from "../services/aichinese"

export type AiModule = "chinese" | "math" | "english"

/** 一条 AI 问答记录 */
export interface QaItem {
  q: string
  a: string
}

/** 多轮对话的一轮（纯文本提问） */
export interface ChatTurn {
  role: "user" | "assistant"
  content: string
  /** 工具结果：可朗读文本（assistant 消息附带） */
  speak?: string
  /** 工具结果：查词词条信息（assistant 消息附带） */
  word?: string
  /** 提问纠错（user 消息附带）：corrected=修正后完整句，wrongs=原句错误片段（气泡内高亮） */
  correction?: { corrected: string; wrongs: string[] }
  /** 小老师游戏判分（assistant 消息附带）：1=纠正正确 0=未纠正 */
  judge?: number
}

export interface AiHistoryItem {
  id: string
  module: AiModule
  text: string
  questions: string[]
  blocks: TextBlock[]
  pageBounds: { left: number; top: number; right: number; bottom: number } | null
  /** 原图缩略图（data URL，可能为空） */
  thumb: string
  createdAt: number
  /** 该次会话各块/题的 AI 问答（key：block-N / q-N / text） */
  qa?: Record<string, QaItem[]>
  /** 纯文本多轮对话记录（若有） */
  turns?: ChatTurn[]
  /** 后端对话会话 id（会话型条目；有此字段=可恢复续聊的对话线程） */
  sessionId?: string
  /** 词性标注：语文按块下标、英语按题下标 → 该段词性（与结果页 posMap 对齐） */
  pos?: Record<number, PosTagItem[]>
  /** 文章要素标注：同上按块/题下标 → 该段要素 */
  story?: Record<number, StoryElementItem[]>
}

const KEY = "ai_phonix_web_ai_history"
const MAX_PER_MODULE = 50

interface HistoryMap {
  chinese: AiHistoryItem[]
  math: AiHistoryItem[]
  english: AiHistoryItem[]
}

function loadAll(): HistoryMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { chinese: [], math: [], english: [] }
    const d = JSON.parse(raw) ?? {}
    return {
      chinese: Array.isArray(d.chinese) ? (d.chinese as AiHistoryItem[]) : [],
      math: Array.isArray(d.math) ? (d.math as AiHistoryItem[]) : [],
      english: Array.isArray(d.english) ? (d.english as AiHistoryItem[]) : [],
    }
  } catch {
    return { chinese: [], math: [], english: [] }
  }
}

function saveAll(all: HistoryMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* localStorage 满/不可用时静默失败 */
  }
}

/** 读取某模块的历史（新的在前） */
export function loadHistory(module: AiModule): AiHistoryItem[] {
  return loadAll()[module]
}

/** 新增一条历史（返回带 id/createdAt 的完整条目） */
export function addHistory(item: Omit<AiHistoryItem, "id" | "createdAt">): AiHistoryItem {
  const all = loadAll()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const entry: AiHistoryItem = { ...item, id, createdAt: Date.now() }
  all[item.module] = [entry, ...all[item.module]].slice(0, MAX_PER_MODULE)
  saveAll(all)
  return entry
}

/** 删除一条历史 */
export function removeHistory(module: AiModule, id: string): void {
  const all = loadAll()
  all[module] = all[module].filter((it) => it.id !== id)
  saveAll(all)
}

/** 更新一条历史（局部合并，如追加对话轮次）；找不到则忽略 */
export function updateHistory(module: AiModule, id: string, patch: Partial<AiHistoryItem>): void {
  const all = loadAll()
  const idx = all[module].findIndex((it) => it.id === id)
  if (idx < 0) return
  all[module][idx] = { ...all[module][idx], ...patch }
  saveAll(all)
}

/** 删除某模块中的多条 id（从对话页开始新会话时，避免重复条目越积越多） */
export function removeHistoryByModuleExcept(module: AiModule, keepId: string): void {
  const all = loadAll()
  all[module] = all[module].filter((it) => it.id === keepId)
  saveAll(all)
}

/** 从图片 URL（objectURL / data URL）生成缩略图 data URL（canvas 压缩，最长边 maxSize） */
export function makeThumb(url: string, maxSize = 260): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const c = document.createElement("canvas")
        c.width = w
        c.height = h
        const ctx = c.getContext("2d")
        if (!ctx) {
          resolve("")
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL("image/jpeg", 0.6))
      } catch {
        resolve("")
      }
    }
    img.onerror = () => resolve("")
    img.src = url
  })
}
