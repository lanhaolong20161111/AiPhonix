/** 多音字集合 —— 单一数据源：后端 GET /api/v1/chinese/polyphone（R2 上的 polyphone_chars.json）。
 *
 * 不再打包本地副本（旧版由 shared/data/polyphone_chars.json 生成 214 字 Set，
 * 易与后端字典漂移 → 本次多音字 bug 的根因）。前端统一走 API，删除前端生成副本，
 * 改由 R2 上那份作为唯一事实源。
 *
 * 用途：TTS 注音时只对多音字标音（isPolyphone），非多音字百度本身能读对，
 *       可显著缩短送进 tex 的文本长度、降低计费字节数。
 */

let cache: ReadonlySet<string> | null = null
let inflight: Promise<void> | null = null

/** 惰性拉取并缓存多音字集合（幂等，并发安全）。拉取失败保持 cache=null，下次重试。 */
export async function ensurePolyphones(): Promise<void> {
  if (cache || inflight) return
  inflight = (async () => {
    try {
      const res = await fetch("/api/v1/chinese/polyphone")
      if (!res.ok) return
      const data = (await res.json()) as any
      const charObj = data?.chars
      const list: string[] =
        charObj && typeof charObj === "object" ? Object.keys(charObj) : []
      cache = new Set(list)
    } catch {
      /* 网络/解析失败：保持未加载，安全降级为「非多音字」 */
    } finally {
      inflight = null
    }
  })()
  await inflight
}

/** 是否为多音字。未加载完成前返回 false（安全降级：不注音，百度按默认读音）。 */
export function isPolyphone(ch: string): boolean {
  if (cache) return cache.has(ch)
  void ensurePolyphones()
  return false
}

/** 同步取当前已加载集合（未加载返回空 Set），供需遍历多音字的场景使用。 */
export function getPolyphoneChars(): ReadonlySet<string> {
  return cache ?? new Set()
}

// 模块加载即预热（被 ttsPinyin 引入时随 TTS 功能一起就绪）
void ensurePolyphones()
