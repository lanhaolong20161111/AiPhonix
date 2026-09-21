/** 发音要领（低分音素的阅读技巧）—— 服务端纯逻辑。
 *
 * 拆出来是为了**可单测**：路由里只剩「查缓存 → 问 LLM → 落缓存」三段 IO，
 * 键的归一化、出参清洗、坏数据丢弃这些容易出错的判断都在这里，不需要起 wrangler 就能验。
 *
 * 分工（2026-09-20 与用户确认）：
 * - **本地表打底**：前端 `lib/phonicsTips.ts` 有 44 条通用要领，评测一结束立刻显示，不等网络。
 * - **LLM 补充**：本模块支持的那条路由，针对「这个音素在这个词里」补一句更贴合的提示。
 *   前端拿到后替换/追加；失败就保持本地表，用户无感。
 */

/** 单次最多问几个音素（孩子一句话可能错 10 个音素，问全了 prompt 会被撑爆、还费 token） */
export const MAX_TIP_PHONES = 5

/** 提示文本长度上限：超过这个长度的模型输出一律丢弃（防止把卡片撑破） */
export const MAX_TIP_LEN = 60

export interface TipItem {
  phone: string
  tip: string
  category: string
}

/**
 * 缓存键：`音素|词`。
 *
 * 为什么带词：**同一个音素在不同词里的错法不一样**。
 * `th` 在 `think` 里是清音 /θ/（读成 s 是主要错法），在 `the` 里是浊音 /ð/（读成 d 更常见），
 * 两者给的提示必须是不同的两句话。只按音素缓存会让后一个词拿到前一个词的提示。
 *
 * 归一化：音素去尾随重音数字（`th1` → `th`）+ 小写；单词只留字母数字与撇号 + 小写
 * （`"The"` → `the`、`"don't"` → `don't`），保证大小写/标点不影响命中。
 */
export function tipCacheKey(phone: string, word: string): string {
  const p = phone.trim().toLowerCase().replace(/[012]$/, "")
  const w = word.trim().toLowerCase().replace(/[^a-z0-9']/g, "")
  return `${p}|${w}`
}

/** 入参清洗：丢弃空音素/非数字分数，截断超长字段，最多取 MAX_TIP_PHONES 个 */
export function normalizeTipRequest(rawWord: unknown, rawItems: unknown): {
  word: string
  items: Array<{ phone: string; score: number }>
} {
  const word = String(rawWord ?? "").trim().slice(0, 60)
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((it) => ({
      phone: String((it as { phone?: unknown })?.phone ?? "").trim().slice(0, 12),
      score: Number((it as { score?: unknown })?.score ?? Number.NaN),
    }))
    .filter((it) => it.phone && Number.isFinite(it.score))
    .slice(0, MAX_TIP_PHONES)
  return { word: word.replace(/[^A-Za-z0-9'\u2019\u02BC -]/g, ""), items }
}

/**
 * 清洗 LLM 返回的要领列表。
 *
 * 三道闸门（都为防「模型不听话」）：
 * 1. **只收我们问过的音素** —— 模型有时会自作主张多给几个音素，那些没测到分、
 *    前端也没位置放，收下来只会变成无主数据。
 * 2. **长度闸门** —— 说好一句话，超过 `MAX_TIP_LEN` 一律丢（宁可退回本地表，
 *    也不要在孩子的卡片上塞一段小作文）。
 * 3. **去重** —— 同一个音素只留第一条。
 */
export function cleanTipResponse(raw: unknown, askedPhones: string[]): TipItem[] {
  const want = new Set(askedPhones)
  const out: TipItem[] = []
  const list = (() => {
    const p = raw as { tips?: unknown } | null | undefined
    return Array.isArray(p?.tips) ? p!.tips : []
  })()
  for (const t of list) {
    const phone = String((t as { phone?: unknown })?.phone ?? "").trim()
    const tip = String((t as { tip?: unknown })?.tip ?? "").trim()
    if (!phone || !tip) continue
    if (!want.has(phone)) continue
    if (tip.length > MAX_TIP_LEN) continue
    if (out.some((o) => o.phone === phone)) continue
    out.push({ phone, tip, category: "llm" })
  }
  return out
}

/**
 * 从模型原始输出里抠出 JSON 对象。
 *
 * 豆包即使被要求「不要代码围栏」仍经常包 ```` ```json ````，或前后带一句解释，
 * 所以先剥围栏、再取首个 `{` 到末个 `}`。抠不出来就返回空串（调用方当失败处理）。
 */
export function extractJson(raw: string): string {
  let s = (raw ?? "").trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const a = s.indexOf("{")
  const b = s.lastIndexOf("}")
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  return s
}
