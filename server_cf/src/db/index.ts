/**
 * 数据库连接 — Cloudflare 版：D1 + drizzle（替代 better-sqlite3）。
 * D1 为异步 API，故提供 getDb() 函数式访问；表结构定义（schema.ts）与 server_ts 完全复用。
 */
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "./schema.js"
import { getEnv } from "../env.js"

export function getDb(): DrizzleD1Database<typeof schema> {
  return drizzle(getEnv().DB, { schema })
}

// ── 原始 SQL 辅助（替代原 sqlite.prepare(...).get/all/run） ─────────
export async function sqlFirst<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T | null> {
  return getEnv().DB.prepare(query).bind(...(params as [])).first<T>()
}

export async function sqlRun(query: string, ...params: unknown[]): Promise<D1Result> {
  return getEnv().DB.prepare(query).bind(...(params as [])).run()
}

export async function sqlAll<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]> {
  const r = await getEnv().DB.prepare(query).bind(...(params as [])).all<T>()
  return r.results ?? []
}

/** 通用 JSON 解析工具（tags / payload 等存 JSON 字符串的列） */
export function parseJsonArray<T = string>(s: string | null | undefined): T[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
