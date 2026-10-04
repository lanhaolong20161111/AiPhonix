/** 英文逐词可点读文本 — 按空白切词，点击单词内任意字母朗读整个单词（复用 useTts）
 *
 * 从 SpeechComposePage 提取的独立组件；整词朗读副作用由调用方通过 onWordSpeak 注入。
 * 点击单词会先打断当前播放（全局锁），保证整句朗读时点词也始终生效。
 */
import { useMemo, useState } from "react"
import { useTts } from "../../hooks/useTts"
import { audioManager } from "../../lib/audioManager"
import { PhonicsWord } from "../../components/PhonicsWord"

interface EnglishWordTapProps {
  text: string
  /** 点击整词后的额外回调（默认无；朗读由内部 useTts.speak 完成） */
  onWordTap?: (word: string) => void
  /** 整词朗读副作用注入（默认内部 speak；页面可在"录音中朗读"场景接管为暂停 ASR→读→恢复） */
  speakOverride?: (word: string) => void
  /** 追加到容器的 className（默认含 tap-char） */
  className?: string
}

export function EnglishWordTap({ text, onWordTap, speakOverride, className }: EnglishWordTapProps) {
  const { speak } = useTts()
  const [speakingWord, setSpeakingWord] = useState<string | null>(null)
  const segs = useMemo(() => text.match(/\s+|\S+/g) ?? [], [text])

  const handleWord = async (word: string) => {
    audioManager.stop() // 打断整句/其它播放，确保点读生效
    setSpeakingWord(word)
    try {
      if (speakOverride) {
        speakOverride(word)
      } else {
        await speak(word, {})
      }
    } finally {
      setSpeakingWord(null)
    }
    onWordTap?.(word)
  }

  return (
    <span className={`tap-char${className ? ` ${className}` : ""}`}>
      {segs.map((seg, si) =>
        /^\s+$/.test(seg) ? (
          <span key={si} className="tap-char-space">
            {seg.includes("\n") ? seg.split("").map((c, i) => (c === "\n" ? <br key={i} /> : c)) : seg}
          </span>
        ) : (
          <span
            key={si}
            className={`tap-char-word${speakingWord === seg ? " word-speaking" : ""}`}
            onClick={() => void handleWord(seg)}
            style={{ cursor: "pointer" }}
          >
            {/* 逐词点读 + 拼读着色：色块按发音规律切，字盒与点读行为完全不变 */}
            <PhonicsWord
              word={seg}
              wrapChar={(ch, ci) => (
                <span key={ci} className="tap-char-item">
                  {ch}
                </span>
              )}
            />
          </span>
        ),
      )}
    </span>
  )
}
