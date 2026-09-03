/** Radical 路由 — /api/v1/radical（偏旁魔法屋 LLM 内容：儿歌 / 字谜池）
 * - 每个字族只生成一次并存 D1（radical_content），之后所有请求走缓存（控制 LLM 成本）
 * - 字谜答案必须命中前端传入的字族字符集，否则重试/丢弃（防幻觉）
 * - LLM 只走免费 Ark 单链路（arkOnly）：失败快速返回 + 失败标记缓存冷却，绝不叠付费回退
 */
import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { radicalContent } from "../db/schema.js"
import { chat as deepseekChat } from "../lib/deepseek.js"
import { extractJsonArray } from "../lib/aiTextUtils.js"

const router = new Hono()

/** 失败标记前缀：content 存 `__FAIL__:<epochMs>`，冷却期内不再生成（防反复烧 LLM） */
const FAIL_PREFIX = "__FAIL__:"
const FAIL_COOLDOWN_MS = 10 * 60 * 1000 // 失败后 10 分钟内不重试

/** 失败标记是否仍在冷却期 */
function failInCooldown(content: string): boolean {
  if (!content.startsWith(FAIL_PREFIX)) return false
  const at = Number(content.slice(FAIL_PREFIX.length))
  if (!Number.isFinite(at)) return false
  return Date.now() - at < FAIL_COOLDOWN_MS
}

async function getCached(family: string, kind: string): Promise<string | null> {
  const row = await getDb()
    .select()
    .from(radicalContent)
    .where(and(eq(radicalContent.family, family), eq(radicalContent.kind, kind)))
    .get()
  return row?.content ?? null
}

async function saveCache(family: string, kind: string, content: string): Promise<void> {
  const now = new Date().toISOString()
  await getDb()
    .insert(radicalContent)
    .values({ family, kind, content, createdAt: now })
    .onConflictDoUpdate({ target: [radicalContent.family, radicalContent.kind], set: { content, createdAt: now } })
    .run()
}

// GET /api/v1/radical/song?family=青&chars=清,情,晴,请,睛&base=青
router.get("/song", async (c) => {
  const family = (c.req.query("family") ?? "").trim().slice(0, 4)
  const chars = (c.req.query("chars") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12)
  const base = (c.req.query("base") ?? family).trim().slice(0, 4)
  if (!family || chars.length === 0) return c.json({ detail: "缺少 family 或 chars" }, 400)

  const cached = await getCached(family, "song")
  if (cached) {
    // 失败标记：冷却期内不再生成（快速返回空，前端走"再点一次试试"的温和降级）
    if (failInCooldown(cached)) return c.json({ song: "", cached: true, failed: true })
    if (!cached.startsWith(FAIL_PREFIX)) return c.json({ song: cached, cached: true })
    // 冷却过期 → 落到下面重新生成
  }

  // 生成（免费 Ark 单链路，最多两次尝试让全部字入歌；失败快速返回）
  let song = ""
  for (let attempt = 0; attempt < 2 && !song; attempt++) {
    const hint = attempt === 1 ? "非常重要：每一个列出的字都必须至少出现一次，缺字必须重写。" : ""
    try {
      song = await deepseekChat(
        "你是儿童儿歌作家，为小学【换偏旁识字】课写儿歌。儿歌要朗朗上口、适合 6-8 岁儿童，4-6 行，每行 5-7 字。只输出儿歌文本，不要标题和解释。",
        `请写一首儿歌，必须自然地包含这些字：${chars.join("、")}。这些字都有声旁「${base}」。${hint}`,
        400,
        "radical_song",
        true,
        { arkOnly: true }
      )
    } catch {
      song = ""
    }
  }
  if (song) {
    await saveCache(family, "song", song)
  } else {
    // 失败也缓存（带时间戳）：冷却期内不再重试，避免白烧
    await saveCache(family, "song", `${FAIL_PREFIX}${Date.now()}`)
  }
  return c.json({ song, cached: false })
})

// GET /api/v1/radical/riddles?family=青&chars=清,情,晴,请,睛&count=5
router.get("/riddles", async (c) => {
  const family = (c.req.query("family") ?? "").trim().slice(0, 4)
  const chars = (c.req.query("chars") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12)
  const want = Math.max(1, Math.min(Number(c.req.query("count") ?? 5), 8))
  if (!family || chars.length === 0) return c.json({ detail: "缺少 family 或 chars" }, 400)

  // 缓存池：取出现有谜面；不够再生成补充
  let pool: Array<{ riddle: string; answer: string }> = []
  let cachedContent: string | null = null
  try {
    cachedContent = await getCached(family, "riddle")
    if (cachedContent && !cachedContent.startsWith(FAIL_PREFIX)) {
      pool = (JSON.parse(cachedContent) as Array<{ riddle: string; answer: string }>).filter((r) => r.riddle && chars.includes(r.answer))
    }
  } catch {
    pool = []
  }

  // 失败冷却期内：不算新的，直接返回现有池（可能为空 → 前端降级为普通题）
  const inCooldown = cachedContent !== null && failInCooldown(cachedContent)

  const need = want - pool.length
  if (need > 0 && !inCooldown) {
    const have = pool.map((r) => r.answer).join("、")
    for (let attempt = 0; attempt < 2 && need > pool.length; attempt++) {
      try {
        const raw = await deepseekChat(
          "你是儿童字谜作家。只输出 JSON 数组，不要解释。",
          `为声旁「${family}」的字族出 ${need + 2} 个字谜，谜底只能从这些字里选：${chars.join("、")}。${have ? `已有谜面用过的字：${have}，不要重复。` : ""}谜面 1-2 句，用偏旁含义和声旁读音做提示（如：有水能养鱼，有日天气好）。只输出 JSON 数组，格式：[{"riddle":"谜面","answer":"谜底字"}]`,
          600,
          "radical_riddle",
          true,
          { arkOnly: true }
        )
        const arr = extractJsonArray(raw)
        if (Array.isArray(arr)) {
          for (const x of arr) {
            const riddle = String((x as { riddle?: unknown })?.riddle ?? "").trim()
            const answer = String((x as { answer?: unknown })?.answer ?? "").trim()
            if (riddle && chars.includes(answer) && !pool.some((p) => p.answer === answer)) pool.push({ riddle, answer })
            if (pool.length >= want) break
          }
        }
      } catch {
        /* 生成失败则用现有池 */
      }
    }
    // 有成果写缓存；彻底无产出写失败标记（失败也缓存，冷却期内不再重试）
    if (pool.length > 0) await saveCache(family, "riddle", JSON.stringify(pool))
    else await saveCache(family, "riddle", `${FAIL_PREFIX}${Date.now()}`)
  }

  return c.json({
    riddles: pool.slice(0, want).map((r) => ({ riddle: r.riddle, answer: r.answer })),
    cached: pool.length >= want,
  })
})

export default router
