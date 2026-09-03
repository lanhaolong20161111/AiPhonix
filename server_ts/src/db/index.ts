/** 数据库连接 — better-sqlite3 + drizzle（复用现有 app.db，绝对路径铁律） */
import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as schema from "./schema.js"

const HERE = dirname(fileURLToPath(import.meta.url))
// server_ts/src/db/index.ts 的上级的上级的上级 = server_py
const ROOT_DIR = join(HERE, "../../..")
const DB_PATH = process.env.DATABASE_PATH || join(ROOT_DIR, "shared", "data", "app.db")

export const sqlite = new Database(DB_PATH)
sqlite.pragma("journal_mode = WAL")

// 表结构历史上由 PY(SQLAlchemy create_all)负责；PY 已退役后，TS 侧新增的表
// 必须自建（幂等），否则首启无表即崩。现统一由 scripts/gen-init-sql.mts 从
// drizzle schema 生成 src/db/init.sql（全部 CREATE TABLE IF NOT EXISTS +
// FTS5 虚拟表 + 关键唯一索引），保证全新 app.db 也能冷启自愈。
const initSql = readFileSync(new URL("./init.sql", import.meta.url), "utf8")
sqlite.exec(initSql)

// 老库升级：2026-08 前 char_practice 无 user_id（全账号共享），且存有早期无归属测试数据
// （passed=0，无账号归属）。改为按账号隔离需重建表：(user_id, char) 唯一。旧数据无归属，
// 直接丢弃（与生产 D1 迁移 0011 对齐），后续记录按当前登录账号重新积累。
try {
  const cols = sqlite.prepare("PRAGMA table_info(char_practice)").all() as { name: string }[]
  if (!cols.some((c) => c.name === "user_id")) {
    sqlite.exec(`
      DROP INDEX IF EXISTS ix_char_practice_char;
      ALTER TABLE char_practice RENAME TO char_practice_legacy;
      CREATE TABLE char_practice (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        char TEXT NOT NULL,
        pinyin_correct INTEGER NOT NULL DEFAULT 0,
        pinyin_wrong INTEGER NOT NULL DEFAULT 0,
        pronunciation_correct INTEGER NOT NULL DEFAULT 0,
        pronunciation_wrong INTEGER NOT NULL DEFAULT 0,
        consecutive_correct INTEGER NOT NULL DEFAULT 0,
        last_seen REAL,
        last_correct INTEGER NOT NULL DEFAULT 0,
        passed INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX ix_char_practice_user_char ON char_practice (user_id, char);
      CREATE INDEX ix_char_practice_user ON char_practice (user_id);
      DROP TABLE char_practice_legacy;
    `)
    console.log("[db] char_practice 已重建为按账号隔离 (user_id, char)；旧无归属数据已清空")
  }
} catch (e) {
  console.warn(`[db] char_practice 迁移失败(不阻塞启动): ${(e as Error).message}`)
}

// char_practice 账号隔离唯一索引：老库经上面迁移已建；全新库由 init.sql 建表（无索引），
// 此处用 IF NOT EXISTS 补建，保证两种情况下账号级唯一约束都存在（不阻塞启动）。
try {
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ix_char_practice_user_char ON char_practice (user_id, char);
    CREATE INDEX IF NOT EXISTS ix_char_practice_user ON char_practice (user_id);
  `)
} catch (e) {
  console.warn(`[db] char_practice 索引补建失败(不阻塞启动): ${(e as Error).message}`)
}

export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema })

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
