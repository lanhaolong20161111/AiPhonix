/** 排版块朗读 hook — 逐字/整块 TTS（多音字 {字^拼音} 注音）+ 认读画像上报 */

import { useState } from "react"
import { useTts } from "./useTts"
import { api } from "../services/api"
import { isSpeakableChar } from "../lib/chars"

export function useBlockSpeaking() {
  const { speaking, speak } = useTts()
  const [speakingChar, setSpeakingChar] = useState<string | null>(null)

  const speakChar = async (ch: string, polyphones: Record<string, string>) => {
    // 标点/空白/填空下划线等不可发音字符不播（百度 TTS 对单标点返回 500）
    if (!isSpeakableChar(ch)) return
    const pinyin = polyphones[ch]?.trim()
    setSpeakingChar(ch)
    // 多音字锁定读音。走 annotateTts 的 `字(pinyin数字调)` 语法 —— 该语法经实测生效；
    // 旧的 `{字^拼音}` 是无效语法，拼音会被当字面内容念出来，已废弃。
    // 此处拼音由调用方显式给出，故 polyphoneOnly=false（不受多音字集合限制）。
    await speak(ch, {
      speaker: "6221",
      ...(pinyin ? { pinyin, polyphoneOnly: false } : {}),
    })
    setSpeakingChar(null)
  }

  const speakBlock = async (text: string) => {
    setSpeakingChar(null)
    await speak(text, { speaker: "6221" })
  }

  // 上报单字认读画像（char-click）
  const recordCharClick = async (ch: string) => {
    if (!ch.trim()) return
    try {
      await api("/ai-chinese/char-click", {
        method: "POST",
        body: { chars: [ch] },
        timeoutMs: 5000,
      })
    } catch {
      /* 忽略 */
    }
  }

  return { speaking, speakingChar, speakChar, speakBlock, recordCharClick }
}
