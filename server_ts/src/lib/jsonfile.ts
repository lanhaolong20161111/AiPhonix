/** JSON 文件读写工具 — 基于 DATA_DIR 绝对路径，线程安全（同步） */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { DATA_DIR } from "../env.js"

export function dataPath(...segments: string[]): string {
  return join(DATA_DIR, ...segments)
}

/** 按候选顺序返回第一个存在的路径（跨布局找资产：挂载卷 / 本机 dev / 容器镜像内） */
export function findFirstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return null
}

export function readJson<T = unknown>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, "utf-8")) as T
  } catch {
    return fallback
  }
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8")
}

export { existsSync }
