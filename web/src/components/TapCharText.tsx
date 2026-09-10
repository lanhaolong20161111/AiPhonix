/** 逐字可点读文本 — 汉字/字母/数字点击即 TTS 朗读，正在播的字高亮（tap-char playing）
 *
 * 用于 AI 回答等无多音字注音的纯文本：逐字拆成可点击 span，复用 tap-char 样式。
 * 内部用 useTts，多实例共用全局音频锁，同一时刻只播一个。
 */

import { useState } from "react"
import { useTts } from "../hooks/useTts"
import { isSpeakableChar } from "../lib/chars"

interface TapCharTextProps {
  text: string
  /** 点击单个可读字符后的额外回调（如上报认读画像） */
  onCharClick?: (ch: string) => void
  /** 单字朗读副作用注入（默认内部 speakChar；页面可在"录音中朗读"场景接管为暂停 ASR→读→恢复） */
  charSpeakOverride?: (ch: string) => void
  /** 追加到容器上的 className（默认已含 tap-char） */
  className?: string
}

export function TapCharText({ text, onCharClick, charSpeakOverride, className }: TapCharTextProps) {
  const { speakChar } = useTts()
  const [speakingChar, setSpeakingChar] = useState<string | null>(null)

  const handleClick = async (ch: string) => {
    if (!isSpeakableChar(ch)) return
    setSpeakingChar(ch)
    try {
      if (charSpeakOverride) {
        charSpeakOverride(ch)
      } else {
        await speakChar(ch)
      }
    } finally {
      setSpeakingChar(null)
    }
    onCharClick?.(ch)
  }

  return (
    <div className={`tap-char${className ? ` ${className}` : ""}`}>
      {[...text].map((ch, ci) =>
        ch === "\n" || ch === " " || !isSpeakableChar(ch) ? (
          <span key={ci} className="tap-char-space">
            {ch === "\n" ? <br /> : ch}
          </span>
        ) : (
          <span
            key={ci}
            className={`tap-char-item${speakingChar === ch ? " playing" : ""}`}
            onClick={() => void handleClick(ch)}
          >
            {ch}
          </span>
        ),
      )}
    </div>
  )
}
