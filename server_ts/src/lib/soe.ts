/** 腾讯云智聆 SOE 语音评测 — 原生 WebSocket（对齐 Python services/soe.py，Go 版签名一致） */
import { createHmac, createHash } from "node:crypto"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"

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

    const signStr = `soe.cloud.tencent.com/soe/api/${this.appId}?${rawQuery}`
    const signature = hmacSha1Base64(this.secretKey, signStr)

    const uv = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&")
    const wsUrl = `wss://soe.cloud.tencent.com/soe/api/${this.appId}?${uv}&signature=${encodeURIComponent(signature)}`

    const audioData = Buffer.from(audioBase64, "base64")

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { handshakeTimeout: 30000 })
      let result: any = null

      ws.on("open", () => {
        // 握手响应会先来，open 后等待 recv
      })

      ws.on("message", (data, isBinary) => {
        try {
          const text = data.toString("utf-8")
          const resp = JSON.parse(text)
          if (typeof resp.code !== "undefined" && resp.code !== 0) {
            reject(new Error(`SOE 服务端错误: code=${resp.code} msg=${resp.message}`))
            ws.close()
            return
          }
          if (typeof resp.final !== "undefined" && resp.final === 1) {
            result = resp.result ?? {}
            ws.close()
            return
          }
          // 握手响应（code==0 且无 final）→ 发送音频 + 结束标记
          if (!result) {
            ws.send(audioData, { binary: true })
            ws.send(JSON.stringify({ type: "end" }))
          }
        } catch (e) {
          reject(new Error(`SOE 消息解析失败: ${(e as Error).message}`))
          ws.close()
        }
      })

      ws.on("error", (err) => reject(new Error(`WebSocket 连接失败: ${err.message}`)))

      ws.on("close", () => {
        if (result) {
          try {
            resolve(this.transformResult(result, engine, evalModeVal))
          } catch (e) {
            reject(e as Error)
          }
        } else if (ws.readyState === WebSocket.CLOSED && !result) {
          reject(new Error("SOE 评测无返回结果"))
        }
      })

      // 超时保护
      setTimeout(() => {
        if (!result) {
          ws.close()
          reject(new Error("SOE 评测超时（30 秒）"))
        }
      }, 30000)
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
