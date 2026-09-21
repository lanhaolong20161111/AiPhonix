/**
 * D1 绑定 → better-sqlite3。
 *
 * 目的：让 server_cf 的 db/index.ts（`getEnv().DB` 与 drizzle-orm/d1）零改动跑在 Node 上。
 * D1 是「异步 + 返回 {results,meta}」的接口，这里把它翻译到 better-sqlite3 的同步 API，
 * 并用 Promise 包装，使调用方感知不到差别。
 *
 * 覆盖：prepare / bind / first / all / run / raw / batch / exec（server_cf 全量用到的面）。
 *
 * ⚠️ 值语义对齐（这几点做错会静默写坏数据）：
 *   - 绑定：undefined→null；boolean→0/1（better-sqlite3 直接拒绝 boolean）；Date→ISO 字符串；
 *           Uint8Array/ArrayBuffer→Buffer。
 *   - 读出：Buffer(BLOB)→ArrayBuffer（D1 的行为），其余原样。
 *   - `first()` 无参取整行；带列名取该列值。
 *   - `run()` 的 meta.changes 取 better-sqlite3 的 `changes`，last_row_id 取 `lastInsertRowid`。
 *
 * ⚠️ FTS5：better-sqlite3 自带 SQLite 编译含 FTS5，故 `chinese_fts*` 系列表可用
 *    （wrangler d1 export 正是因为虚拟表无法导出，才改为逐表导出 + init.sql 补建）。
 */
import Database from "better-sqlite3"

type BindValue = null | number | bigint | string | boolean | Date | ArrayBuffer | ArrayBufferView | undefined

export interface D1Meta {
  duration: number
  size_after: number
  rows_read: number
  rows_written: number
  last_row_id: number
  changed_db: boolean
  changes: number
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[]
  success: boolean
  meta: D1Meta
}

function toBindable(v: BindValue): unknown {
  if (v === undefined || v === null) return null
  const t = typeof v
  if (t === "boolean") return (v as boolean) ? 1 : 0
  if (t === "bigint") return v as bigint
  if (t === "number" || t === "string") return v as number | string
  if (v instanceof Date) return (v as Date).toISOString()
  if (v instanceof ArrayBuffer) return Buffer.from(v as ArrayBuffer)
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength)
  }
  return String(v)
}

/** Buffer → ArrayBuffer（只拷贝有效区间；better-sqlite3 的 Buffer 常是共享 slab 的视图） */
function bufferToArrayBuffer(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/**
 * 读出值归一化：better-sqlite3 的 BLOB 是 Buffer（Uint8Array 子类）→ D1 语义的 ArrayBuffer。
 * ⚠️ 刻意不用 `Buffer.isBuffer()`：`@cloudflare/workers-types` 与 `@types/node` 同时声明了
 *    `Buffer`，其签名互相干扰（isBuffer 不是类型谓词），`instanceof` 更稳。
 */
function normalizeValue(v: unknown): unknown {
  return v instanceof Uint8Array ? bufferToArrayBuffer(v) : v
}

/** 整行归一化 */
function fromRow<T>(row: T): T {
  if (row === null || typeof row !== "object") return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    out[k] = normalizeValue(v)
  }
  return out as T
}

export class D1Shim {
  #db: Database.Database
  readonly stats = { queries: 0, batches: 0 }

  constructor(filename: string, opts?: Database.Options) {
    this.#db = new Database(filename, opts)
    // WAL 单写者场景更快；外键约束与 D1 默认一致（D1 默认开启外键）
    this.#db.pragma("journal_mode = WAL")
    this.#db.pragma("foreign_keys = ON")
    this.#db.pragma("busy_timeout = 5000")
  }

  /** 供 /health 之外的运维探查使用（真 D1 无此方法） */
  pragma(sql: string): unknown {
    return this.#db.pragma(sql)
  }

  close(): void {
    try {
      this.#db.close()
    } catch {
      /* 已关闭 */
    }
  }

  prepare(sql: string): D1PreparedStatementShim {
    return new D1PreparedStatementShim(this.#db, sql)
  }

  async batch(stmts: D1PreparedStatementShim[]): Promise<D1Result[]> {
    this.stats.batches++
    const run = this.#db.transaction((list: D1PreparedStatementShim[]) =>
      list.map((s) => s._runSync()),
    )
    return run(stmts)
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const t0 = Date.now()
    this.#db.exec(sql)
    return { count: 1, duration: Date.now() - t0 }
  }

  async dump(): Promise<ArrayBuffer> {
    const buf = this.#db.serialize()
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
}

export class D1PreparedStatementShim {
  #db: Database.Database
  #sql: string
  #params: unknown[] = []

  constructor(db: Database.Database, sql: string) {
    this.#db = db
    this.#sql = sql
  }

  bind(...values: BindValue[]): D1PreparedStatementShim {
    this.#params = values.map(toBindable)
    return this
  }

  #meta(t0: number, changes: number, lastRowId: number): D1Meta {
    // rows_read / rows_written 是 D1 的计费口径；这里给近似值（仅日志用途）
    return {
      duration: Date.now() - t0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes > 0 ? changes : 0,
      last_row_id: lastRowId,
      changed_db: changes > 0,
      changes,
    }
  }

  #stmt(): Database.Statement {
    return this.#db.prepare(this.#sql)
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const t0 = Date.now()
    const row = this.#stmt().get(...this.#params) as Record<string, unknown> | undefined
    void t0
    if (row === undefined) return null
    const converted = fromRow(row)
    if (colName) return (converted as Record<string, unknown>)[colName] as T ?? null
    return converted as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const t0 = Date.now()
    const rows = this.#stmt().all(...this.#params) as Record<string, unknown>[]
    return {
      results: rows.map((r) => fromRow(r) as T),
      success: true,
      meta: this.#meta(t0, 0, 0),
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const t0 = Date.now()
    const info = this.#stmt().run(...this.#params)
    const changes = info.changes
    const lastRowId = Number(info.lastInsertRowid)
    return {
      results: [] as T[],
      success: true,
      meta: this.#meta(t0, changes, lastRowId),
    }
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const stmt = this.#stmt()
    stmt.raw(true)
    const rows = stmt.all(...this.#params) as unknown[][]
    const out = rows.map((r) => r.map((v) => normalizeValue(v)))
    if (options?.columnNames) {
      return [stmt.columns().map((c) => c.name), ...out] as unknown as T[]
    }
    return out as unknown as T[]
  }

  /** 内部：事务内同步执行（batch 用） */
  _runSync(): D1Result {
    const t0 = Date.now()
    const isSelect = /^\s*(select|with|pragma)/i.test(this.#sql)
    if (isSelect) {
      const rows = this.#stmt().all(...this.#params) as Record<string, unknown>[]
      return { results: rows.map((r) => fromRow(r)), success: true, meta: this.#meta(t0, 0, 0) }
    }
    const info = this.#stmt().run(...this.#params)
    return { results: [], success: true, meta: this.#meta(t0, info.changes, Number(info.lastInsertRowid)) }
  }
}
