// 由 drizzle schema 生成幂等建表 SQL（P1-8 冷启自愈）。
// 用法: npx tsx scripts/gen-init-sql.mts > src/db/init.sql
// 仅生成「不存在即建」的 DDL；已在库中的表/索引不受影响（IF NOT EXISTS）。
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core"
import * as schema from "../src/db/schema.js"

// FTS5 虚拟表：仅需建主表，SQLite 自动生成 _data/_idx/_content/_docsize/_config 影子表。
// 其余 chinese_fts* 影子表不要手动建（会被 FTS5 自己创建，重复建会冲突）。
const FTS_VIRTUAL = new Set(["chinese_fts"])

function sqliteType(col: any): string {
  const t = col.getSQLType ? col.getSQLType() : "NUMERIC"
  if (t.startsWith("text")) return "TEXT"
  if (t === "integer") return "INTEGER"
  if (t === "real") return "REAL"
  if (t === "blob") return "BLOB"
  return "NUMERIC"
}

function tableDDL(name: string, cfg: any): string {
  const pkCols = cfg.columns.filter((c: any) => c.primary)
  const colLines = cfg.columns.map((c: any) => {
    const parts = [`  ${c.name} ${sqliteType(c)}`]
    if (pkCols.length === 1 && c.primary) parts.push("PRIMARY KEY")
    else if (c.notNull && !c.primary) parts.push("NOT NULL")
    return parts.join(" ")
  })
  if (pkCols.length > 1) {
    colLines.push(`  PRIMARY KEY (${pkCols.map((c: any) => c.name).join(", ")})`)
  }
  return `CREATE TABLE IF NOT EXISTS ${name} (\n${colLines.join(",\n")}\n);`
}

const out: string[] = [
  "-- 自动生成 (scripts/gen-init-sql.mts)：由 drizzle schema 派生的幂等建表 DDL。",
  "-- 用途：server_ts 冷启动自愈 —— 全新 app.db 也能建出全部表，避免首启 500。",
  "-- 已存在的表/索引因 IF NOT EXISTS 不受影响。改了 schema 后重跑生成器即可。",
  "",
]

for (const t of Object.values(schema)) {
  if (!(t instanceof SQLiteTable)) continue
  const cfg: any = getTableConfig(t as any)
  const name: string = cfg.name
  if (name.startsWith("chinese_fts")) {
    if (FTS_VIRTUAL.has(name)) {
      out.push(`CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING fts5(content);`)
      out.push("")
    }
    continue
  }
  out.push(tableDDL(name, cfg))
  out.push("")
}

// 关键唯一索引（账号级隔离）。注意：char_practice 的 user_id 隔离索引不放这里——
// 老库 char_practice 曾无 user_id，init.sql 的 CREATE TABLE IF NOT EXISTS 会跳过已存在的旧表，
// 此时建索引会因「无此列」失败；该索引改由 db/index.ts 在 char_practice 迁移之后补建。
out.push("-- 关键唯一索引（账号级隔离）")
out.push("CREATE UNIQUE INDEX IF NOT EXISTS ix_visit_counts_user_route ON visit_counts (user_id, route);")
out.push("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_prefs_user_id ON user_prefs (user_id);")
out.push("")

process.stdout.write(out.join("\n"))
