/** 从 app.db 导出真实建表语句（SQLAlchemy 遗留 + TS 新增），供生成 D1 migrations */
import Database from "better-sqlite3"
import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || join(HERE, "..", "shared", "data", "app.db")
const OUT = process.argv[2] || join(HERE, "server_cf", "migrations", "_schema_dump.sql")

const db = new Database(DB_PATH, { readonly: true })
const rows = db.prepare(
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name"
).all()

const out = []
for (const r of rows) {
  out.push(`-- ${r.type}: ${r.name}${r.tbl_name && r.tbl_name !== r.name ? ` (on ${r.tbl_name})` : ""}`)
  out.push(r.sql + ";")
  out.push("")
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, out.join("\n"), "utf-8")
const tables = rows.filter((r) => r.type === "table").map((r) => r.name)
console.log(`表数量: ${tables.length}`)
console.log(tables.join(", "))
console.log(`已写出: ${OUT}`)
db.close()
