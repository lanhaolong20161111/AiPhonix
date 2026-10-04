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

/**
 * 检测「停顿对齐」SRT（由 scripts/resegment_srt.py 离线生成，首行 "; PAUSE-ALIGNED v1"）。
 * 这类 SRT 的块已经是按声学停顿切好的测评对象粒度，
 * 前端应跳过 toSentences 标点合并，直接信任其块边界。
 */
export function isPauseAligned(srtContent: string): boolean {
  return /^\s*;\s*PAUSE-ALIGNED/i.test(srtContent)
}

/** 判断一块文本是否以句末标点结尾（视为一句完整的话） */
function endsSentence(text: string): boolean {
  const t = text.trimEnd()
  if (!t) return true
  return /[.!?…]/.test(t[t.length - 1])
}

/**
 * 把按"显示行"切分的原始字幕块合并成「完整句子」粒度。
 *
 * 背景：YouTube / SeedASR 生成的 SRT 常把一句话拆成多块（如儿歌
 * "Head and shoulders, knees and toes," → "knees and toes."），
 * 若按原始块结束就暂停录音，会在半句话处误触发。
 *
 * 合并规则：当前块不以句末标点（. ! ? …）结尾时，吸收下一块，
 * 直至遇到句末标点块为止。时间区间 = 首块 start ~ 末块 end。
 */
export function toSentences(entries: SubtitleEntry[]): SubtitleEntry[] {
  const MAX_BLOCKS = 6 // 单句最多合并 6 块，防整段无标点时失控
  const MAX_MS = 20000 // 单句最长 20s，防异常长合并
  const out: SubtitleEntry[] = []
  let i = 0
  while (i < entries.length) {
    const first = entries[i]
    let last = first
    let j = i
    while (j + 1 < entries.length && !endsSentence(last.text)) {
      const next = entries[j + 1]
      const span = next.endMs - first.startMs
      const blocks = j + 1 - i + 1
      if (span > MAX_MS || blocks >= MAX_BLOCKS) break
      last = next
      j++
    }
    const text = entries
      .slice(i, j + 1)
      .map((e) => e.text)
      .join(" ")
      .trim()
    if (text) {
      out.push({ index: first.index, startMs: first.startMs, endMs: last.endMs, text })
    }
    i = j + 1
  }
  return out
}
