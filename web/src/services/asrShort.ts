/** 百度短语音识别（整段上传一次返回）— 服务封装
 * 停顿提示/点结束时把该段 PCM 上传，替代流式对单字不稳的短板。
 */

import { api } from "./api"

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(bin)
}

/** 上传一段 16k/16bit/mono PCM，返回识别文本（可能为空字符串） */
export async function shortAsr(audio: Uint8Array, lang: "zh" | "en" = "zh"): Promise<string> {
  if (!audio || audio.length < 1600) return ""
  const r = await api<{ text: string }>("/asr/short", {
    method: "POST",
    body: { lang, audio: bytesToBase64(audio) },
    timeoutMs: 20000,
  })
  return (r.text ?? "").trim()
}
