/** 腾讯云智聆 SOE 语音评测 — Cloudflare 版：原生 WebSocket（替代 ws 包），签名与结果转换不变 */
import { createHmac } from "node:crypto"
import { randomUUID } from "node:crypto"

function hmacSha1Base64(key: string, message: string): string {
  return createHmac("sha1", key).update(message).digest("base64")
}

export class TencentSOEService {
  constructor(private appId: string, private secretId: string, private secretKey: string) {}

  private resolveEvalMode(scene: string, evalMode: string, refText: string, isZh: boolean): [string, number] {
    if (scene) {
      const mapping: Record<string, [string, number]> = {
        word: ["0", 30],
        sentence: ["1", 120],
        paragraph: ["2", 120],
        pinyin: ["8", 30],
      }
      const m = mapping[scene]
      if (m) return m
    }
    if (evalMode === "8") return ["8", 30]
    if (["0", "1", "2"].includes(evalMode)) {
      return [evalMode, { "0": 30, "1": 120, "2": 120 }[evalMode] ?? 120]
    }
    if (isZh) {
      const charCount = [...refText].filter((c) => c >= "\u4e00" && c <= "\u9fff").length
      if (charCount <= 1) return ["0", 1]
      if (charCount <= 30) return ["1", 120]
      return ["2", 120]
    }
    const words = refText.replace(/,/g, " ").replace(/\./g, " ").split(/\s+/).filter(Boolean)
    if (words.length === 1) return ["0", 30]
    if (words.length <= 30) return ["1", 30]
    return ["2", 120]
  }

  /** 清理 SOE 参考文本里发音库不认识的字符：
   * 中文场景保留汉字+安全标点（去拉丁字母/数字/生僻符号）；
   * 英文场景去掉 CJK 与非常规符号。返回净化后的文本（可能为空）。 */
  private sanitizeRefText(text: string, isZh: boolean): string {
    if (isZh) {
      // 允许保留的中文/半角标点（字符类里直接写引号是合法的，避免写进字符串字面量导致提前收尾）
      const keep = (c: string): boolean => {
        const cp = c.codePointAt(0)!
        if (cp >= 0x4e00 && cp <= 0x9fff) return true
        if (/\s/.test(c)) return true
        return /[，。！？、；：（）《》""''…—·,.!?;:()]/.test(c)
      }
      const out = [...text].filter(keep).join("")
      return out.replace(/\s+/g, " ").trim()
    }
    return text.replace(/[^A-Za-z0-9\s'.,!?;:()\-]/g, " ").replace(/\s+/g, " ").trim()
  }

  /** 把中文参考文本转成拼音（text_mode=1 用），非中文字符丢弃。pinyin-pro 不可用时返回 null。 */
  private async zhToPinyin(text: string): Promise<string | null> {
    try {
      const mod: any = await import("pinyin-pro")
      const fn = mod?.pinyin ?? mod?.default?.pinyin
      if (typeof fn !== "function") return null
      const arr = fn(text, { toneType: "num", type: "array", nonZh: "removed" }) as string[]
      const out = (Array.isArray(arr) ? arr : []).filter(Boolean).join(" ")
      return out || null
    } catch {
      return null
    }
  }

  /** 单次评测（已解析 engine / eval_mode / text_mode）。4103 RefTextOOV 等错误以 reject 抛出。 */
  private assess(
    refText: string,
    audioBase64: string,
    engine: string,
    evalModeVal: string,
    textMode: string,
  ): Promise<{
    engine: string
    eval_mode: string
    pron_accuracy: number
    pron_fluency: number
    pron_completion: number
    suggested_score: number
    words: unknown[]
  }> {
    const voiceId = randomUUID()
    const ts = String(Math.floor(Date.now() / 1000))
    const params: Record<string, string> = {
      secretid: this.secretId,
      timestamp: ts,
      expired: String(Math.floor(Date.now() / 1000) + 86400),
      nonce: ts,
      voice_id: voiceId,
      voice_format: "1",
      text_mode: textMode,
      ref_text: refText,
      keyword: "",
      eval_mode: evalModeVal,
      score_coeff: "1.0",
      server_engine_type: engine,
      sentence_info_enabled: "1",
      rec_mode: "1",
    }

    const keys = Object.keys(params).sort()
    const rawParts = keys.map((k) => `${k}=${params[k]}`)
    const rawQuery = rawParts.join("&")
    // workerd 的 fetch 会对 URL 重新编码：非 ASCII 字符必须保持原样交给它按规范编码一次，
    // 若先 encodeURIComponent 会变成 %E6.. -> %25E6 双重编码，腾讯解码后 RefText 变乱码（4102）
    const encQ = (s: string) =>
      s
        .replace(/%/g, "%25")
        .replace(/&/g, "%26")
        .replace(/=/g, "%3D")
        .replace(/\+/g, "%2B")
        .replace(/\?/g, "%3F")
        .replace(/#/g, "%23")
        .replace(/ /g, "%20")
    const uv = keys.map((k) => `${encodeURIComponent(k)}=${encQ(params[k])}`).join("&")
    // 签名串固定用 soe.cloud.tencent.com；fetch 升级连接必须用 https://（workerd 不接受 wss:// scheme）
    const signStr = `soe.cloud.tencent.com/soe/api/${this.appId}?${rawQuery}`
    const signature = hmacSha1Base64(this.secretKey, signStr)

    const fetchUrl = `https://soe.cloud.tencent.com/soe/api/${this.appId}?${uv}&signature=${encodeURIComponent(signature)}`

    const audioRaw = new Uint8Array(Buffer.from(audioBase64, "base64"))
    // 腾讯要求音频长度为偶数（16bit 采样），奇数会报 4107；去掉末尾字节不影响 mp3 解码
    const audioData = audioRaw.length % 2 === 1 ? audioRaw.subarray(0, audioRaw.length - 1) : audioRaw

    return new Promise((resolve, reject) => {
      let settled = false
      let result: any = null
      let ws: WebSocket | null = null
      // workerd 出站 WebSocket：fetch + Upgrade 头（new WebSocket() 在 Workers 不可用）
      const connect = fetch(fetchUrl, {
        headers: { Upgrade: "websocket" },
      }).then((resp) => {
        if (!resp.webSocket) {
          throw new Error(`SOE 握手被拒绝（HTTP ${resp.status}）`)
        }
        const sock = resp.webSocket
        ws = sock
        sock.accept()

        sock.addEventListener("message", (ev: MessageEvent) => {
          if (settled) return
          try {
            const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
            const respJson = JSON.parse(text)
            if (typeof respJson.code !== "undefined" && respJson.code !== 0) {
              settled = true
              try { sock.close() } catch { /* 已关闭 */ }
              reject(new Error(`SOE 服务端错误: code=${respJson.code} msg=${respJson.message}`))
              return
            }
            if (typeof respJson.final !== "undefined" && respJson.final === 1) {
              result = respJson.result ?? {}
              settled = true
              try { sock.close() } catch { /* 已关闭 */ }
              try {
                resolve(this.transformResult(result, engine, evalModeVal))
              } catch (e) {
                reject(e as Error)
              }
              return
            }
            // 握手响应（code==0 且无 final）→ 发送音频 + 结束标记
            if (!result) {
              sock.send(audioData)
              sock.send(JSON.stringify({ type: "end" }))
            }
          } catch (e) {
            settled = true
            try { sock.close() } catch { /* 已关闭 */ }
            reject(new Error(`SOE 消息解析失败: ${(e as Error).message}`))
          }
        })

        sock.addEventListener("error", () => {
          if (settled) return
          settled = true
          reject(new Error("WebSocket 连接失败"))
        })

        sock.addEventListener("close", () => {
          if (settled) return
          settled = true
          reject(new Error("SOE 评测无返回结果"))
        })
      }).catch((e) => {
        if (settled) return
        settled = true
        reject(new Error(`WebSocket 连接失败: ${(e as Error).message}`))
      })

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          try { ws?.close() } catch { /* 已关闭 */ }
          reject(new Error("SOE 评测超时（30 秒）"))
        }
      }, 30000)
      timer.unref?.()
      void connect
    })
  }

  async evaluate(refText: string, audioBase64: string, engine = "", evalMode = "", scene = ""): Promise<{
    engine: string
    eval_mode: string
    pron_accuracy: number
    pron_fluency: number
    pron_completion: number
    suggested_score: number
    words: unknown[]
  }> {
    if (!engine) {
      if (scene === "pinyin") engine = "16k_zh"
      else engine = /[\u4e00-\u9fff]/.test(refText) ? "16k_zh" : "16k_en"
    }
    const isZh = engine === "16k_zh"

    const [evalModeVal, maxRefLen] = this.resolveEvalMode(scene, evalMode, refText, isZh)
    const trimmed = refText.length > maxRefLen ? refText.slice(0, maxRefLen) : refText

    const tryOnce = (text: string, textMode: string) => this.assess(text, audioBase64, engine, evalModeVal, textMode)

    try {
      return await tryOnce(trimmed, "0")
    } catch (e) {
      const msg = (e as Error).message || ""
      // 非 OOV 类错误（网络/超时/音频问题）直接抛出，不做降级
      if (!/4103|OOV/i.test(msg)) throw e
      // 第 1 次重试：去掉发音库不认识的字符（拉丁字母/数字/生僻符号），只留中文+安全标点，仍走文本模式
      const sanitized = this.sanitizeRefText(trimmed, isZh)
      if (sanitized && sanitized !== trimmed) {
        try {
          return await tryOnce(sanitized, "0")
        } catch (e2) {
          if (!/4103|OOV/i.test((e2 as Error).message || "")) throw e2
        }
      }
      // 第 2 次重试：音素模式（text_mode=1），用 pinyin-pro 把中文转拼音后评测
      if (isZh) {
        const py = await this.zhToPinyin(sanitized || trimmed)
        if (py) return await tryOnce(py, "1")
      }
      // 所有重试仍失败：给一个友好提示，前端可引导用户跳过此句
      throw new Error("该句含发音库无法识别的生僻字或符号，暂时无法评分（可跳过此句）")
    }
  }

  private transformResult(result: any, engine: string, evalModeVal: string) {
    const words: any[] = []
    for (const w of result.Words ?? []) {
      let tone: { ref: unknown; hyp: unknown } | null = null
      const t = w.Tone
      if (t && typeof t === "object") {
        tone = { ref: t.RefTone, hyp: t.HypothesisTone }
      } else if (w.RefTone !== undefined && w.RefTone !== null) {
        tone = { ref: w.RefTone, hyp: w.HypothesisTone }
      }
      const phoneItems = w.PhoneInfos ?? w.PhoneInfo ?? []
      const phones = (Array.isArray(phoneItems) ? phoneItems : [])
        .filter((p: any) => p && typeof p === "object")
        .map((p: any) => ({
          phone: String(p.Phone ?? "") || String(p.Word ?? "") || String(p.RefPhone ?? "") || "",
          reference_phone: String(p.ReferencePhone ?? "") || String(p.RefPhone ?? "") || "",
          accuracy: p.PronAccuracy ?? 0,
          match_tag: p.MatchTag ?? 0,
        }))
      const refWord = w.ReferenceWord ? String(w.ReferenceWord).split("_")[0] : (w.Word ?? "")
      words.push({
        word: refWord,
        accuracy: w.PronAccuracy ?? 0,
        match_tag: w.MatchTag ?? 0,
        tone,
        phone_infos: phones,
      })
    }
    return {
      engine,
      eval_mode: evalModeVal,
      pron_accuracy: result.PronAccuracy ?? 0,
      pron_fluency: result.PronFluency ?? 0,
      pron_completion: result.PronCompletion ?? 0,
      suggested_score: result.SuggestedScore ?? 0,
      words,
    }
  }
}
