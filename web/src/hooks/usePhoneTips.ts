/** 发音要领的 LLM 补充 —— 本地表立刻显示，模型返回后替换。
 *
 * ## 两段式 UI 的取舍（2026-09-20 与用户确认的设计）
 *
 * 孩子在「每日英语」读完一句后，低分音素旁边要**马上**出现一句「怎么改」。
 * 但 LLM 往返要 1~3 秒，等它再渲染等于把评分反馈拖慢，所以：
 *
 * 1. **第一段（0ms）**：`lib/phonicsTips.ts` 的本地通用要领立刻渲染 —— 绝不空白。
 * 2. **第二段（~2s）**：本 hook 把「词 + 低分音素」发给 `/daily-en/phone-tips`，
 *    拿回更贴合该词的文案，**按音素覆盖**本地文案（没有返回的音素保持本地文案）。
 *
 * ## 为什么「覆盖」而不是「追加」
 *
 * 追加会变成两句意思重叠的话（本地「舌尖伸到牙齿中间」+ 模型「th 要咬舌」），
 * 卡片上塞两行对孩子是噪音。覆盖则始终只有一句、且是更贴题的那句。
 *
 * ## 失败一律静默
 *
 * 超时/401/冷启动 503/模型乱答 —— 全部降级为「保持本地文案」。
 * ⚠️ 所以这个 hook **永远不返回错误**，调用方不需要处理 loading/error 态。
 *
 * ## ★ 三个必须一起成立的机制（都是被 e2e 打出来的）
 *
 * 1. **模块级缓存 `tipCache`**（key = `音素|词`，与服务端 `tipCacheKey` 同构，跨组件实例共享）。
 * 2. **在飞请求去重 `inflight`**：键相同就把同一个 Promise 复用给新来的调用方。
 *    ⚠️ 曾经的写法是「effect 里 `alive` 标志 + 清理时置 false」——
 *    只要 `requests` 换了引用或 React 严格模式重跑一次 effect，**已发出的请求就会被作废**
 *    （实测：lily 的 2.5s 请求被丢弃，文案永远停在本地版）。
 *    现在把在飞 Promise 存进 Map，effect 重跑只是**再取一次同一个 Promise**，不再取消它。
 * 3. **签名守卫 `lastSig`**：同一批请求只发一次，避免严格模式/重复渲染打出重复请求。
 *
 * ## 缓存生命周期
 *
 * 内存 Map，**刷新页面即清空**（可接受：服务端还有一层 DB 缓存兜着，
 * 重新请求也是毫秒级；且同一会话内重复展开已零网络，见 e2e 第 ⑧ 步）。
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { fetchPhoneTips } from "../services/dailyEn"

export interface TipOverride {
  tip: string
  fromLlm: boolean
}

export interface TipRequest {
  word: string
  phone: string
  score: number
}

/** 模块级缓存：`音素|词` → 覆盖文案。多个 SoeDetail 实例共享。 */
const tipCache = new Map<string, TipOverride>()

/** 在飞请求：`词` → Promise（一次问该词的全部待补音素；成功 resolve 出结果列表） */
const inflight = new Map<string, Promise<void>>()

/** 一个词一次最多问几个音素（与服务端 MAX_TIP_PHONES 一致） */
const MAX_PER_WORD = 5

/** 归一化缓存键：与 server_cf `lib/phoneTips.ts` 的 tipCacheKey 同构 */
function cacheKey(phone: string, word: string): string {
  return `${phone.trim().toLowerCase().replace(/[012]$/, "")}|${word.trim().toLowerCase().replace(/[^a-z0-9']/g, "")}`
}

/** 词级归一化（服务端也这么归一化，保持一致） */
function wordKey(word: string): string {
  return word.trim().toLowerCase().replace(/[^a-z0-9']/g, "")
}

/**
 * 为一个词补齐若干音素的 LLM 补充。
 *
 * ★ 按**词**去重而不是按 (音素, 词)：服务端接口本来就是「一次问一个词的多个音素」，
 * 一个词只应发一次请求。早先按音素发会让 `lily` 的 3 个低分音素打出 3 次请求 ——
 * 既浪费额度又让 `?` 之后到达的响应互相覆盖。
 *
 * 同一个词若已有在飞请求，**等它结束后再查缓存**（新音素会补发一次），
 * 而不是直接丢弃 —— 否则「先展开 lily 只看到 l，后来才出现的 ih」会被漏掉。
 */
function ensureWordTips(word: string, items: Array<{ phone: string; score: number }>): Promise<void> {
  const w = wordKey(word)
  if (!w || !items.length) return Promise.resolve()

  const prev = inflight.get(w) ?? Promise.resolve()
  const p = prev
    .catch(() => undefined)
    .then(async () => {
      // 先看缓存里还缺哪些（可能在等上一个请求时已经被填上了）
      const need = items
        .filter((it) => !tipCache.has(cacheKey(it.phone, word)))
        .slice(0, MAX_PER_WORD)
      if (!need.length) return
      try {
        const tips = await fetchPhoneTips(word, need)
        for (const t of tips) {
          const k = cacheKey(t.phone, word)
          if (!t.tip || tipCache.has(k)) continue
          tipCache.set(k, { tip: t.tip, fromLlm: true })
        }
      } catch {
        /* 静默降级：什么都不写，下次可重试 */
      }
    })
    .finally(() => {
      if (inflight.get(w) === p) inflight.delete(w)
    })
  inflight.set(w, p)
  return p
}

/**
 * 拉取低分音素的 LLM 补充要领。
 *
 * @param requests 需要补充的「词 + 音素 + 分数」；空数组时不发请求
 * @returns `音素 → 覆盖文案` 的 Map（只含 LLM 真的返回了的音素；命中缓存的即时可见）
 */
export function usePhoneTips(requests: TipRequest[]): Map<string, TipOverride> {
  // 依赖用签名而非数组本身：父组件每次渲染都会新建数组，直接依赖会导致无限请求
  const signature = useMemo(
    () =>
      requests
        .map((r) => `${cacheKey(r.phone, r.word)}:${Math.round(r.score)}`)
        .sort()
        .join(","),
    [requests],
  )

  const [overrides, setOverrides] = useState<Map<string, TipOverride>>(new Map())
  const lastSig = useRef("")

  useEffect(() => {
    if (!signature) {
      setOverrides(new Map())
      lastSig.current = ""
      return
    }

    // ① 缓存命中的部分立刻呈现（可能是本会话早先已取到的），保证无闪烁
    const immediate = new Map<string, TipOverride>()
    const missing: TipRequest[] = []
    for (const r of requests) {
      const hit = tipCache.get(cacheKey(r.phone, r.word))
      if (hit) immediate.set(r.phone, hit)
      else missing.push(r)
    }
    setOverrides(immediate)

    if (!missing.length) return
    if (lastSig.current === signature) return
    lastSig.current = signature

    // ② 按词分组（接口按词提问，一次最多 5 个音素）
    const byWord = new Map<string, Array<{ phone: string; score: number }>>()
    for (const r of missing) {
      const list = byWord.get(r.word) ?? []
      list.push({ phone: r.phone, score: r.score })
      byWord.set(r.word, list)
    }

    // ③ 逐词请求（词级去重，见 ensureWordTips）。
    //    ⚠️ 这里**不做「alive」取消**：曾经用「清理时置 false」的写法，
    //    结果 React 严格模式重跑一次 effect 就把已发出的请求作废了
    //    （实测 lily 的 2.5s 响应被丢弃，文案永远停在本地版）。
    //    改为「请求独立完成 → 结果写进 tipCache → 再从缓存重建 state」，
    //    重跑 effect 只是多一次从缓存读取，不会丢结果。
    void (async () => {
      await Promise.all([...byWord.entries()].map(([word, items]) => ensureWordTips(word, items)))

      // 从缓存重建（含本会话早先取到的 + 本次刚写入的）
      const next = new Map<string, TipOverride>()
      for (const r of requests) {
        const hit = tipCache.get(cacheKey(r.phone, r.word))
        if (hit) next.set(r.phone, hit)
      }
      setOverrides(next)
    })()
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  return overrides
}

/** 清空模块级缓存（单测/调试用；正常情况下不需要调用） */
export function __clearTipCache(): void {
  tipCache.clear()
  inflight.clear()
}
