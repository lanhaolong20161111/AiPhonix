/** SOE 发音评测 API 客户端 — 与 Android ScoreClient 请求格式一致 */

import { api } from "../services/api"

export interface SoeWord {
  word: string
  accuracy: number
  match_tag: number
  tone?: { ref: number | null; hyp: number | null } | null
  phone_infos: Array<{
    phone: string
    accuracy: number
    match_tag?: number
  }>
}

export interface SoeResult {
  engine: string
  eval_mode: string
  pron_accuracy: number
  pron_fluency: number
  pron_completion: number
  suggested_score: number
  words: SoeWord[]
}

/** 将 PCM 字节数组编码为 base64（浏览器端） */
export function pcmToBase64(pcm: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000 // 32KB 分段，避免 call stack 溢出
  for (let i = 0; i < pcm.length; i += chunkSize) {
    const chunk = pcm.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/**
 * 发送发音评测请求。
 * @param refText 参考文本
 * @param pcm 16kHz/16bit/mono 的 PCM 原始字节
 * @param engine 评测引擎（空 = 自动按文本识别 zh/en）
 * @param evalMode 兼容旧参数（"0"/"1"/"2"/"8"）
 * @param scene 被测对象类型（推荐）：word / sentence / paragraph / pinyin
 *              —— 决定腾讯 eval_mode，必须与被测对象一致才能返回对应粒度明细
 */
export async function evaluateSoe(
  refText: string,
  pcm: Uint8Array,
  engine = "",
  evalMode = "",
  scene = "",
  userId = 0,
  source = "",
): Promise<SoeResult> {
  const audioBase64 = pcmToBase64(pcm)
  const body: Record<string, string> = {
    ref_text: refText,
    audio_base64: audioBase64,
  }
  if (engine) body.engine = engine
  if (evalMode) body.eval_mode = evalMode
  if (scene) body.scene = scene
  if (userId > 0) body.user_id = String(userId)
  if (source) body.source = source

  return api<SoeResult>("/soe/evaluate", { method: "POST", body, auth: true })
}
