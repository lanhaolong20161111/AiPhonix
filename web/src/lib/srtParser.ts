/** SRT 字幕解析 — 复刻 Android SrtParser 逻辑 */

export interface SubtitleEntry {
  index: number
  startMs: number
  endMs: number
  text: string
}

const TIMESTAMP_REGEX = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/g

function timeToMs(m: RegExpMatchArray): number {
  const hours = Number(m[1])
  const minutes = Number(m[2])
  const seconds = Number(m[3])
  const millis = Number(m[4])
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis
}

export function parseSrt(srtContent: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = []
  const blocks = srtContent.trim().split(/\n\n|\r\n\r\n/)

  for (const block of blocks) {
    const lines = block.trim().split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length < 3) continue

    const index = Number(lines[0])
    if (Number.isNaN(index)) continue

    TIMESTAMP_REGEX.lastIndex = 0
    const timeMatches = [...lines[1].matchAll(TIMESTAMP_REGEX)]
    if (timeMatches.length < 2) continue

    const startMs = timeToMs(timeMatches[0])
    const endMs = timeToMs(timeMatches[1])

    const text = lines
      .slice(2)
      .join(" ")
      .replace(/<[^>]*>/g, "")   // HTML 标签
      .replace(/\{[^}]*\}/g, "") // {} 样式标记
      .replace(/\[[^\]]*\]/g, "") // [Music] 等
      .trim()

    if (text) {
      entries.push({ index, startMs, endMs, text })
    }
  }
  return entries
}

/** 根据播放时间找当前字幕 */
export function findCurrentSubtitle(subtitles: SubtitleEntry[], positionMs: number): SubtitleEntry | null {
  return subtitles.find((s) => positionMs >= s.startMs && positionMs <= s.endMs) ?? null
}
