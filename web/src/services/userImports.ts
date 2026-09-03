/** 用户导入数据 API 客户端 — 对应 server_py/routes/user_imports.py + import_templates.py */

import { api } from "./api"

export interface UserImportItem {
  id: number
  kind: string // word / char / article / sentence / quiz / answer / problem
  text: string
  pinyin: string
  meaning: string
  tags: string[]
  payload: string
  status: string
  created_at: string
}

export interface ImportTemplate {
  id: string
  name: string
  description: string
  kind: string
  prompt?: string
}

export async function fetchImports(kind?: string): Promise<UserImportItem[]> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : ""
  const res = await api<{ status: string; items: UserImportItem[] }>(`/user-imports${q}`)
  return res.items ?? []
}

export async function deleteImport(id: number): Promise<void> {
  await api(`/user-imports/${id}`, { method: "DELETE" })
}

/** 创建一个 article 类型的导入（范文），payload 存结构化数据（如识别 blocks JSON 字符串） */
export async function createArticleImport(text: string, payload: string): Promise<void> {
  await api("/user-imports/batch", {
    method: "POST",
    body: {
      items: [{ kind: "article", text: text.trim(), payload, tags: ["范文"], status: "active" }],
    },
  })
}

export async function fetchImportTemplates(): Promise<ImportTemplate[]> {
  const res = await api<{ status: string; templates: ImportTemplate[] }>("/import-templates", { auth: false })
  return res.templates ?? []
}

/** 按 kind 的展示名称 */
export const KIND_NAMES: Record<string, string> = {
  word: "词汇",
  char: "汉字",
  article: "文章",
  sentence: "句子",
  quiz: "题目",
  answer: "回答",
  problem: "数学题",
}
