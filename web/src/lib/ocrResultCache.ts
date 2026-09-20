/** 前端 OCR 结果本地缓存（2026-09-02）
 *
 * 目的：同一张图重复识别时秒出结果，跳过 5~40s 的服务端链路。
 * 典型命中场景：重拍后重试、切块重新切、结果页返回再进、网络抖动重发。
 *
 * 存储：localStorage（同步读取 = 命中即返回，体感最好；比 IndexedDB 的异步往返更"秒"）。
 * 淘汰：LRU，上限 MAX_ENTRIES 条；TTL 按期清理；写入超 SIZE_LIMIT 的单条直接跳过（crops 内联图可能很大）。
 *
 * 指纹：优先 crypto.subtle SHA-256 全量摘要（精确）；不可用时回退「头/中/尾采样 + 大小」的
 * 同步 FNV 哈希（区分度足够，且不需要 secure context —— 局域网自签证书下也可用）。
 */

import type { ParseImageResult } from "../services/aiImage"

const STORE_KEY = "aiphonix_ocr_cache_v1"
const MAX_ENTRIES = 12
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const SIZE_LIMIT = 400 * 1024 // 单条序列化上限（字符数）

interface CacheEntry {
  /** 模块 + 指纹作为逻辑键（同一图走不同模块的结果互不影响） */
  key: string
  ts: number
  result: ParseImageResult
  /** 异步补到的多音字补丁（回填后持久化，下次命中直接带上） */
  poly?: Record<string, string>
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(36)
}

/** 计算图片指纹。优先 SHA-256，不可用时回退采样哈希，再不行退回随机值（= 不缓存）。 */
export async function fingerprintBlob(blob: Blob): Promise<string> {
  const size = blob?.size ?? 0
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await blob.arrayBuffer()
      const digest = await crypto.subtle.digest("SHA-256", buf)
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      return `s${hex.slice(0, 32)}`
    }
  } catch {
    /* 落到采样哈希 */
  }
  try {
    const head = new Uint8Array(await blob.slice(0, 32768).arrayBuffer())
    const midStart = Math.max(0, (size >> 1) - 16384)
    const mid = new Uint8Array(await blob.slice(midStart, Math.min(size, midStart + 32768)).arrayBuffer())
    const tail = new Uint8Array(await blob.slice(Math.max(0, size - 32768), size).arrayBuffer())
    return `f${size.toString(36)}_${fnv1a(head)}_${fnv1a(mid)}_${fnv1a(tail)}`
  } catch {
    return `u${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

function readAll(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as CacheEntry[]) : []
  } catch {
    return []
  }
}

function writeAll(entries: CacheEntry[]): void {
  let list = entries
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list))
      return
    } catch {
      // 配额溢出：砍掉最旧的一半再试
      list = list.slice(Math.max(1, list.length >> 1))
    }
  }
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 缓存键版本号：识别结果结构/质量变化时 bump，旧键自然失效（避免沿用坏数据）。
 * v3 = 2026-09-10 表格修复：此前 HTML 表格正文被「去印刷拼音」删成 `<></>`，
 * 学生看到尖括号乱码且单元格不能点读；bump 后重传图片即拿到修好的表格块。
 * v4 = 2026-09-14 英语识别修复：此前英语走语文提示词，豆包把英文单词当拼音删掉，
 * 结果只剩标点乱码。**服务端修复清不掉客户端这份缓存**（TTL 7 天），
 * 同一张图重新识别仍会命中旧脏结果 → bump 强制重识别一次。
 * v5 = 2026-09-15 填空横线保留：服务端 `stripQuestionNoise` 不再删行内下划线、语文 LLM
 * 去噪提示词第 3 条改写，语文 `_r4→_r5` / 英语 `_en_r5→_en_r6`。旧缓存里 `text` 的
 * `____` 已被删掉，客户端不 bump 会一直吃旧结果。 */
const KEY_V = "v5"

/** 读取命中结果（自动带上已缓存的多音字补丁）；未命中返回 null。
 * @param variant 识别变体（如所选模型 paddle/doubao/auto），不同模型结果互不污染缓存 */
export function getCachedParse(module: string, fp: string, variant = ""): ParseImageResult | null {
  if (!fp || fp.startsWith("u")) return null // 随机指纹不参与缓存
  try {
    const now = Date.now()
    const key = `${KEY_V}:${module}:${fp}${variant ? ":" + variant : ""}`
    const entries = readAll()
    const hit = entries.find((e) => e.key === key)
    if (!hit) return null
    if (!hit.ts || now - hit.ts > TTL_MS) {
      writeAll(entries.filter((e) => e.key !== key))
      return null
    }
    // 提 LRU：命中后置到末尾
    writeAll([...entries.filter((e) => e.key !== key), hit])
    const result = hit.result ?? ({} as ParseImageResult)
    const poly = hit.poly && Object.keys(hit.poly).length ? hit.poly : null
    if (!poly || !Array.isArray(result.blocks)) return result
    return {
      ...result,
      blocks: result.blocks.map((b) =>
        b && b.type && b.type !== "table" ? { ...b, polyphones: { ...(b.polyphones || {}), ...poly } } : b,
      ),
    }
  } catch {
    return null
  }
}

/** 写入/覆盖一条缓存（LRU 淘汰最旧）。返回是否真正写入。
 * @param variant 识别变体（所选模型），见 getCachedParse */
export function putCachedParse(module: string, fp: string, result: ParseImageResult, variant = ""): boolean {
  if (!fp || fp.startsWith("u")) return false
  try {
    const key = `${KEY_V}:${module}:${fp}${variant ? ":" + variant : ""}`
    const serialized = JSON.stringify(result)
    if (serialized.length > SIZE_LIMIT) return false
    const entries = readAll().filter((e) => e.key !== key && Date.now() - e.ts <= TTL_MS)
    entries.push({ key, ts: Date.now(), result })
    writeAll(entries.slice(-MAX_ENTRIES))
    return true
  } catch {
    return false
  }
}

/** 把异步补到的多音字补丁写回缓存条目（下次命中直接带注音，无需再轮询）。
 * 命中所有共享 module:fp 前缀的条目（不同 engine 变体都补到，便于任意模型重识别都带注音）。 */
export function patchCachedPoly(module: string, fp: string, poly: Record<string, string>): void {
  if (!fp || fp.startsWith("u") || !poly || !Object.keys(poly).length) return
  try {
    const prefix = `${KEY_V}:${module}:${fp}`
    const entries = readAll()
    const targets = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.key === prefix || e.key.startsWith(prefix + ":"))
    if (targets.length === 0) return
    for (const { i } of targets) {
      const merged = { ...(entries[i].poly || {}), ...poly }
      entries[i] = { ...entries[i], poly: merged }
      // 同步合并进已缓存的 blocks，命中即带注音
      const blocks = entries[i].result?.blocks
      if (Array.isArray(blocks)) {
        entries[i] = {
          ...entries[i],
          result: {
            ...entries[i].result,
            blocks: blocks.map((b: any) =>
              b && b.type && b.type !== "table" ? { ...b, polyphones: { ...(b.polyphones || {}), ...merged } } : b,
            ),
          },
        }
      }
    }
    writeAll(entries)
  } catch {
    /* 忽略 */
  }
}

/** 清空本地结果缓存（设置页/排障用） */
export function clearParseCache(): void {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* 忽略 */
  }
}
