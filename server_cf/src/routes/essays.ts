/** Essays 路由 — /api/v1/essays（读 data/essays.json + DeepSeek LLM；对齐 Python routes/essays.py）
 *  Cloud 版：readJson 变 async；模块级缓存带 60s TTL（🟠6：数据更新最多延迟 60s 生效，不再装载一次永不刷新）。
 */
import { Hono } from "hono"
import { readJson, dataPath } from "../lib/jsonfile.js"
import { ttlCache } from "../lib/ttlCache.js"
import { chat } from "../lib/deepseek.js"

import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
const ESSAYS_FILE = dataPath("essays.json")

interface Essay {
  id: number
  title: string
  content: string
  gradeLevel?: number
  [k: string]: unknown
}

const essaysStore = ttlCache<Essay[]>(
  async () => {
    const data = await readJson<{ essays?: Essay[] } | Essay[]>(ESSAYS_FILE, [])
    return Array.isArray(data) ? data : data?.essays ?? []
  },
  60_000
)

const getEssays = async (): Promise<Essay[]> => essaysStore.get()

const CIRCLE_NUMS = ["①", "②", "③", "④", "⑤"]

// GET /api/v1/essays
router.get("/", async (c) => c.json({ essays: await getEssays() }))

// GET /api/v1/essays/{essay_id}
router.get("/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (Number.isNaN(id)) return c.json({ detail: "作文题目不存在" }, 404)
  const essay = (await getEssays()).find((e) => e.id === id)
  if (!essay) return c.json({ detail: "作文题目不存在" }, 404)
  return c.json({ essay })
})

// POST /api/v1/essays/structure
router.post("/structure", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.title || !body?.content) return c.json({ detail: "缺少 title/content" }, 400)
  const gradeLevel = Number(body?.gradeLevel ?? 2)
  const prompt =
    "你是写作结构设计师。给定一个作文题目，请生成一个 3-4 段的写作框架。\n" +
    "每个段落需要：label（短标题，2-4字）和 guide（一句话引导，≤15字）。\n" +
    "输出纯 JSON 数组，格式：\n" +
    '[{"label":"开头","guide":"一句话介绍主题"},{"label":"细节","guide":"描述具体的样子或特点"}]\n' +
    "要求：label 简洁好记，guide 是指引不是答案。"
  const userMsg = `题目：${body.title}\n内容：${body.content}\n年级：${gradeLevel}年级`
  try {
    const reply = await chat(prompt, userMsg, 2048, "essay_structure")
    let sections = extractJsonArray(reply)
    if (!sections.length) {
      sections = [
        { label: "开头", guide: "说说这个题目" },
        { label: "内容", guide: "多说一些细节" },
        { label: "故事", guide: "讲一件相关的事" },
        { label: "感受", guide: "你心里怎么想的" },
      ]
    }
    return c.json({ sections })
  } catch (e) {
    if ((e as { budget?: boolean }).budget) throw e
    return c.json({
      sections: [
        { label: "开头", guide: "介绍这个主题" },
        { label: "内容", guide: "说说具体内容" },
        { label: "结尾", guide: "总结你的想法" },
      ],
    })
  }
})

// POST /api/v1/essays/hint
router.post("/hint", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.title) return c.json({ detail: "缺少 title" }, 400)
  const hintTypeLabels: Record<string, string> = {
    有点累了: "学生有点累了，请给一句鼓励的话，不要提写作建议。",
    找不到词: "学生找不到合适的词语，请给2-3个相关的词语或短句提示。",
    开不了头: "学生开不了头，请给一个非常简短的开头方向或第一句话的思路。",
    没想法: "学生没想法，请给1-2个具体的内容方向提示。",
    帮我提示一下: "请根据上下文给出一个紧凑的提示，帮助学生继续往下说。",
  }
  const hintType = String(body?.hintType ?? "")
  const hintInstruction = hintTypeLabels[hintType] ?? `学生遇到困难「${hintType}」，请给出一个紧凑的提示。`

  const prompt =
    "你是面向小学生的写作思维教练。请根据作文题目、当前段落要求、学生已说内容，生成一个紧凑的写作提示。\n" +
    "要求：\n" +
    "1. 控制在25字以内；\n" +
    "2. 只给学生「脚手架」，不替他写句子；\n" +
    "3. 不要重复学生已经说过的内容；\n" +
    "4. 语气温暖鼓励。\n\n" +
    `作文题目：${body.title}\n` +
    `题目要求：${body.content ?? ""}\n` +
    `当前段落：${body.sectionLabel ?? ""} — ${body.sectionGuide ?? ""}\n` +
    `学生在该段已说：${body.studentText || "（还没开始）"}\n` +
    `学生卡住时长：${Math.floor(Number(body?.stuckDurationMs ?? 0) / 1000)}秒`
  try {
    const reply = await chat(prompt, hintInstruction, 512, "essay_hint")
    return c.json({ hint: reply.trim() })
  } catch (e) {
    if ((e as { budget?: boolean }).budget) throw e
    return c.json({ hint: "慢慢来，想到什么就说什么。加油！" })
  }
})

// POST /api/v1/essays/score
router.post("/score", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.title) return c.json({ detail: "缺少 title" }, 400)
  const sections = Array.isArray(body?.sections) ? body.sections : []
  const sectionTexts = Array.isArray(body?.sectionTexts) ? body.sectionTexts : []
  let sectionDetail = ""
  for (let i = 0; i < sections.length; i++) {
    const sec = (sections[i] ?? {}) as { label?: string; guide?: string }
    const text = String(sectionTexts[i] ?? "")
    const prefix = i < 5 ? CIRCLE_NUMS[i] : `${i + 1}.`
    sectionDetail += `${prefix}${sec.label ?? "?"}（${sec.guide ?? ""}）：${text.length}字\n`
    if (text) sectionDetail += `  内容：${text.slice(0, 100)}\n`
  }
  const prompt =
    "你是小学生写作教练。基于以下信息给成长型反馈：\n" +
    "1. 不要只给分数，要给出具体的进步点和改进建议\n" +
    "2. 表扬写得好的段落和用词\n" +
    "3. 指出哪段可以写得更丰富\n" +
    "4. 语气温暖鼓励，像教练而不是老师\n" +
    "5. 总字数控制在180字以内\n"
  const userMsg =
    `题目：${body.title}\n` +
    `题目要求：${body.content ?? ""}\n\n` +
    `段落结构与字数：\n${sectionDetail}\n` +
    `全文：\n${String(body?.finalText ?? "").slice(0, 500)}\n\n` +
    "请给出成长型反馈。"
  try {
    const reply = await chat(prompt, userMsg, 1024, "essay_score")
    return c.json({ feedback: reply.trim() })
  } catch (e) {
    if ((e as { budget?: boolean }).budget) throw e
    return c.json({ feedback: "评分服务暂时不可用，请稍后重试。" })
  }
})

// POST /api/v1/essays/format（LLM 润饰，失败 fallback 原文）
router.post("/format", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const sections = Array.isArray(body?.sections) ? body.sections : []
  const sectionTexts = Array.isArray(body?.sectionTexts) ? body.sectionTexts : []
  let sectionText = ""
  for (let i = 0; i < sections.length; i++) {
    const sec = (sections[i] ?? {}) as { label?: string; guide?: string }
    const text = String(sectionTexts[i] ?? "")
    const prefix = i < 5 ? CIRCLE_NUMS[i] : `${i + 1}.`
    sectionText += `[${prefix}${sec.label ?? "?"}] ${sec.guide ?? ""}\n`
    sectionText += (text || "（学生没有说话）") + "\n\n"
  }
  const prompt =
    "你是中文写作润饰助手。请对学生口述作文做以下处理，不要修改学生原意：\n\n" +
    "1. 学生说话已经被分成几个段落（用 ①②③ 标记）。请对每个段落内部做润饰：加入标点、合并零散句子，" +
    "但**不要把 A 段的内容挪到 B 段**。\n" +
    "2. 每段用 ① ② ③ 开头，后面空两个中文字符再开始正文\n" +
    "3. 对明显不符合中文表达习惯的地方做轻微修正，用【】标记修正处\n" +
    "4. 保持学生用词风格，不添加新内容\n" +
    "5. 如果某段学生没有说话，直接写\"（本段没有内容）\"\n\n" +
    "输出纯文本，不要JSON，不要解释。"
  const userMsg = `请按以下段落结构润饰：\n\n${sectionText}`
  try {
    const reply = await chat(prompt, userMsg, 2048, "essay_format")
    return c.json({ formatted: reply.trim() })
  } catch (e) {
    if ((e as { budget?: boolean }).budget) throw e
    const fallback = sectionTexts
      .map((t: unknown, i: number) => `${i < 5 ? CIRCLE_NUMS[i] : `${i + 1}.`}　${t || "（本段没有内容）"}`)
      .join("\n\n")
    return c.json({ formatted: fallback })
  }
})

/** 从 LLM 输出中提取 JSON 数组（容错：去掉 markdown 代码块/前后杂文） */
function extractJsonArray(raw: string): unknown[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  try {
    const v = JSON.parse(trimmed)
    if (Array.isArray(v)) return v
  } catch {
    /* continue */
  }
  const m = trimmed.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const v = JSON.parse(m[0])
      if (Array.isArray(v)) return v
    } catch {
      /* continue */
    }
  }
  return []
}

export default router
