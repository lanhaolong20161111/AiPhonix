/** LLM 造句审核 — 规则优先（免费快）+ LLM 兜底审语法语义 + 重试带反馈
 * 给"LLM 给小学生造的句子/文段"把关，杜绝漏用目标字词、语法不通、语义乱编。
 *
 * 用法：调用方把自己的 LLM 调用包成 (prompt: string) => Promise<string> 注入，
 * 审核 prompt 与生成 prompt 分离，规则不过不调 LLM（省钱）。
 */

export interface RuleCheck {
  ok: boolean
  reasons: string[]
}

export interface RuleOpts {
  min?: number
  max?: number
  /** 要求全部 target 都出现（joy 小故事）；false=任一出现即可（例句/单句） */
  allTargets?: boolean
}

/** 连续重复片段检测：形如 "AAA...AAA" / 整句重复粘贴 */
function hasDuplication(text: string): string | null {
  const t = text.replace(/\s+/g, "")
  if (!t) return null
  // 长度 ≥8 的片段连续重复 ≥2 次
  for (let len = 8; len <= Math.floor(t.length / 2); len++) {
    const half = t.slice(0, len)
    if (t.slice(len, len * 2) === half && t.slice(0, len * 2) === half + half) {
      return half.slice(0, 12)
    }
  }
  // 全句与开头 1/3 重复（"……。……。" 同句复读）——通过长度占比粗查
  return null
}

/** 规则优先审核（免费、快、不调 LLM） */
export function ruleCheckSentence(text: string, targets: string[], opts: RuleOpts = {}): RuleCheck {
  const t = (text ?? "").trim()
  const reasons: string[] = []
  const min = opts.min ?? 2
  const max = opts.max ?? 200
  if (!t) reasons.push("内容为空")
  else {
    if (t.length < min) reasons.push(`内容过短（${t.length} 字 < ${min}）`)
    if (t.length > max) reasons.push(`内容过长（${t.length} 字 > ${max}）`)
    const dup = hasDuplication(t)
    if (dup) reasons.push(`内容疑似重复粘贴（"${dup}…"）`)
  }
  const list = (targets ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)
  if (list.length) {
    if (opts.allTargets) {
      const missing = list.filter((x) => !t.includes(x))
      if (missing.length) reasons.push(`未包含目标字/词：${missing.join("、")}`)
    } else {
      if (!list.some((x) => t.includes(x))) reasons.push(`句子未包含目标词"${list[0]}"`)
    }
  }
  return { ok: reasons.length === 0, reasons }
}

/** 审核 prompt（按场景给判据） */
export function buildCheckPrompt(text: string, ctx: { kind: "story" | "word-example" | "word-sentence"; targets: string[] }): string {
  const targets = (ctx.targets ?? []).map((x) => String(x ?? "").trim()).filter(Boolean).join("、")
  const base =
    ctx.kind === "story"
      ? `下面是给 6-9 岁小学生的识字小故事。请审核：1) 语法是否通顺、语义是否连贯合理、有没有生硬编造或前后矛盾；2) 是否适合小学生阅读；3) 是否自然用上了目标字词（${targets || "（无）"}）。`
      : `下面是一句给小学生的中文造句/例句。请审核：1) 语法是否通顺；2) 语义是否合理正确、有没有用错词义或胡乱编造；3) 是否自然用上了目标词（${targets || "（无）"}）。`
  return (
    base +
    "\n只输出严格 JSON（不要解释、不要代码围栏）：{\"ok\": true 或 false, \"reason\": \"不通过时给一句简短原因（中文），通过则为空字符串\"}\n" +
    `待审核内容：${text}`
  )
}

/** 解析审核响应：只认 {"ok":true|false,"reason":...} */
export function parseCheckResult(raw: string): { ok: boolean; reason: string } {
  let s = (raw ?? "").trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const a = s.indexOf("{")
  const b = s.lastIndexOf("}")
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  try {
    const j = JSON.parse(s) as { ok?: unknown; reason?: unknown }
    return { ok: j?.ok === true || j?.ok === "true", reason: String(j?.reason ?? "").trim() }
  } catch {
    return { ok: false, reason: "审核返回无法解析，按不通过处理" }
  }
}

/** 通用「生成 + 审核」循环：最多尝试 1 次生成 + 2 次重试。
 * attempt(feedback) 每次生成（feedback 为空串表示首次；重试时带上上次不通过原因）；
 * verify(t) 返回 { ok, reason }（调用方组合规则 + LLM 审核）。
 * 三次全不过抛错，由调用方降级/报错。
 */
export async function generateWithGuard<T>(
  attempt: (feedback: string) => Promise<T>,
  verify: (t: T) => Promise<{ ok: boolean; reason: string }>,
  maxTries = 3,
): Promise<T> {
  let feedback = ""
  for (let i = 0; i < maxTries; i++) {
    const out = await attempt(feedback)
    const r = await verify(out)
    if (r.ok) return out
    feedback = r.reason || "内容未通过审核"
  }
  throw new Error(`生成内容连续 ${maxTries} 次未通过审核：${feedback}`)
}
