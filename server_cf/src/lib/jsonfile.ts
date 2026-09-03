/**
 * JSON 文件读写 — Cloudflare 版：基于 R2（async，替代 node:fs 同步读写）。
 * 与原 jsonfile.ts 不同的是 readJson/writeJson 变为 async，调用点需加 await。
 */
import { readText, writeText, exists } from "./storage.js"

export function dataPath(...segments: string[]): string {
  return ["data", ...segments].join("/")
}

export async function readJson<T = unknown>(path: string, fallback: T): Promise<T> {
  try {
    if (!(await exists(path))) return fallback
    const text = await readText(path)
    return text != null && text !== "" ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, JSON.stringify(data, null, 2))
}
