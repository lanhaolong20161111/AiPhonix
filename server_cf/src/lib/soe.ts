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

  evaluate(refText: string, audioBase64: string, engine = "", evalMode = "", scene = ""): Promise<{
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
    if (refText.length > maxRefLen) refText = refText.slice(0, maxRefLen)

    const voiceId = randomUUID()
    const ts = String(Math.floor(Date.now() / 1000))
    const params: Record<string, string> = {
      secretid: this.secretId,
      timestamp: ts,
      expired: String(Math.floor(Date.now() / 1000) + 86400),
      nonce: ts,
      voice_id: voiceId,
      voice_format: "1",
      text_mode: "0",
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
