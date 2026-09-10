/** AI 语文练习客户端 — pinyin-level / pinyin-audio / mark-unknown-chars / char-click */

import { api } from "./api"
import { API_BASE } from "./config"

export interface PinyinPart {
  text: string
  label: string // shengmu / jiemu / yunmu / zhengtiren
  audio: string
}

export interface PinyinWord {
  hanzi: string
  pinyin: string
  parts: PinyinPart[]
}

export interface PinyinLevel {
  unit: string
  words: PinyinWord[]
}

/** 获取一关拼音练习 */
export async function fetchPinyinLevel(unit = "", count = 5): Promise<PinyinLevel> {
  return api<PinyinLevel>("/ai-chinese/pinyin-level", {
    method: "POST",
    body: { unit, count },
  })
}

/** 拼音音频 URL（服务端 /pinyin-audio 端点） */
export function pinyinAudioUrl(filePath: string): string {
  return `${API_BASE}/pinyin-audio?file=${encodeURIComponent(filePath)}`
}

/** 标记不认识的字上传（认读画像） */
export async function markUnknownChars(chars: string[], lesson = ""): Promise<boolean> {
  try {
    await api("/ai-chinese/mark-unknown-chars", {
      method: "POST",
      body: { chars, lesson },
      timeoutMs: 10000,
    })
    return true
  } catch {
    return false
  }
}

/** 上报单字认读点击（认读画像） */
export async function recordCharClick(chars: string[]): Promise<void> {
  if (!chars.length) return
  try {
    await api("/ai-chinese/char-click", {
      method: "POST",
      body: { chars },
      timeoutMs: 5000,
    })
  } catch {
    /* 忽略 */
  }
}

export interface HighlightMarkItem {
  type: "core" | "beautiful" | "word"
  phrase: string
  reason: string
}

export interface HighlightMarkResult {
  text: string
  highlights: HighlightMarkItem[]
  tip: string
}

/** 段落高亮解析：LLM 标注核心句/优美词句/重点词，附口语化学习提示 */
export async function highlightMark(text: string): Promise<HighlightMarkResult> {
  return api<HighlightMarkResult>("/ai-chinese/highlight-mark", {
    method: "POST",
    body: { text },
    timeoutMs: 40000,
  })
}

/** 词性标注（名词/动词/形容词），供前端词性着色 */
export type PosTag = "n" | "v" | "adj"

export interface PosTagItem {
  word: string
  pos: PosTag
}

export interface PosTagResult {
  lang: "zh" | "en"
  tags: PosTagItem[]
}

export async function posTags(text: string, lang: "zh" | "en"): Promise<PosTagResult> {
  return api<PosTagResult>("/ai-chinese/pos-tags", {
    method: "POST",
    body: { text, lang },
    timeoutMs: 40000,
  })
}

/** 文章要素标注（记叙六要素），供前端要素着色 */
export type StoryKind = "person" | "time" | "place" | "cause" | "process" | "result" | "event"

export interface StoryElementItem {
  word: string
  kind: StoryKind
}

export interface StoryElementsResult {
  lang: "zh" | "en"
  elements: StoryElementItem[]
}

export async function storyElements(text: string, lang: "zh" | "en"): Promise<StoryElementsResult> {
  return api<StoryElementsResult>("/ai-chinese/story-elements", {
    method: "POST",
    body: { text, lang },
    timeoutMs: 40000,
  })
}
