/** 全局设置面板 — 首页右上角打开：英语/中文默认音色 + 助记词显隐等偏好
 *
 * 移动端底部弹出式 sheet，同一份 localStorage 状态与各模块页面联动
 * （音色走 aiPrefs 的模块级 voice，助记词走 mnemonicPref）。
 */

import { VOICES, useVoice, type VoiceId } from "../lib/aiPrefs"
import { useMnemonicVisible } from "../lib/mnemonicPref"
import { useTts } from "../hooks/useTts"

interface SettingsSheetProps {
  open: boolean
  onClose: () => void
}

/** 各模块试听例句（演示音色效果用） */
const VOICE_SAMPLES: Record<string, string> = {
  chinese: "你好呀，我是你的 AI 老师，今天我们来学新知识吧！",
  english: "Hello! I'm your AI teacher. Let's learn something new today!",
  math: "小鱼有 5 条，又来了 3 条，现在一共有 8 条。",
}

function VoicePicker({
  label, module, onChanged,
}: {
  label: string
  module: "english" | "chinese"
  onChanged?: () => void
}) {
  const [voice, setVoice] = useVoice(module)
  const { speak } = useTts()
  const sample = VOICE_SAMPLES[module] ?? VOICE_SAMPLES.chinese
  const pick = (v: VoiceId) => {
    setVoice(v)
    // 立即用该音色朗读示例句，让家长/孩子听到效果
    void speak(sample, { speaker: v, speed: 5 })
    onChanged?.()
  }
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div className="settings-voice-btns">
        {VOICES.map((v) => (
          <button
            key={v.id}
            className={`ai-pref-chip${voice === v.id ? " active" : ""}`}
            onClick={() => pick(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const [mnemonicVisible, toggleMnemonic] = useMnemonicVisible()

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="设置"
      >
        <div className="settings-sheet-head">
          <span className="settings-sheet-title">⚙️ 设置</span>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-sheet-body">
          <VoicePicker label="🇬🇧 英语默认音色" module="english" />
          <VoicePicker label="🇨🇳 中文默认音色" module="chinese" />

          <div className="settings-row">
            <span className="settings-row-label">💡 助记词</span>
            <div className="settings-toggle-wrap">
              <button
                className={`settings-toggle${mnemonicVisible ? " on" : ""}`}
                onClick={toggleMnemonic}
                role="switch"
                aria-checked={mnemonicVisible}
              >
                {mnemonicVisible ? "显示" : "隐藏"}
              </button>
              <span className="settings-row-sub">
                {mnemonicVisible ? "拼音/字母页显示助记汉字" : "拼音/字母页隐藏助记"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}