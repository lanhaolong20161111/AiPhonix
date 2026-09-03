#!/usr/bin/env node
/**
 * 字卡 1536px WebP 中间档上传 R2（配合 scripts/gen_char_thumbs_1536.py 生成）。
 * R2 key：data/char_images_1536/<原文件名>.webp（与旧 .jpg 缩略图并存，路由优先取 webp）
 * 用法：node scripts/gen_char_thumbs_1536.mjs [--limit N]   （上传 .thumbs_1536/ 下所有 webp，幂等可重跑）
 *      node scripts/gen_char_thumbs_1536.mjs --op retry-missing  （探测线上缺失再补传）
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const ROOT = fileURLToPath(new URL("..", import.meta.url)) // server_cf
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js")
const OUT_DIR = join(ROOT, ".thumbs_1536")

function arg(name, dflt = "") {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const limit = arg("--limit") ? Number(arg("--limit")) : 0
const op = arg("--op", "upload")

function runUpload(file, key, contentType = "image/webp") {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [WRANGLER, "r2", "object", "put", `aiphonix-files/${key}`, "--remote", "--file", file, "--content-type", contentType],
      { stdio: "ignore" }
    )
    child.on("exit", (code) => resolve(code ?? 99))
    child.on("error", () => resolve(98))
  })
}

/** HEAD 探测：Worker 缩略图路由返回 image/webp 即 R2 WebP 缩略图已存在 */
async function probeThumb(name) {
  const url = `https://aiphonix-api.xinyi7lan.workers.dev/api/v1/char-images/file/${encodeURIComponent(name)}?w=1536`
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" } })
    return res.headers.get("content-type") === "image/webp"
  } catch {
    return false
  }
}

async function pool(items, n, fn) {
  let i = 0
  const results = new Array(items.length)
  const workers = Array.from({ length: Math.min(n, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

if (!existsSync(OUT_DIR)) {
  console.error(`no thumbs dir: ${OUT_DIR} (run gen_char_thumbs_1536.py first)`)
  process.exit(1)
}

let names = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)) // 去掉 .webp 后缀 → 原文件名
if (op === "retry-missing") {
  console.log(`probe ${names.length} webp thumbs for missing...`)
  const missing = []
  let probeIdx = 0
  const probePool = Array.from({ length: 15 }, async () => {
    while (probeIdx < names.length) {
      const name = names[probeIdx++]
      if (probeIdx % 300 === 0) console.log(`  probed ${probeIdx}/${names.length}`)
      if (!(await probeThumb(name))) missing.push(name)
    }
  })
  await Promise.all(probePool)
  console.log(`missing webp thumbs: ${missing.length}`)
  names = missing
  if (names.length === 0) {
    console.log("ALL WEBP THUMBS PRESENT ✅")
    process.exit(0)
  }
}
if (limit) names = names.slice(0, limit)

console.log(`uploading ${names.length} webp thumbs (concurrency 5)...`)
const start = Date.now()
let done = 0
const results = await pool(names, 5, (name) => {
  const code = runUpload(join(OUT_DIR, `${name}.webp`), `data/char_images_1536/${name}.webp`)
  return code.then((c) => {
    done++
    if (done % 50 === 0) console.log(`  ${done}/${names.length}`)
    return c === 0
  })
})
const ok = results.filter(Boolean).length
console.log(`upload done: ok=${ok} fail=${names.length - ok} in ${((Date.now() - start) / 1000).toFixed(0)}s`)
process.exit(ok === names.length ? 0 : 1)
