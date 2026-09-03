/**
 * 浏览器 PCM 录音器 — 复刻腾讯 SOE Web SDK 的录音链路。
 *
 * 流程：getUserMedia 采集麦克风 → AudioWorklet 重采样到 16kHz →
 * 转 16bit little-endian PCM → 累积。停止时返回完整 PCM（base64 由调用方编码）。
 *
 * 与 Android 端 AudioRecorder 输出格式一致：16kHz / 16bit / mono。
 * 这样服务端 /soe/evaluate 代理无需任何改动即可复用。
 */

export interface RecorderCallbacks {
  onError?: (err: unknown) => void
  /** 每 ~200ms 回调一次音量等级（0-1），用于实时电平显示/调试 */
  onLevel?: (level: number) => void
}

// AudioWorklet 处理器源码（以 Blob 加载，与腾讯 SDK 一致）
// 只采集输入，不输出到扬声器（避免手机端回声/啸叫）。
const WORKLET_CODE = `
class MyProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pcmChunks = []
    this.nextUpdateFrame = 40
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'flush') {
        // 停止时立即回传剩余数据，避免丢尾部音频
        if (this.pcmChunks.length > 0) {
          this.port.postMessage({ type: 'chunk', audioData: this.pcmChunks })
          this.pcmChunks = []
        }
      }
    }
  }

  get intervalInFrames() {
    return 200 / 1000 * sampleRate
  }

  process(inputs) {
    if (inputs[0] && inputs[0][0]) {
      const input = inputs[0][0]
      const output = to16kHz(input, sampleRate)
      const audioData = to16BitPCM(output)
      this.pcmChunks.push(audioData)
      this.nextUpdateFrame -= input.length
      if (this.nextUpdateFrame < 0) {
        this.nextUpdateFrame += this.intervalInFrames
        // 每 200ms 回传累积的 PCM 块
        this.port.postMessage({
          type: 'chunk',
          audioData: this.pcmChunks
        })
        this.pcmChunks = []
      }
    } else {
      this.port.postMessage({ type: 'noinput' })
    }
    return true
  }
}

function to16BitPCM(input) {
  const dataLength = input.length * (16 / 8)
  const dataBuffer = new ArrayBuffer(dataLength)
  const dataView = new DataView(dataBuffer)
  let offset = 0
  for (let i = 0; i < input.length; i++, offset += 2) {
    // 手机麦克风普遍音量偏低，放大 2 倍提高 SOE 识别率（clip 到 [-1,1]）
    const s = Math.max(-1, Math.min(1, input[i] * 2))
    dataView.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Int8Array(dataBuffer)
}

function to16kHz(audioData, sampleRate = 44100) {
  const data = new Float32Array(audioData)
  const fitCount = Math.round(data.length * (16000 / sampleRate))
  if (fitCount <= 0) return new Float32Array(0)
  const newData = new Float32Array(fitCount)
  const springFactor = (data.length - 1) / (fitCount - 1)
  newData[0] = data[0]
  for (let i = 1; i < fitCount - 1; i++) {
    const tmp = i * springFactor
    const before = Math.floor(tmp)
    const after = Math.ceil(tmp)
    const atPoint = tmp - before
    newData[i] = data[before] + (data[after] - data[before]) * atPoint
  }
  newData[fitCount - 1] = data[data.length - 1]
  return newData
}

registerProcessor('my-processor', MyProcessor)
`

/** 将累积的 Int8Array 块合并为单个 Uint8Array */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return merged
}

export class PcmRecorder {
  private audioContext: AudioContext | null = null
  private stream: MediaStream | null = null
  private workletNode: AudioWorkletNode | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private chunks: Uint8Array[] = []
  private recording = false
  private cb: RecorderCallbacks = {}

  constructor(cb: RecorderCallbacks = {}) {
    this.cb = cb
  }

  get isRecording(): boolean {
    return this.recording
  }

  async start(): Promise<void> {
    if (this.recording) return
    this.chunks = []

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      throw new Error("当前浏览器不支持 Web Audio API")
    }

    let ctx: AudioContext
    try {
      ctx = new AudioCtx()
    } catch (e) {
      throw new Error("无法创建 AudioContext: " + String(e))
    }
    this.audioContext = ctx

    // 获取麦克风流
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (e) {
      await ctx.close().catch(() => {})
      this.audioContext = null
      throw new Error(
        "无法访问麦克风，请检查浏览器权限（需 https 或 localhost）。" + String((e as Error)?.message ?? e)
      )
    }
    this.stream = stream

    const source = ctx.createMediaStreamSource(stream)
    this.recording = true

    if (ctx.audioWorklet) {
      // 优先 AudioWorklet（现代浏览器）
      try {
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "text/javascript" }))
        await ctx.audioWorklet.addModule(blobUrl)
        URL.revokeObjectURL(blobUrl)
        const node = new AudioWorkletNode(ctx, "my-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 0, // 只采集，不输出到扬声器（避免手机端回声）
          channelCount: 1,
        })
        node.port.onmessage = (ev: MessageEvent) => {
          const msg = ev.data
          if (msg?.type === "noinput") {
            this.cb.onError?.("录音未获取到音频输入")
            return
          }
          const data = msg?.audioData
          const incoming: Uint8Array[] = []
          if (Array.isArray(data)) {
            for (const chunk of data) {
              incoming.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
            }
          } else if (data instanceof Uint8Array || data instanceof Int8Array) {
            incoming.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
          }
          for (const c of incoming) {
            this.chunks.push(c)
            this.cb.onLevel?.(energyLevel(c))
          }
        }
        source.connect(node)
        this.workletNode = node
        return
      } catch (e) {
        this.cb.onError?.(e)
      }
    }

    // 回退 ScriptProcessor（老浏览器）
    const sp = ctx.createScriptProcessor(0, 1, 1)
    sp.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.recording) return
      const inputData = e.inputBuffer.getChannelData(0)
      const resampled = this.to16kHz(inputData, ctx.sampleRate)
      const pcm = this.to16BitPCM(resampled)
      this.chunks.push(pcm)
      this.cb.onLevel?.(energyLevel(pcm))
    }
    source.connect(sp)
    this.scriptProcessor = sp
  }

  /** 停止录音并返回完整 PCM（16kHz/16bit/mono，无 WAV 头） */
  stop(): Uint8Array {
    if (!this.recording) return new Uint8Array(0)
    this.recording = false

    const ctx = this.audioContext
    const stream = this.stream

    // 通知 worklet flush 剩余数据（避免丢尾部音频）
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "flush" })
    }

    // 断开节点
    this.workletNode?.disconnect()
    this.workletNode = null
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
      this.scriptProcessor = null
    }

    // 停止所有音轨
    stream?.getTracks().forEach((t) => t.stop())
    this.stream = null

    // 合并已累积的 PCM 数据（AudioWorklet 或 ScriptProcessor 两种路径
    // 都会在收到数据时写入 this.chunks）
    const pcm = concatChunks(this.chunks)
    this.chunks = []

    // 释放 AudioContext（延迟关闭，避免 stop 后立即 close 导致收尾丢失）
    if (ctx) {
      ctx.suspend().catch(() => {})
      const c = ctx
      setTimeout(() => c.close().catch(() => {}), 300)
    }
    this.audioContext = null

    return pcm
  }

  private to16BitPCM(input: Float32Array): Uint8Array {
    const dataLength = input.length * 2
    const dataBuffer = new ArrayBuffer(dataLength)
    const dataView = new DataView(dataBuffer)
    let offset = 0
    for (let i = 0; i < input.length; i++, offset += 2) {
      // 与 worklet 一致：放大 2 倍提高识别率
      const s = Math.max(-1, Math.min(1, input[i] * 2))
      dataView.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
    return new Uint8Array(dataBuffer)
  }

  private to16kHz(audioData: Float32Array, sampleRate = 44100): Float32Array {
    const data = audioData
    const fitCount = Math.round((data.length * 16000) / sampleRate)
    if (fitCount <= 0) return new Float32Array(0)
    const newData = new Float32Array(fitCount)
    const springFactor = (data.length - 1) / (fitCount - 1)
    newData[0] = data[0]
    for (let i = 1; i < fitCount - 1; i++) {
      const tmp = i * springFactor
      const before = Math.floor(tmp)
      const after = Math.ceil(tmp)
      const atPoint = tmp - before
      newData[i] = data[before] + (data[after] - data[before]) * atPoint
    }
    newData[fitCount - 1] = data[data.length - 1]
    return newData
  }

  destroy(): void {
    try {
      this.stop()
    } catch {
      /* 忽略销毁异常 */
    }
  }
}

/** 计算 PCM 块的能量等级（0-1），用于实时电平显示 */
export function energyLevel(pcm: Uint8Array): number {
  if (pcm.length < 2) return 0
  let sum = 0
  let peak = 0
  const samples = Math.floor(pcm.length / 2)
  for (let i = 0; i < samples; i++) {
    const lo = pcm[i * 2]
    const hi = pcm[i * 2 + 1]
    const v = (hi << 8) | lo
    const s16 = v >= 0x8000 ? v - 0x10000 : v
    const abs = Math.abs(s16)
    sum += abs
    if (abs > peak) peak = abs
  }
  const rms = Math.sqrt(sum / samples)
  // 归一化到 0-1（32768 峰值 → 1）
  return Math.min(1, rms / 4000)
}
