/** 字幕截图采集路由 — /api/v1/subtitle-capture
 * 1) capture：接收前端截取的影片字幕区域图片 + 元信息，存到 R2 data/subtitle_captures/，
 *    并维护 manifest.json 索引（序号、精确时间戳、影片信息等）。
 * 2) auto-evaluate：暂停即自动截屏 → 豆包识图拿到字幕原文 → LLM 做翻译+语法纠错+讲解，
 *    结果返回前端在「测评区」展示，并带 TTS 朗读。
 * Cloudflare 版：fs → R2（readBlob/writeBlob/writeText/exists/removeBlob），语义对齐 server_ts。
 */
import { Hono } from "hono"
import { getArk } from "../lib/ark.js"
import { chat as deepseekChat } from "../lib/deepseek.js"
import { exists, readBlob, readText, writeBlob, writeText, removeBlob } from "../lib/storage.js"
import { requireAuth } from "../middleware/auth.js"

const router = new Hono()
// 字幕采集全部为用户级写入/读取/删除：统一要求登录，杜绝匿名删除与匿名烧 LLM 配额
router.use(requireAuth())
const CAPTURE_DIR = "data/subtitle_captures"
const MANIFEST_KEY = `${CAPTURE_DIR}/manifest.json`

interface EvalResult {
  subtitle_text: string
  translation: string
  grammar_corrections: { original: string; corrected: string; reason: string }[]
  explanation: string
  evaluated_at: string
}

interface CaptureMeta {
  seq: number
  file_name: string
  movie_name: string
  timestamp_ms: number
  timestamp_text: string
  video_width: number
  video_height: number
  crop: { x: number; y: number; w: number; h: number }
  crop_width: number
  crop_height: number
  note: string
  created_at: string
  eval?: EvalResult // LLM 识别+翻译+纠错结果缓存，按时间戳与截图关联
}

interface Manifest {
  captures: CaptureMeta[]
}

async function readManifest(): Promise<Manifest> {
  if (!(await exists(MANIFEST_KEY))) return { captures: [] }
  try {
    const raw = await readText(MANIFEST_KEY)
    if (!raw) return { captures: [] }
    const parsed = JSON.parse(raw)
    return { captures: Array.isArray(parsed.captures) ? parsed.captures : [] }
  } catch {
    return { captures: [] }
  }
}

async function writeManifest(m: Manifest): Promise<void> {
  await writeText(MANIFEST_KEY, JSON.stringify(m, null, 2), "application/json")
}

function fmtTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const millis = ms % 1000
  const pad = (n: number, l = 2) => String(n).padStart(l, "0")
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`
}

function safeName(name: string): string {
  return name.replace(/[^\w一-龥.-]/g, "_").slice(0, 40) || "movie"
}

// 解析 multipart 表单里的 meta（兼容字符串 / Blob 文件两种上传方式）
async function parseMeta(form: FormData): Promise<Record<string, any>> {
  const metaRaw = form.get("meta")
  try {
    if (typeof metaRaw === "string") return JSON.parse(metaRaw)
    if (metaRaw && typeof (metaRaw as Blob).arrayBuffer === "function") {
      const txt = new TextDecoder("utf-8").decode(await (metaRaw as Blob).arrayBuffer())
      return JSON.parse(txt)
    }
  } catch {
    /* ignore */
  }
  return {}
}

// 存盘 + 写 manifest，返回记录与文件 key。供 capture / auto-evaluate 复用。
async function saveCapture(
  data: Uint8Array,
  meta: Record<string, any>
): Promise<{ rec: CaptureMeta; path: string }> {
  const timestampMs = Math.max(0, Number(meta.timestamp_ms) || 0)
  const movieName = String(meta.movie_name ?? "unknown").slice(0, 256)
  const note = String(meta.note ?? "").slice(0, 500)
  const videoWidth = Number(meta.video_width) || 0
  const videoHeight = Number(meta.video_height) || 0
  const crop = {
    x: Number(meta.crop?.x) || 0,
    y: Number(meta.crop?.y) || 0,
    w: Number(meta.crop?.w) || 0,
    h: Number(meta.crop?.h) || 0,
  }
  const cropWidth = Number(meta.crop_width) || 0
  const cropHeight = Number(meta.crop_height) || 0

  const manifest = await readManifest()
  const seq = manifest.captures.length
    ? Math.max(...manifest.captures.map((x) => x.seq)) + 1
    : 1

  const fileName = `${fmtTimestamp(timestampMs).replace(/[:.]/g, "")}-${safeName(movieName)}-${String(seq).padStart(4, "0")}.png`
  const path = `${CAPTURE_DIR}/${fileName}`
  await writeBlob(path, data, "image/png")

  const rec: CaptureMeta = {
    seq,
    file_name: fileName,
    movie_name: movieName,
    timestamp_ms: timestampMs,
    timestamp_text: fmtTimestamp(timestampMs),
    video_width: videoWidth,
    video_height: videoHeight,
    crop,
    crop_width: cropWidth,
    crop_height: cropHeight,
    note,
    created_at: new Date().toISOString(),
  }
  manifest.captures.push(rec)
  await writeManifest(manifest)
  return { rec, path }
}

// ── POST /subtitle-capture/capture ── 仅存盘，不做识别
router.post("/subtitle-capture/capture", async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ detail: "缺少文件或表单" }, 400)
  const file = form.get("file")
  if (!file || typeof file === "string") return c.json({ detail: "缺少图片文件" }, 400)
  const data = new Uint8Array(await (file as File).arrayBuffer())
  if (!data.length) return c.json({ detail: "图片为空" }, 422)

  const meta = await parseMeta(form)
  const { rec } = await saveCapture(data, meta)
  return c.json({
    status: "ok",
    seq: rec.seq,
    file_name: rec.file_name,
    timestamp_text: rec.timestamp_text,
    url: `/api/v1/subtitle-capture/file/${rec.file_name}`,
    total: (await readManifest()).captures.length,
  })
})

// ── POST /subtitle-capture/auto-evaluate ── 暂停即自动：识图 + 翻译 + 语法纠错 + 讲解
const OCR_PROMPT =
  "这是一段影视剧字幕截图，请只转录字幕里的原文文字（逐行，不要解释、不要翻译）。如果是英文请保留英文原文。"

async function evaluateSubtitle(imagePath: string, lang: "en" | "zh"): Promise<{
  subtitle_text: string
  translation: string
  grammar_corrections: { original: string; corrected: string; reason: string }[]
  explanation: string
}> {
  // 1) 豆包识图拿字幕原文（imagePath 为 R2 key）
  let subtitle = ""
  try {
    console.error("[subcap-eval] 开始豆包识图:", imagePath)
    const reply = await getArk().chat({
      prompt: OCR_PROMPT,
      image_paths: [imagePath],
      max_tokens: 1024,
      model_override: "doubao-seed-evolving",
      disable_thinking: true,
    })
    console.error("[subcap-eval] 识图返回长度:", (reply || "").length)
    subtitle = (reply || "").trim()
  } catch (e) {
    console.warn(`[subtitle-capture] 识图失败: ${(e as Error).message}`)
  }
  if (!subtitle) {
    return { subtitle_text: "", translation: "", grammar_corrections: [], explanation: "识图失败：未从截图中识别出字幕文字。" }
  }

  // 2) LLM 翻译 + 语法/语义纠错 + 讲解
  const sys = "你是一位严谨的英语/语文老师，擅长字幕翻译、语法纠错与语义讲解。只输出 JSON，不要 markdown 包裹。"
  const userPrompt =
    (lang === "en"
      ? "下面是一句影视英文字幕原文。请输出 JSON：\n"
      : "下面是一句中文字幕原文。请输出 JSON：\n") +
    `{"subtitle_text":"原文","translation":"中文翻译","grammar_corrections":[{"original":"原文中有误或可优化片段","corrected":"修正后","reason":"简短说明"}],"explanation":"一句语义/语境讲解，帮助学生理解"}\n` +
    `字幕原文：\n${subtitle}\n` +
    "要求：grammar_corrections 最多列 3 处；若无误则为空数组；explanation 不超过 60 字。"

  let parsed: any = {}
  try {
    const reply = await getArk().chat({
      prompt: userPrompt,
      system_prompt: sys,
      max_tokens: 1024,
      model_override: "doubao-seed-evolving",
      disable_thinking: true,
    })
    parsed = JSON.parse((reply || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""))
  } catch {
    try {
      const reply = await deepseekChat(sys, userPrompt, 1024, "subtitle_eval")
      parsed = JSON.parse((reply || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""))
    } catch (e) {
      console.warn(`[subtitle-capture] LLM 评测失败: ${(e as Error).message}`)
    }
  }

  return {
    subtitle_text: String(parsed.subtitle_text ?? subtitle).trim(),
    translation: String(parsed.translation ?? "").trim(),
    grammar_corrections: Array.isArray(parsed.grammar_corrections)
      ? parsed.grammar_corrections
          .filter((g: any) => g && g.original && g.corrected)
          .slice(0, 3)
          .map((g: any) => ({
            original: String(g.original),
            corrected: String(g.corrected),
            reason: String(g.reason ?? ""),
          }))
      : [],
    explanation: String(parsed.explanation ?? "").trim(),
  }
}

// 按 timestamp_ms 在同影片下查找已存在的 capture（用于缓存命中）
async function findExistingByTs(movieName: string, tsMs: number): Promise<CaptureMeta | null> {
  const manifest = await readManifest()
  const hit = manifest.captures.find(
    (x) => x.movie_name === movieName && Math.abs(x.timestamp_ms - tsMs) < 500
  )
  return hit ?? null
}

router.post("/subtitle-capture/auto-evaluate", async (c) => {
  try {
    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ detail: "缺少文件或表单" }, 400)
    const file = form.get("file")
    if (!file || typeof file === "string") return c.json({ detail: "缺少图片文件" }, 400)
    const data = new Uint8Array(await (file as File).arrayBuffer())
    if (!data.length) return c.json({ detail: "图片为空" }, 422)

    const meta = await parseMeta(form)
    const lang: "en" | "zh" = meta.lang === "zh" ? "zh" : "en"
    const force = String(meta.force ?? "false") === "true"
    const movieName = String(meta.movie_name ?? "unknown").slice(0, 256)
    const tsMs = Math.max(0, Number(meta.timestamp_ms) || 0)

    // 缓存命中：同影片+同时间戳已评测过且非强制 → 复用，不调 LLM
    if (!force) {
      const existing = await findExistingByTs(movieName, tsMs)
      if (existing && existing.eval) {
        return c.json({
          status: "ok",
          cached: true,
          seq: existing.seq,
          file_name: existing.file_name,
          timestamp_text: existing.timestamp_text,
          url: `/api/v1/subtitle-capture/file/${existing.file_name}`,
          movie_name: existing.movie_name,
          ...existing.eval,
        })
      }
    }

    // 先存盘（截图保留，便于回看）
    const { rec, path } = await saveCapture(data, meta)

    // 再识别 + 评测
    const evalResult = await evaluateSubtitle(path, lang)
    const evalRec: EvalResult = { ...evalResult, evaluated_at: new Date().toISOString() }

    // 写回 manifest（按 seq 关联）
    const manifest = await readManifest()
    const idx = manifest.captures.findIndex((x) => x.seq === rec.seq)
    if (idx >= 0) {
      manifest.captures[idx].eval = evalRec
      await writeManifest(manifest)
    }

    return c.json({
      status: "ok",
      cached: false,
      seq: rec.seq,
      file_name: rec.file_name,
      timestamp_text: rec.timestamp_text,
      url: `/api/v1/subtitle-capture/file/${rec.file_name}`,
      movie_name: rec.movie_name,
      ...evalResult,
    })
  } catch (e) {
    console.error("[subtitle-capture] auto-evaluate 失败:", e)
    return c.json({ detail: "auto-evaluate 失败: " + (e as Error).message }, 500)
  }
})

// ── POST /subtitle-capture/re-evaluate ── 用已存截图按 seq 重跑 LLM（强制刷新缓存）
router.post("/subtitle-capture/re-evaluate", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const seq = Number(body.seq)
    const lang: "en" | "zh" = body.lang === "zh" ? "zh" : "en"
    if (!seq) return c.json({ detail: "缺少 seq" }, 400)
    const manifest = await readManifest()
    const idx = manifest.captures.findIndex((x) => x.seq === seq)
    if (idx < 0) return c.json({ detail: "未找到该截图" }, 404)
    const rec = manifest.captures[idx]
    const imgKey = `${CAPTURE_DIR}/${rec.file_name}`
    if (!(await exists(imgKey))) return c.json({ detail: "截图文件不存在" }, 404)

    const evalResult = await evaluateSubtitle(imgKey, lang)
    const evalRec: EvalResult = { ...evalResult, evaluated_at: new Date().toISOString() }
    manifest.captures[idx].eval = evalRec
    await writeManifest(manifest)

    return c.json({
      status: "ok",
      seq: rec.seq,
      file_name: rec.file_name,
      timestamp_text: rec.timestamp_text,
      url: `/api/v1/subtitle-capture/file/${rec.file_name}`,
      movie_name: rec.movie_name,
      ...evalResult,
    })
  } catch (e) {
    console.error("[subtitle-capture] re-evaluate 失败:", e)
    return c.json({ detail: "re-evaluate 失败: " + (e as Error).message }, 500)
  }
})

// ── GET /subtitle-capture/list ──
router.get("/subtitle-capture/list", async (c) => {
  const manifest = await readManifest()
  const items = manifest.captures.map((x) => ({
    ...x,
    url: `/api/v1/subtitle-capture/file/${x.file_name}`,
  }))
  return c.json({ total: items.length, items })
})

// ── GET /subtitle-capture/file/:fileName ──
router.get("/subtitle-capture/file/:fileName", async (c) => {
  const fileName = c.req.param("fileName").split(/[\\/]/).pop() || ""
  const key = `${CAPTURE_DIR}/${fileName}`
  if (!(await exists(key))) return c.json({ detail: "文件不存在" }, 404)
  const data = await readBlob(key)
  if (!data) return c.json({ detail: "文件不存在" }, 404)
  return new Response(data, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  })
})

// ── DELETE /subtitle-capture/:seq ── 删除单条采集（删 manifest 条目 + 删截图文件）
router.delete("/subtitle-capture/:seq", async (c) => {
  try {
    const seq = Number(c.req.param("seq"))
    if (!seq) return c.json({ detail: "缺少 seq" }, 400)
    const manifest = await readManifest()
    const idx = manifest.captures.findIndex((x) => x.seq === seq)
    if (idx < 0) return c.json({ detail: "未找到该截图" }, 404)
    const [removed] = manifest.captures.splice(idx, 1)
    await writeManifest(manifest)
    // 删除截图文件（尽力而为，失败不阻断）
    if (removed?.file_name) {
      const imgKey = `${CAPTURE_DIR}/${removed.file_name}`
      if (await exists(imgKey)) {
        await removeBlob(imgKey).catch(() => {})
      }
    }
    return c.json({ status: "ok", seq: removed?.seq, total: manifest.captures.length })
  } catch (e) {
    console.error("[subtitle-capture] 删除失败:", e)
    return c.json({ detail: "删除失败: " + (e as Error).message }, 500)
  }
})

// ── POST /subtitle-capture/batch-export ── 导出清单（供后续批量处理）
router.post("/subtitle-capture/batch-export", async (c) => {
  const manifest = await readManifest()
  const list = manifest.captures.map((x) => ({
    seq: x.seq,
    file_name: x.file_name,
    timestamp_ms: x.timestamp_ms,
    timestamp_text: x.timestamp_text,
    movie_name: x.movie_name,
  }))
  const exportKey = `${CAPTURE_DIR}/batch_export_${Date.now()}.json`
  await writeText(exportKey, JSON.stringify(list, null, 2), "application/json")
  return c.json({ status: "ok", count: list.length, file: exportKey, items: list })
})

export default router
