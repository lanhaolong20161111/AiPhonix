#!/usr/bin/env node
/**
 * 灌库脚本：把 R2 JSON（char_image_index / char_image_feedback / wordbank）种子进 D1。
 * 用法：node scripts/seed_d1_from_json.mjs [--remote] <index.json> <feedback.json> <wordbank.json>
 * 步骤：读 JSON → 生成批量 INSERT OR REPLACE SQL（临时文件，UTF-8）→ wrangler d1 execute（默认 --remote）。
 * 幂等：INSERT OR REPLACE，可重复执行。
 * 说明：PS 5.1 拼中文 SQL 会乱码，所以用 Node 生成 SQL 文件，规避编码坑。
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const args = process.argv.slice(2)
const isRemote = args.includes("--remote")
const envIdx = args.indexOf("--env")
const isStaging = envIdx >= 0 && args[envIdx + 1] === "staging"
const files = args.filter((a) => !a.startsWith("--") && a !== "staging")
if (files.length !== 3) {
  console.error("usage: node scripts/seed_d1_from_json.mjs [--remote] [--env staging] <index.json> <feedback.json> <wordbank.json>")
  process.exit(2)
}
const [indexJson, feedbackJson, wordbankJson] = files

const read = (p) => JSON.parse(readFileSync(p, "utf-8"))
const esc = (s) => String(s == null ? "" : s).replace(/'/g, "''")
const json = (v) => esc(JSON.stringify(v))

const stmts = []

// ── char_image_index ─────────────────────────────────────────────
const indexData = read(indexJson)
const indexItems = Array.isArray(indexData) ? indexData : indexData?.items ?? []
if (!Array.isArray(indexItems)) { console.error("index.json: 无法识别 items 结构"); process.exit(1) }
console.log(`char_image_index: ${indexItems.length} rows (id = 原数组序，保留认/写重字变体)`)
for (let i = 0; i < indexItems.length; i += 2) {
  const batch = indexItems.slice(i, i + 2)
  const base = i
  const vals = batch.map((it, j) => {
    const { char, grade, semester, type, image, pinyin, ...rest } = it
    return `(${base + j + 1},'${esc(char)}','${esc(grade ?? "")}','${esc(semester ?? "")}','${esc(type ?? "")}','${esc(image ?? "")}','${esc(pinyin ?? "")}','${json(rest)}')`
  })
  stmts.push(`INSERT OR REPLACE INTO char_image_index (id, char, grade, semester, type, image, pinyin, extra) VALUES ${vals.join(",")};`)
}

// ── char_image_feedback ──────────────────────────────────────────
const fbData = read(feedbackJson)
const fbs = Array.isArray(fbData) ? fbData : []
console.log(`char_image_feedback: ${fbs.length} rows`)
for (let i = 0; i < fbs.length; i += 2) {
  const batch = fbs.slice(i, i + 2)
  const vals = batch.map((x) => {
    const { user_id, char, grade, semester, type, learning_status, needs_regen, timestamp, ...rest } = x
    const ls = learning_status == null ? "NULL" : `'${esc(learning_status)}'`
    return `(${Number(user_id ?? 0)},'${esc(char)}','${esc(grade ?? "")}','${esc(semester ?? "")}','${esc(type ?? "")}',${ls},${needs_regen ? 1 : 0},'${esc(timestamp ?? "")}','${json(rest)}')`
  })
  stmts.push(`INSERT OR REPLACE INTO char_image_feedback (user_id, char, grade, semester, type, learning_status, needs_regen, timestamp, extra) VALUES ${vals.join(",")};`)
}

// ── wordbank ─────────────────────────────────────────────────────
const wb = read(wordbankJson)
const rows = []
for (const kind of ["chars", "words"]) {
  for (const it of wb?.[kind] ?? []) rows.push([kind, it])
}
console.log(`wordbank_item: ${rows.length} rows (chars=${wb?.chars?.length ?? 0}, words=${wb?.words?.length ?? 0})`)
for (let i = 0; i < rows.length; i += 2) {
  const batch = rows.slice(i, i + 2)
  const vals = batch.map(([kind, it]) => `('${esc(it.text)}','${esc(kind)}','${json(it)}')`)
  stmts.push(`INSERT OR REPLACE INTO wordbank_item (text, kind, json) VALUES ${vals.join(",")};`)
}

// ── 执行 ─────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "aiphonix-seed-"))
const sqlFile = join(dir, "seed.sql")
writeFileSync(sqlFile, stmts.join("\n"), "utf-8")
console.log(`SQL: ${stmts.length} statements -> ${sqlFile} (${stmts.join("\n").length} bytes)`)

const target = isRemote ? "--remote" : "--local"
const root = fileURLToPath(new URL("..", import.meta.url))
const dbName = isStaging ? "aiphonix-db-staging" : "aiphonix-db"
const wranglerArgs = ["d1", "execute", dbName, target]
if (isStaging) wranglerArgs.push("--env", "staging")
wranglerArgs.push("--file", sqlFile)
try {
  // 直接跑 node wrangler.js（Windows 下 execFileSync 无法执行 .cmd）；stdio inherit 透传输出
  execFileSync(process.execPath, [join(root, "node_modules", "wrangler", "bin", "wrangler.js"), ...wranglerArgs], {
    stdio: "inherit",
    cwd: root,
  })
  console.log("SEED OK")
} catch (e) {
  console.error("SEED FAILED:", e.message)
  process.exit(1)
} finally {
  try { unlinkSync(sqlFile) } catch { /* 忽略 */ }
  try { unlinkSync(dir) } catch { /* 忽略 */ }
}