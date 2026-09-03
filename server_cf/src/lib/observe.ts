/**
 * 可观测性（🟡8）：请求/错误日志。
 * - console 结构化 JSON 行（Worker 日志面板 / wrangler tail 可见、可 grep）
 * - 同时 best-effort 落 D1 request_logs（供 /api/v1/ops 查询），失败不影响业务
 * - 7 天保留：写入时 2% 概率执行清理，防止表无限增长
 * 注意：不记录 queryString / header / user 信息（隐私最小化）。
 */
import { getEnv } from "../env.js"

export interface LogEntry {
  method: string
  path: string
  status: number
  durationMs: number
  level: "info" | "warn" | "error"
  message?: string
  meta?: string
}

const RETENTION_DAYS = 7

/** 异步落库（fire-and-forget，由调用方 ctx.waitUntil 兜底） */
export async function recordLog(entry: LogEntry): Promise<void> {
  // 结构化 console 行（level 决定输出通道，tail/面板里 error 高亮）
  const line = JSON.stringify({ ts: new Date().toISOString(), log: "req", ...entry })
  if (entry.level === "error") console.error(line)
  else console.log(line)

  // D1 落库（best-effort）
  try {
    const db = getEnv().DB
    await db
      .prepare(
        "INSERT INTO request_logs (ts, method, path, status, duration_ms, level, message, meta) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
      )
      .bind(
        new Date().toISOString(),
        entry.method,
        entry.path.slice(0, 512),
        entry.status,
        entry.durationMs,
        entry.level,
        entry.message ?? "",
        entry.meta ?? "{}"
      )
      .run()
    // 概率清理：substr(ts,1,10) = YYYY-MM-DD（ISO 前缀，与 ISO 存储一致）
    if (Math.random() < 0.02) {
      await db
        .prepare("DELETE FROM request_logs WHERE substr(ts,1,10) < date('now', ?1)")
        .bind(`-${RETENTION_DAYS} days`)
        .run()
    }
  } catch {
    /* 可观测性写入失败不阻断请求 */
  }
}

/** 错误栈序列化为 meta（限长，防日志表膨胀） */
export function errMeta(err: unknown): string {
  const e = err as Error
  return JSON.stringify({ name: e?.name ?? "", stack: (e?.stack ?? "").slice(0, 2000) })
}