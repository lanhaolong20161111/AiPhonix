/**
 * R2 绑定 → 本地文件系统。
 *
 * 目的：让 server_cf 的 lib/storage.ts（`getEnv().FILES.*`）零改动跑在 Node 上。
 * key 语义与 R2 完全一致（`data/...`、`static/...`、`cache/...`、`downloads/...`），
 * 落盘为 `<root>/<key>`，因此 root 指向 shared/ 即可与生产 R2 的键空间一一对应。
 *
 * 已覆盖 server_cf 实际用到的 5 个方法：get / head / put / list / delete（含 range 读取）。
 * ⚠️ 差异（相对真 R2，均不影响业务）：
 *   - `uploaded`/`version` 只是占位；`etag` 用内容 MD5（R2 本身也是 MD5，故 httpEtag 同源）。
 *   - `list` 为目录遍历实现，支持 prefix/limit/cursor，但无 R2 的最终一致性语义。
 *   - 不实现 multipart（server_cf 未使用）。
 */
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises"
import { Readable } from "node:stream"
import { dirname, join } from "node:path"

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  woff: "font/woff",
  woff2: "font/woff2",
}

function guessType(key: string): string {
  const m = key.match(/\.([a-z0-9]+)$/i)
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || "application/octet-stream"
}

/** 规范化 key：去掉空段与 . / ..，杜绝路径遍历（与 R2 的平坦键空间语义一致） */
function safeKey(key: string): string {
  return String(key)
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .join("/")
}

function md5(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex")
}

class R2ObjectShim {
  readonly key: string
  readonly size: number
  readonly etag: string
  readonly httpEtag: string
  readonly uploaded: Date
  readonly version: string
  readonly httpMetadata: { contentType: string }
  readonly checksums: Record<string, never> = {}

  constructor(key: string, size: number, etag: string, contentType: string) {
    this.key = key
    this.size = size
    this.etag = etag
    this.httpEtag = `"${etag}"`
    this.uploaded = new Date()
    this.version = etag
    this.httpMetadata = { contentType }
  }

  writeHttpMetadata(headers: Headers): void {
    headers.set("Content-Type", this.httpMetadata.contentType)
  }
}

/** 带 body 的 R2Object。刻意惰性：大文件（视频/图片）不整块读进内存 */
class R2ObjectBodyShim extends R2ObjectShim {
  #path: string
  #start: number

  constructor(key: string, path: string, size: number, etag: string, contentType: string, start: number) {
    super(key, size, etag, contentType)
    this.#path = path
    this.#start = start
  }

  get body(): ReadableStream<Uint8Array> {
    const end = this.#start + this.size - 1
    const opts = this.size > 0 ? { start: this.#start, end } : {}
    return Readable.toWeb(createReadStream(this.#path, opts)) as ReadableStream<Uint8Array>
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const fh = await open(this.#path, "r")
    try {
      const buf = Buffer.alloc(this.size)
      if (this.size > 0) await fh.read(buf, 0, this.size, this.#start)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    } finally {
      await fh.close()
    }
  }

  async text(): Promise<string> {
    return Buffer.from(await this.arrayBuffer()).toString("utf8")
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T
  }

  async blob(): Promise<Blob> {
    return new Blob([await this.arrayBuffer()], { type: this.httpMetadata.contentType })
  }
}

export interface R2ListOptions {
  prefix?: string
  limit?: number
  cursor?: string
  delimiter?: string
  include?: string[]
}

export class R2Shim {
  #root: string
  /** 统计：便于 /health 与排查（生产 R2 无此概念） */
  readonly stats = { gets: 0, puts: 0, deletes: 0, lists: 0, heads: 0 }

  constructor(root: string) {
    this.#root = root
  }

  #resolve(key: string): { key: string; path: string } {
    const k = safeKey(key)
    return { key: k, path: join(this.#root, k) }
  }

  async #meta(key: string): Promise<{ size: number; etag: string } | null> {
    const { path } = this.#resolve(key)
    try {
      const st = await stat(path)
      if (!st.isFile()) return null
      // ETag 用「大小 + mtime」推导，避免每次 head 都整文件 hash（视频/大图代价高）。
      // ⚠️ 与生产 R2 的差异：真 R2 的 etag 是内容 MD5，这里是元数据推导值，
      //    故 /letter-clips/* /videos/* 的 ETag 头与生产不相同（内容仍逐字节一致）。
      //    serveR2Object 的 If-None-Match 比较在本地自洽，不影响 304 语义。
      const etag = `shim-${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}`
      return { size: st.size, etag }
    } catch {
      return null
    }
  }

  async head(key: string): Promise<R2ObjectShim | null> {
    this.stats.heads++
    const meta = await this.#meta(key)
    if (!meta) return null
    const { key: k } = this.#resolve(key)
    return new R2ObjectShim(k, meta.size, meta.etag, guessType(k))
  }

  async get(
    key: string,
    opts?: { range?: { offset?: number; length?: number; suffix?: number } },
  ): Promise<R2ObjectBodyShim | null> {
    this.stats.gets++
    const { key: k, path } = this.#resolve(key)
    let size: number
    let etag: string
    try {
      const st = await stat(path)
      if (!st.isFile()) return null
      size = st.size
      etag = `shim-${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}`
    } catch {
      return null
    }
    // 无 range：不预读内容，Etag 用元数据推导（够用且便宜）
    if (!opts?.range) return new R2ObjectBodyShim(k, path, size, etag, guessType(k), 0)

    const r = opts.range
    let start: number
    let length: number
    if (typeof r.suffix === "number") {
      length = Math.min(r.suffix, size)
      start = size - length
    } else {
      start = Math.max(0, r.offset ?? 0)
      length = Math.min(r.length ?? size - start, size - start)
    }
    if (start >= size || length <= 0) return null
    return new R2ObjectBodyShim(k, path, length, etag, guessType(k), start)
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | Blob | ReadableStream | null,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2ObjectShim> {
    this.stats.puts++
    const { key: k, path } = this.#resolve(key)
    await mkdir(dirname(path), { recursive: true })
    let buf: Buffer
    if (value === null || value === undefined) buf = Buffer.alloc(0)
    else if (typeof value === "string") buf = Buffer.from(value, "utf8")
    else if (value instanceof Blob) buf = Buffer.from(await value.arrayBuffer())
    else if (value instanceof ArrayBuffer) buf = Buffer.from(value)
    else if (ArrayBuffer.isView(value)) buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    else if (typeof (value as ReadableStream).getReader === "function") {
      buf = Buffer.from(await new Response(value as ReadableStream).arrayBuffer())
    } else buf = Buffer.from(String(value), "utf8")
    await writeFile(path, buf)
    const etag = md5(buf)
    return new R2ObjectShim(k, buf.length, etag, opts?.httpMetadata?.contentType ?? guessType(k))
  }

  async delete(keys: string | string[]): Promise<void> {
    const arr = Array.isArray(keys) ? keys : [keys]
    this.stats.deletes += arr.length
    for (const key of arr) {
      const { path } = this.#resolve(key)
      await rm(path, { force: true }).catch(() => undefined)
    }
  }

  async list(
    opts?: R2ListOptions,
  ): Promise<{ objects: R2ObjectShim[]; truncated: boolean; cursor?: string }> {
    this.stats.lists++
    const prefix = safeKey(opts?.prefix ?? "")
    const limit = opts?.limit ?? 1000
    const keys: string[] = []
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const nextRel = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(join(dir, e.name), nextRel)
        else if (!prefix || nextRel.startsWith(prefix)) keys.push(nextRel)
      }
    }
    await walk(this.#root, "")
    keys.sort()
    const startIdx = opts?.cursor ? keys.findIndex((k) => k > opts.cursor!) : 0
    const from = startIdx < 0 ? 0 : startIdx
    const page = keys.slice(from, from + limit)
    const objects: R2ObjectShim[] = []
    for (const k of page) {
      const meta = await this.#meta(k)
      if (meta) objects.push(new R2ObjectShim(k, meta.size, meta.etag, guessType(k)))
    }
    const truncated = from + limit < keys.length
    return { objects, truncated, cursor: truncated ? page[page.length - 1] : undefined }
  }
}
