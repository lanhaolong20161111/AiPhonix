/** 块级朗读录音 — 点击开始录音、再点结束；可回放最近一次录音
 *
 * 与 BlockMic（朗读评测）不同：这里**不做评分、不上传**，纯本地录音 + 回放，
 * 让孩子先自己听一遍读得怎么样。
 *
 * 链路：PcmRecorder（16kHz/16bit/mono PCM）→ 加 WAV 头 → Blob(URL) → <audio> 回放。
 * 之所以不用 MediaRecorder：项目录音链路已统一走 PcmRecorder（与 SOE/ASR 同源），
 * 且 PCM→WAV 只是加 44 字节头，比再引一套 MediaRecorder 分支更省事、格式也确定。
 */

import { useEffect, useRef, useState } from "react"
import { PcmRecorder } from "../lib/pcmRecorder"

/** 给 16kHz/16bit/mono 裸 PCM 加 44 字节 WAV 头，得到浏览器可播放的 wav */
function pcmToWav(pcm: Uint8Array, sampleRate = 16000): Blob {
  const channels = 1
  const bits = 16
  const byteRate = (sampleRate * channels * bits) / 8
  const blockAlign = (channels * bits) / 8
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, "RIFF")
  v.setUint32(4, 36 + pcm.length, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  v.setUint32(16, 16, true) // fmt chunk 长度
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, channels, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, byteRate, true)
  v.setUint16(32, blockAlign, true)
  v.setUint16(34, bits, true)
  writeStr(36, "data")
  v.setUint32(40, pcm.length, true)
  // 用 pcm.buffer 而非 pcm 本身：TS 的 BlobPart 不接受 Uint8Array<ArrayBufferLike>（可能 shared）
  return new Blob([header, pcm.buffer as ArrayBuffer], { type: "audio/wav" })
}

/** 低于这个字节数视为没录到内容（0.3s @16kHz/16bit） */
const MIN_PCM_BYTES = 9600

export function BlockRecorder() {
  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState("")
  const recorderRef = useRef<PcmRecorder | null>(null)
  const urlRef = useRef<string | null>(null)

  // 卸载：释放麦克风 + 回收 blob URL（否则切页后麦克风指示灯常亮）
  useEffect(() => {
    return () => {
      const r = recorderRef.current
      recorderRef.current = null
      try {
        r?.destroy()
      } catch {
        /* 忽略 */
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  const start = async () => {
    setErr("")
    if (recorderRef.current) {
      try {
        recorderRef.current.destroy()
      } catch {
        /* 忽略 */
      }
      recorderRef.current = null
    }
    const rec = new PcmRecorder({ onLevel: setLevel })
    recorderRef.current = rec
    try {
      await rec.start()
      setRecording(true)
    } catch (e) {
      recorderRef.current = null
      setErr(String((e as Error)?.message ?? e))
    }
  }

  const stop = () => {
    const rec = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    setLevel(0)
    if (!rec) return
    let pcm: Uint8Array
    try {
      pcm = rec.stop()
    } catch {
      setErr("结束录音失败，请重试")
      return
    }
    if (pcm.length < MIN_PCM_BYTES) {
      setErr("没有录到声音，请靠近麦克风再试一次")
      return
    }
    // 覆盖上一次录音 → 先回收旧 URL，避免 blob 泄漏
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const next = URL.createObjectURL(pcmToWav(pcm))
    urlRef.current = next
    setUrl(next)
  }

  const toggle = () => {
    if (recording) stop()
    else void start()
  }

  return (
    <div className="block-mic">
      <button
        className={`block-ops-btn block-mic-btn${recording ? " recording" : ""}`}
        onClick={toggle}
        title={recording ? "点击结束录制" : "点击开始录制朗读音频"}
        aria-label={recording ? "结束录制" : "开始录制朗读音频"}
      >
        {recording ? "⏹" : "🎤"}
      </button>
      {recording && (
        <div className="level-bar" style={{ width: 80 }}>
          <div className="level-fill" style={{ width: `${Math.max(4, Math.min(100, level * 100))}%` }} />
        </div>
      )}
      {url && !recording && (
        <button
          className="block-ops-btn"
          onClick={() => {
            const a = new Audio(url)
            a.play().catch(() => setErr("回放失败，请再录一次"))
          }}
          title="播放最近一次录制的音频"
          aria-label="播放最近一次录制的音频"
        >
          ▶️
        </button>
      )}
      {err && !recording && <span className="block-rec-err">{err}</span>}
    </div>
  )
}
