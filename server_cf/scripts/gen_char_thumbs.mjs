#!/usr/bin/env node
/**
 * 字卡缩略图上传 R2（配合 scripts/gen_char_thumbs.py 生成）。
 * R2 key：data/char_images_thumb/<原文件名>.jpg（如 丝.png.jpg / 丝.jpg.jpg，不冲突）
 * 用法：node scripts/gen_char_thumbs.mjs [--limit N]   （上传 .thumbs/ 下所有已生成 jpg，幂等）
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const ROOT = fileURLToPath(new URL("..", import.meta.url)) // server_cf
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js")
const OUT_DIR = join(ROOT, ".thumbs")

function arg(name, dflt = "") {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const limit = arg("--limit") ? Number(arg("--limit")) : 0
const op = arg("--op", "upload")

function runUpload(file, key, contentType = "image/jpeg") {
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

/** HEAD 探测：Worker 缩略图路由返回 image/jpeg 即 R2 缩略图已存在 */
async function probeThumb(name) {
  const url = `https://aiphonix-api.xinyi7lan.workers.dev/api/v1/char-images/file/${encodeURIComponent(name)}?w=640`
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" } })
    return res.headers.get("content-type") === "image/jpeg"
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

if (op === "sync-full") {
  // 补传 R2 缺失的原图（data/char_images/<原名>），本地源在 --src 目录
  const srcDir = arg("--src")
  if (!srcDir) {
    console.error("usage: --op sync-full --src <local char_images dir>")
    process.exit(2)
  }
  const allFiles = readdirSync(OUT_DIR).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4))
  console.log(`probe ${allFiles.length} FULL images for missing...`)
  const missing = []
  let probeIdx = 0
  const probePool = Array.from({ length: 15 }, async () => {
    while (probeIdx < allFiles.length) {
      const name = allFiles[probeIdx++]
      if (probeIdx % 300 === 0) console.log(`  probed ${probeIdx}/${allFiles.length}`)
      const url = `https://aiphonix-api.xinyi7lan.workers.dev/api/v1/char-images/file/${encodeURIComponent(name)}`
      try {
        const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" } })
        if (res.status !== 200) missing.push(name)
      } catch {
        missing.push(name)
      }
    }
  })
  await Promise.all(probePool)
  console.log(`missing FULL images: ${missing.length}`)
  if (missing.length === 0) {
    console.log("ALL FULL IMAGES PRESENT ✅")
    process.exit(0)
  }
  const localMissing = []
  for (const name of missing) {
    if (!existsSync(join(srcDir, name))) localMissing.push(name)
  }
  console.log(`missing but NOT local: ${localMissing.length} -> ${localMissing.slice(0, 10).join(", ")}`)
  const missingLocal = missing.filter((n) => !localMissing.includes(n))
  const retryStart = Date.now()
  let retryDone = 0
  const retryResults = await pool(
    missingLocal,
    5,
    (name) => {
      const ext = name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
      const code = runUpload(join(srcDir, name), `data/char_images/${name}`, ext)
      return code.then((c) => {
        retryDone++
        if (retryDone % 10 === 0) console.log(`  uploaded full ${retryDone}/${missingLocal.length}`)
        return c === 0
      })
    }
  )
  const retryOk = retryResults.filter(Boolean).length
  console.log(`sync-full done: ok=${retryOk} fail=${missingLocal.length - retryOk} in ${((Date.now() - retryStart) / 1000).toFixed(0)}s`)
  process.exit(retryOk === missingLocal.length ? 0 : 1)
}

if (op === "retry-missing") {
  // 只探测+补传缺失的缩略图（不重传全部）
  if (!existsSync(OUT_DIR)) {
    console.error(`no thumbs dir: ${OUT_DIR}`)
    process.exit(1)
  }
  const allFiles = readdirSync(OUT_DIR).filter((f) => f.endsWith(".jpg"))
  console.log(`probe ${allFiles.length} thumbs for missing...`)
  const missing = []
  let probeIdx = 0
  const probePool = Array.from({ length: 15 }, async () => {
    while (probeIdx < allFiles.length) {
      const f = allFiles[probeIdx++]
      if (probeIdx % 300 === 0) console.log(`  probed ${probeIdx}/${allFiles.length}`)
      const okP = await probeThumb(f.slice(0, -4)) // 去掉 .jpg 后缀 = 原文件名
      if (!okP) missing.push(f)
    }
  })
  await Promise.all(probePool)
  console.log(`missing: ${missing.length} -> ${missing.join(", ")}`)
  if (missing.length === 0) {
    console.log("ALL THUMBS PRESENT ✅")
    process.exit(0)
  }
  const retryStart = Date.now()
  let retryDone = 0
  const retryResults = await pool(
    missing,
    5,
    (f) => {
      const code = runUpload(join(OUT_DIR, f), `data/char_images_thumb/${f}`)
      return code.then((c) => {
        retryDone++
        if (retryDone % 10 === 0) console.log(`  re-uploaded ${retryDone}/${missing.length}`)
        return c === 0
      })
    }
  )
  const retryOk = retryResults.filter(Boolean).length
  console.log(`retry done: ok=${retryOk} fail=${missing.length - retryOk} in ${((Date.now() - retryStart) / 1000).toFixed(0)}s`)
  process.exit(retryOk === missing.length ? 0 : 1)
}

if (!existsSync(OUT_DIR)) {
  console.error(`no thumbs dir: ${OUT_DIR} (run gen_char_thumbs.py first)`)
  process.exit(1)
}
const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".jpg"))
const targets = limit > 0 ? files.slice(0, limit) : files
console.log(`upload: ${targets.length} thumbs -> R2 data/char_images_thumb/ (concurrency 5)`)

const start = Date.now()
let done = 0
const results = await pool(
  targets,
  5,
  (f) => {
    const code = runUpload(join(OUT_DIR, f), `data/char_images_thumb/${f}`)
    return code.then((c) => {
      done++
      if (done % 50 === 0) console.log(`  uploaded ${done}/${targets.length}`)
      return c === 0
    })
  }
)
const ok = results.filter(Boolean).length
const fail = results.length - ok
console.log(`upload done: ok=${ok} fail=${fail} in ${((Date.now() - start) / 1000).toFixed(0)}s`)
if (fail > 0) process.exit(1)