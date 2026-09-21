/**
 * Workers Assets（`env.ASSETS`）→ 本地静态文件目录。
 *
 * 生产配置（server_cf/wrangler.toml）：`[assets] directory = "./static_assets"`、
 * `binding = "ASSETS"`、`run_worker_first = false` —— 语义是「static_assets 里存在的文件
 * 由平台直出，未命中才进 Worker」，因此这里必须同时提供两件事：
 *
 * ① `AssetsShim.fetch(request)`：给 Worker 内部使用（`index.ts` 的 serveWebIndex 取
 *    `/web/` 的 index.html；`lib/preGeneratedTts.ts` 取 `/tts-cache/**` 的音频与索引）。
 *    内部调用的 URL 形如 `https://tts-cache.internal/tts-cache/...`，host 无意义，只用 pathname。
 *
 * ② 「Assets 优先」的对外直出：main.ts 对 `GET/HEAD /web/*`、`/tts-cache/*` 先查磁盘，
 *    命中就直接返回（对齐 run_worker_first=false），未命中才回落到 Hono（SPA fallback 等）。
 *
 * 缓存头按 `static_assets/_headers` 的规则复刻（见 cacheControlFor），保证与生产观感一致。
 * 目录请求（如 `/web`）按平台 clean-URL 行为返回 307 到 `/web/`。
 */
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Readable } from "node:stream"

/**
 * MIME 表 —— **逐项对齐生产 CF Assets 的实测值**（2026-09-20 用 curl 取生产头核对）：
 *   .js → text/javascript（CF 不是 application/javascript，且不带 charset）
 *   .css → text/css      .json → application/json      .html → text/html
 * 刻意都不带 `; charset=utf-8`：CF Assets 不加，浏览器对 HTML/JS/JSON 默认按 UTF-8 解析。
 */
const MIME_BY_EXT: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  webmanifest: "application/manifest+json",
  map: "application/json",
  txt: "text/plain",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  wasm: "application/wasm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf",
}

export function guessType(pathname: string): string {
  const m = pathname.match(/\.([a-z0-9]+)$/i)
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || "application/octet-stream"
}

/** 复刻 static_assets/_headers（顺序即优先级） */
export function cacheControlFor(pathname: string): string {
  // 带 hash 的构建产物：文件名即内容指纹，永久缓存
  if (pathname.startsWith("/web/assets/")) return "public, max-age=31536000, immutable"
  // 字母发音音频：1 天
  if (/^\/web\/alphabet_audio\/.*\.mp3$/i.test(pathname)) return "public, max-age=86400"
  // 每次构建都变 / 需回源校验
  if (pathname === "/index.html" || pathname === "/web/index.html") return "no-cache"
  if (pathname === "/web/sw.js" || pathname === "/web/registerSW.js" || pathname === "/web/manifest.webmanifest") {
    return "no-cache"
  }
  if (/^\/web\/workbox-[^/]*\.js$/i.test(pathname)) return "no-cache"
  if (/^\/web\/[^/]*\.json$/i.test(pathname)) return "no-cache"
  if (pathname === "/web/favicon.svg" || pathname === "/web/icons.svg") return "no-cache"
  // 平台默认（_headers 注释里写的 max-age=0, must-revalidate）
  return "public, max-age=0, must-revalidate"
}

/**
 * pathname → 磁盘路径。任何越界（`..`、绝对路径注入、NUL）一律返回 null（拒绝而非容错）。
 */
export function resolveStaticPath(root: string, pathname: string): string | null {
  if (pathname.includes("\0")) return null
  const segments = pathname.split("/").filter((s) => s !== "")
  for (const s of segments) {
    if (s === "." || s === "..") return null
  }
  const abs = resolve(root, join(...segments))
  const rootAbs = resolve(root)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + (process.platform === "win32" ? "\\" : "/"))) return null
  return abs
}

function safeDecode(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

async function fileResponse(
  fsPath: string,
  mimePath: string,
  /** 缓存规则的判定路径：**请求路径**（不是磁盘文件路径）—— 与 CF Assets 的 _headers 匹配口径一致 */
  ccPath: string,
  st: { size: number; mtime: Date },
  ifNoneMatch: string | null,
  headOnly: boolean,
): Promise<Response> {
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtime.getTime()).toString(16)}"`
  const headers = new Headers({
    "Content-Type": guessType(mimePath),
    "Content-Length": String(st.size),
    "Cache-Control": cacheControlFor(ccPath),
    ETag: etag,
    "Last-Modified": st.mtime.toUTCString(),
    "Accept-Ranges": "bytes",
  })
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === "*")) {
    return new Response(null, { status: 304, headers })
  }
  if (headOnly || st.size === 0) return new Response(null, { status: 200, headers })
  const body = Readable.toWeb(createReadStream(fsPath)) as ReadableStream<Uint8Array>
  return new Response(body, { status: 200, headers })
}

/**
 * 取静态文件。命中 → Response；未命中（含越界）→ null（由调用方继续路由）。
 * 目录：不带尾斜杠 → 307 追加斜杠（对齐平台 clean-URL）；带尾斜杠 → 目录下 index.html。
 *
 * ⚠️ 缓存头按**请求路径**判定（不是解析后的文件路径）：CF Assets 的 `_headers` 是按请求
 *    路径匹配的，故 `/web/` 命中的是默认规则（`public, max-age=0, must-revalidate`），
 *    而直接请求 `/web/index.html` 才命中 `no-cache`（2026-09-20 与生产实测比对确认）。
 */
export async function staticResponse(
  root: string,
  rawPathname: string,
  reqHeaders?: Headers,
  headOnly = false,
): Promise<Response | null> {
  const pathname = safeDecode(rawPathname)
  const fsPath = resolveStaticPath(root, pathname)
  if (!fsPath) return null

  let st
  try {
    st = await stat(fsPath)
  } catch {
    return null
  }

  const inm = reqHeaders?.get("if-none-match") ?? null

  if (st.isDirectory()) {
    if (!pathname.endsWith("/")) {
      return new Response(null, { status: 307, headers: { Location: `${pathname}/` } })
    }
    const idxPath = join(fsPath, "index.html")
    try {
      const idxStat = await stat(idxPath)
      if (!idxStat.isFile()) return null
      return await fileResponse(idxPath, `${pathname}index.html`, pathname, idxStat, inm, headOnly)
    } catch {
      return null
    }
  }

  if (!st.isFile()) return null
  return await fileResponse(fsPath, pathname, pathname, st, inm, headOnly)
}

/** `env.ASSETS` 的等价物（仅 Worker 内部调用会用到：serveWebIndex 与 preGeneratedTts） */
export class AssetsShim {
  #root: string
  readonly stats = { fetches: 0, hits: 0 }

  constructor(root: string) {
    this.#root = root
  }

  async fetch(request: Request): Promise<Response> {
    this.stats.fetches++
    const url = new URL(request.url)
    const res = await staticResponse(this.#root, url.pathname, request.headers, request.method === "HEAD")
    if (res) {
      this.stats.hits++
      return res
    }
    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain;charset=UTF-8" } })
  }
}
