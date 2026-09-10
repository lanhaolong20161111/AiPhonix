/** TTS 路由 — /api/v1/tts/synthesize（百度 TTS，返回 MP3 blob + R2 缓存）
 * Cloudflare 版：缓存目录固定 R2 key 前缀 data/cache/tts（对齐 server_ts 语义）。
 *
 * 2026-09-01 新增单字音频端点（解决"点一个新字就要实时打百度"）：
 * - GET /api/v1/tts/char/:char         取单字音频；两级查库，未命中默认自动合成并沉淀
 * - GET /api/v1/tts/char/:char/exists  只查不合成，返回 { exists, source }
 *
 * 两级查找（人工录音优先）：
 *   ① data/char_audio/{字}.mp3           Android 端上传的真人/人工录音，质量最高
 *   ② data/tts_char/{字}[@音节].mp3      TTS 自动沉淀库，首次点过的字写入这里
 * 未命中且 synthesize=1 → 调百度合成 → 写入 ② → 返回。
 * 结果：任何字只消耗一次百度配额，之后全是纯 R2 读（不调百度、不耗 CPU）。
 */
import { Hono } from "hono"
import { getConfig } from "../env.js"
import { BaiduTTSService } from "../lib/baiduTts.js"
import { DoubaoTTSService } from "../lib/doubaoAudio.js"
import { dataPath } from "../lib/jsonfile.js"
import { exists, readBlob, writeBlob } from "../lib/storage.js"
import { requireAuth } from "../middleware/auth.js"
import { lookupPreGenerated, lookupPoemTts } from "../lib/preGeneratedTts.js"
import { synthesizeStream } from "../lib/baiduTtsStream.js"

const router = new Hono()

let svc: BaiduTTSService | null = null
let svcKey = ""
function getTts(): BaiduTTSService | null {
  const cfg = getConfig()
  if (!cfg.baidu_tts.api_key || !cfg.baidu_tts.secret_key) return null
  const cacheDir = cfg.baidu_tts.cache_dir ? cfg.baidu_tts.cache_dir : "data/cache/tts"
  // 以密钥快照为键：仅在 secret/config 实际变化时重建。
  // 保留实例内 25h 有效的百度 access token 缓存（不可每请求重建，否则每请求都重新拉 token）。
  const key = `${cfg.baidu_tts.app_id}|${cfg.baidu_tts.api_key}|${cfg.baidu_tts.secret_key}|${cacheDir}`
  if (!svc || svcKey !== key) {
    svc = new BaiduTTSService(cfg.baidu_tts.app_id, cfg.baidu_tts.api_key, cfg.baidu_tts.secret_key, cacheDir)
    svcKey = key
  }
  return svc
}

let dsvc: DoubaoTTSService | null = null
let dsvcKey = ""
function getDoubao(): DoubaoTTSService | null {
  const cfg = getConfig()
  if (!cfg.volc_tts.api_key) return null
  const key = `${cfg.volc_tts.api_key}|${cfg.volc_tts.engine}`
  if (!dsvc || dsvcKey !== key) {
    dsvc = new DoubaoTTSService(cfg.volc_tts.api_key, cfg.volc_tts.engine, cfg.volc_tts.cache_dir)
    dsvcKey = key
  }
  return dsvc
}

// ── 单字音频库 ──
/** ① 人工录音库（写入方：POST /api/v1/char-images/audio，Android 端） */
const RECORD_DIR = dataPath("char_audio")
/** ② TTS 自动沉淀库（写入方：本文件 /tts/char 端点） */
const CHAR_DIR = dataPath("tts_char")

/** 单字符白名单：汉字 / 字母 / 数字 / 带声调拼音字母。
 * 既防路径穿越（..  /  \），也防把整句塞进来污染单字库。 */
const SINGLE_CHAR_RE = /^[\u4e00-\u9fffA-Za-z0-9\u00c0-\u02af]$/
/** 百度数字调音节：zhong4 / hao3 / e5（与 web/src/lib/ttsPinyin.ts 的 BAIDU_SYL 同义） */
const SYLLABLE_RE = /^[a-z]{1,6}[1-5]$/

/** 单字文件名：默认 "{字}.mp3"；锁定读音时 "{字}@{音节}.mp3" */
function charFile(char: string, syllable = ""): string {
  const safe = char.replace(/[/\\:]/g, "_")
  return syllable ? `${safe}@${syllable}.mp3` : `${safe}.mp3`
}

function mp3Resp(data: ArrayBuffer | Uint8Array, source: string): Response {
  return new Response(data as ArrayBuffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      // 单字音频内容永不变化，可长缓存；首次合成的也直接落库，下次同源命中
      "Cache-Control": "public, max-age=86400",
      "X-Tts-Source": source,
    },
  })
}

/** 两级查库，返回 { data, source }；未命中返回 null */
async function lookupChar(char: string, syllable: string): Promise<{ data: ArrayBuffer; source: string } | null> {
  const recKey = `${RECORD_DIR}/${charFile(char)}`
  if (await exists(recKey)) {
    const data = await readBlob(recKey)
    if (data) return { data, source: "recording" }
  }
  const data = await readBlob(`${CHAR_DIR}/${charFile(char, syllable)}`)
  if (data) return { data, source: "cached" }
  return null
}

/**
 * 校验单字参数。
 * @returns ok=true 时 char 已过白名单、syllable 为空或合法数字调音节
 */
function parseCharParams(char: string, pinyinRaw: string | undefined):
  | { ok: true; char: string; syllable: string }
  | { ok: false } {
  if (!SINGLE_CHAR_RE.test(char)) return { ok: false }
  const raw = (pinyinRaw ?? "").trim().toLowerCase()
  return { ok: true, char, syllable: SYLLABLE_RE.test(raw) ? raw : "" }
}

const BAD_CHAR_RES = () =>
  new Response(JSON.stringify({ detail: "只支持单个汉字 / 字母 / 数字" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  })

// POST /api/v1/tts/synthesize
router.post("/tts/synthesize", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "")
  const speaker = String(body?.speaker ?? "6221")
  const speed = Number(body?.speed ?? 5)
  /** 引擎：baidu（默认，预生成库→百度实时）| doubao（豆包 TTS，失败回退百度） */
  const engine = body?.engine === "doubao" ? "doubao" : "baidu"
  /** 指定音色场景（如古诗朗读）跳过预生成库，直接用所请求音色合成 */
  const avoidPregen = body?.avoidPregen === true || body?.avoidPregen === "true"
  if (!text) return c.json({ detail: "文本不能为空" }, 422)

  // 豆包引擎：跳过预生成库（库内为 Tim 童声，音色不一致）；缓存/合成在 DoubaoTTSService 内部，
  // Cloudflare 子请求墙 ~30s，外呼 25s 超时即弃并回退百度，保证响应及时、页面不哑火。
  if (engine === "doubao") {
    const doubao = getDoubao()
    if (doubao) {
      try {
        const audio = await doubao.synthesize(text, 25_000)
        return new Response(audio, {
          headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600", "X-Tts-Source": "doubao" },
        })
      } catch (e) {
        console.warn(`[tts] 豆包引擎失败，回退百度: ${(e as Error).message}`)
      }
    } else {
      console.warn("[tts] 未配置豆包 TTS（VOLC_TTS_API_KEY），回退百度")
    }
  } else if (speaker === "3") {
    // 古诗音色（度逍遥）：先查古诗预生成库（原文句子，0 延迟命中）；未命中直接合成该音色
    // （不查通用预生成库——那是童声，音色不一致）
    const poem = await lookupPoemTts(text)
    if (poem) {
      return new Response(poem.data, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Tts-Source": poem.source,
        },
      })
    }
  } else if (!avoidPregen) {
    // 百度引擎：优先播放预生成缓存（当前仅单汉字 data/tts_char；英文库已于 2026-09-10 删除），
    // 命中后不再调用百度实时合成；未命中才继续走原有百度 TTS，保持旧功能不变。
    // （avoidPregen=true 时跳过预生成库，保证按请求音色朗读，如古诗用度逍遥）
    const preGenerated = await lookupPreGenerated(text)
    if (preGenerated) {
      return new Response(preGenerated.data, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Tts-Source": preGenerated.source,
        },
      })
    }
  }

  const tts = getTts()
  if (!tts) return c.json({ detail: "服务端未配置百度 TTS" }, 500)
  try {
    const audio = await tts.synthesize(text, speaker, speed)
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600" } })
  } catch (e) {
    return c.json({ detail: `TTS 合成失败: ${(e as Error).message}` }, 500)
  }
})

// ── 单字音频 ──
// GET /api/v1/tts/char/:char?synthesize=1&pinyin=hao3
// 先查两级音频库；未命中且 synthesize=1（默认）时自动合成并沉淀到 data/tts_char。
router.get("/tts/char/:char", requireAuth(), async (c) => {
  const parsed = parseCharParams(c.req.param("char"), c.req.query("pinyin"))
  if (!parsed.ok) return BAD_CHAR_RES()
  const { char, syllable } = parsed

  // 对单字端点也优先查火山预生成库。带 pinyin 的请求暂不命中，
  // 因为预生成文件名按原字保存，需保留原有百度注音语法以锁定指定读音。
  if (!syllable) {
    const preGenerated = await lookupPreGenerated(char)
    if (preGenerated) return mp3Resp(preGenerated.data, preGenerated.source)
  }

  const hit = await lookupChar(char, syllable)
  if (hit) return mp3Resp(hit.data, hit.source)

  if (c.req.query("synthesize") === "0") {
    return c.json({ detail: "该字暂无音频", char }, 404)
  }

  const tts = getTts()
  if (!tts) return c.json({ detail: "服务端未配置百度 TTS" }, 500)
  try {
    // 锁定读音时用百度注音语法 字(hao3)；否则直接送单字
    const tex = syllable ? `${char}(${syllable})` : char
    const buf = await tts.synthesize(tex, "6221", 5)
    const bytes = new Uint8Array(buf)
    // 沉淀失败不能影响本次播放（R2 偶发写失败就下次再沉淀）
    try {
      await writeBlob(`${CHAR_DIR}/${charFile(char, syllable)}`, bytes, "audio/mpeg")
    } catch {
      /* ignore */
    }
    return mp3Resp(bytes, "synthesized")
  } catch (e) {
    return c.json({ detail: `TTS 合成失败: ${(e as Error).message}` }, 500)
  }
})

// GET /api/v1/tts/char/:char/exists — 只查不合成，前端可据此显示"已有录音"标记
router.get("/tts/char/:char/exists", async (c) => {
  const parsed = parseCharParams(c.req.param("char"), c.req.query("pinyin"))
  if (!parsed.ok) return BAD_CHAR_RES()
  const { char, syllable } = parsed
  const hit = await lookupChar(char, syllable)
  return c.json({ exists: hit !== null, source: hit?.source ?? null })
})

// POST /api/v1/tts/stream — 百度流式文本在线合成（边合成边下发 mp3 分片，降低首音延迟）
// body 同 /tts/synthesize；doubao 引擎不支持流式 → 返回 409 由前端回退普通合成。
router.post("/tts/stream", requireAuth(), async (c) => {
  const body = await c.req.json().catch(() => null)
  const text = String(body?.text ?? "")
  const speaker = String(body?.speaker ?? "6221")
  const speed = Number(body?.speed ?? 5)
  const avoidPregen = body?.avoidPregen === true || body?.avoidPregen === "true"
  if (!text) return c.json({ detail: "文本不能为空" }, 422)
  if (body?.engine === "doubao") return c.json({ detail: "doubao 引擎不支持流式合成", fallback: true }, 409)

  // 预生成库命中 → 直接返回整段（无需流式）
  if (speaker === "3") {
    const poem = await lookupPoemTts(text)
    if (poem) return new Response(poem.data, { headers: { "Content-Type": "audio/mpeg", "X-Tts-Source": poem.source } })
  } else if (!avoidPregen) {
    const preGenerated = await lookupPreGenerated(text)
    if (preGenerated) return new Response(preGenerated.data, { headers: { "Content-Type": "audio/mpeg", "X-Tts-Source": preGenerated.source } })
  }

  try {
    const stream = await synthesizeStream(text, speaker, speed)
    return new Response(stream, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Tts-Stream": "1" },
    })
  } catch (e) {
    // 流式不可用 → 交回前端走普通合成
    return c.json({ detail: `流式合成失败: ${(e as Error).message}`, fallback: true }, 502)
  }
})

export default router
