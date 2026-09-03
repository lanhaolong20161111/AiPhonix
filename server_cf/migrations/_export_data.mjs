/** app.db → D1 数据导出：27 内容表 + chinese_fts 行，分块写出 INSERT SQL（_data/） */
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || join(HERE, "..", "..", "shared", "data", "app.db")
const OUT_DIR = join(HERE, "_data")

// better-sqlite3 装在 server_ts（本工程 Workers 版不依赖原生 sqlite），从那里解析
const require2 = createRequire(join(HERE, "..", "..", "server_ts", "package.json"))
const Database = require2("better-sqlite3")

const SHADOW = new Set(["chinese_fts_config", "chinese_fts_content", "chinese_fts_data", "chinese_fts_docsize", "chinese_fts_idx"])

function q(v) {
  if (v === null || v === undefined) return "NULL"
  if (typeof v === "number") return String(v)
  if (v instanceof Uint8Array) {
    return "X'" + Buffer.from(v).toString("hex") + "'"
  }
  return "'" + String(v).replace(/'/g, "''") + "'"
}

const db = new Database(DB_PATH, { readonly: true })
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
).all().map((r) => r.name).filter((n) => !SHADOW.has(n))

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const MAX_BYTES = 1_500_000 // 每 chunk ~1.5MB
let fileIdx = 0
let buf = []
let bufBytes = 0
const report = []

function flush() {
  if (!buf.length) return
  fileIdx++
  const f = join(OUT_DIR, `data_${String(fileIdx).padStart(3, "0")}.sql`)
  writeFileSync(f, buf.join("\n") + "\n", "utf-8")
  buf = []
  bufBytes = 0
}

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all()
  const colNames = cols.map((c) => c.name)
  const colList = colNames.map((c) => JSON.stringify(c)).join(",")
  const rows = db.prepare(`SELECT * FROM ${JSON.stringify(t)}`).all()
  report.push(`${t}: ${rows.length} 行`)
  for (const row of rows) {
    const vals = colNames.map((c) => q(row[c])).join(",")
    const stmt = `INSERT INTO ${JSON.stringify(t)} (${colList}) VALUES (${vals});`
    buf.push(stmt)
    bufBytes += stmt.length
    if (bufBytes >= MAX_BYTES) flush()
  }
}
flush()

writeFileSync(join(OUT_DIR, "_report.txt"), report.join("\n"), "utf-8")
console.log(report.join("\n"))
console.log(`\n共 ${fileIdx} 个数据文件 → ${OUT_DIR}`)
db.close()
