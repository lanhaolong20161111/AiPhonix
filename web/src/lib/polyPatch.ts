/** 异步补多音字的客户端回填（2026-09-02）
 *
 * 背景：语文/数学识图原本要串行等「豆包补多音字」3~35s 才返回，正文其实早就可用。
 * 现在服务端改为：主请求先返回正文 + poly_token，注音在 waitUntil 后台补，前端轮询回填。
 *
 * 用法（页面 setSession + navigate 之后一行调用，不阻塞跳转）：
 *   schedulePolyPatch(res)
 *
 * 切块/多框选：mergeParseResults 会带 poly_parts（每段的 token + blocks 区间），
 * 这里逐段轮询、逐段回填，互不串味。
 */

import { api } from "../services/api"
import type { ParseImageResult } from "../services/aiImage"
import { useParseSessionStore } from "../stores/parseSessionStore"
import { patchCachedPoly } from "./ocrResultCache"

const MAX_WAIT_MS = 45_000
const FIRST_DELAY_MS = 1_200

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 轮询单个 token 的注音补丁；就绪返回字→拼音映射（可能为空对象），超时/失败返回 null。 */
export async function pollPolyphones(token: string, _module = "chinese", maxMs = MAX_WAIT_MS): Promise<Record<string, string> | null> {
  if (!token) return null
  const t0 = Date.now()
  let delay = FIRST_DELAY_MS
  while (Date.now() - t0 < maxMs) {
    await sleep(delay)
    try {
      const r = await api<{ ready?: boolean; polyphones?: Record<string, string> }>(
        `/ai-chinese/parse-polyphones?token=${encodeURIComponent(token)}`,
        { timeoutMs: 10_000 },
      )
      if (r?.ready) return r.polyphones ?? {}
    } catch {
      /* 单次网络抖动忽略，继续轮询 */
    }
    delay = Math.min(Math.round(delay * 1.5), 4_000)
  }
  return null
}

/**
 * 识别结果落地后调用：后台补齐注音并回填到会话 + 本地缓存。
 * 幂等、失败静默（注音缺失只影响点读读音，前端会回退词库默认读音，不报错）。
 * @param pageIndex 多图批次里的第几张（0 起）。多图时每页各自回填；不传=回填当前活动页。
 */
export function schedulePolyPatch(
  res: ParseImageResult,
  module: "chinese" | "math" | "english" = "chinese",
  pageIndex?: number,
): void {
  if (!res) return
  const parts = res.poly_parts?.length
    ? res.poly_parts
    : res.poly_token
      ? [{ token: res.poly_token, fingerprint: res.fingerprint ?? "", start: 0, end: res.blocks?.length ?? 0 }]
      : []
  if (!parts.length) return

  void (async () => {
    for (const p of parts) {
      if (!p.token) continue
      const poly = await pollPolyphones(p.token, module === "english" ? "english" : "chinese")
      if (!poly || !Object.keys(poly).length) continue
      // 会话回填（结果页 zustand 订阅 → 自动重渲染）。多图批次必须指名页号，
      // 否则第 2 张的注音会被写进当前正在看的第 1 张。
      const store = useParseSessionStore.getState()
      if (pageIndex === undefined) store.patchPolyphones(poly, p.start, p.end)
      else store.patchPagePolyphones(pageIndex, poly, p.start, p.end)
      // 本地缓存回写：下次同图命中直接带注音，不用再等轮询
      if (p.fingerprint) patchCachedPoly(module, p.fingerprint, poly)
    }
  })()
}
