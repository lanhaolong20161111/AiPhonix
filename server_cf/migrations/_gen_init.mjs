/** 从 _schema_dump.sql 生成 D1 迁移：排除 FTS5 影子表（随 CREATE VIRTUAL TABLE 自动创建） */
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "_schema_dump.sql.txt")
const OUT = join(HERE, "0001_init.sql")

const SHADOW = new Set(["chinese_fts_config", "chinese_fts_content", "chinese_fts_data", "chinese_fts_docsize", "chinese_fts_idx"])

const text = readFileSync(SRC, "utf-8")
const blocks = text.split(/\n\n/) // dump 以 "-- type: name\n<sql>;\n" 为一块
const keep = []
let skipped = 0
for (const b of blocks) {
  const m = b.match(/^-- (table|index): (\S+)/)
  if (!m) continue
  const [, type, name] = m
  if (type === "table" && SHADOW.has(name)) { skipped++; continue }
  keep.push(b.trim())
}

const header = `-- AiPhonix D1 init migration: full replica of app.db schema
-- (29 content tables + FTS5 virtual table + indexes; shadow tables excluded)
-- Source: shared/data/app.db sqlite_master dump (SQLAlchemy legacy + TS additions)
`
writeFileSync(OUT, header + keep.join("\n\n") + "\n", "utf-8")
console.log(`写出 ${OUT}：${keep.length} 个语句块，跳过影子表 ${skipped} 张`)
