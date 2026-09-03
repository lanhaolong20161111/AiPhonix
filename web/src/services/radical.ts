/** 偏旁魔法屋 API — AI 儿歌 / 字谜池（服务端按字族缓存，每族只生成一次） */

import { api } from "./api"

export interface RadicalSongResult {
  song: string
  /** 服务端生成失败且处于冷却期（10 分钟内不会重试） */
  failed?: boolean
}

export async function getRadicalSong(family: string, base: string, chars: string[]): Promise<RadicalSongResult> {
  const qs = new URLSearchParams({ family, base, chars: chars.join(",") })
  // 服务端 arkOnly 单链路 ≤30s 超时，40s 足够（原 90s 会让失败体验像"卡死"）
  const res = await api<{ song: string; failed?: boolean }>(`/radical/song?${qs.toString()}`, { timeoutMs: 40000 })
  return { song: res.song ?? "", failed: res.failed }
}

export async function getRadicalRiddles(
  family: string,
  chars: string[],
  count = 4,
): Promise<Array<{ riddle: string; answer: string }>> {
  const qs = new URLSearchParams({ family, chars: chars.join(","), count: String(count) })
  const res = await api<{ riddles: Array<{ riddle: string; answer: string }> }>(`/radical/riddles?${qs.toString()}`, {
    timeoutMs: 90000,
  })
  return res.riddles ?? []
}
