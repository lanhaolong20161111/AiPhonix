/** PCM → WAV 转换 — 把 16kHz/16bit/mono PCM 封装成可播放的 WAV（用于 A/B 对比回放） */

/**
 * 生成 44 字节标准 RIFF/WAVE 头部。
 * 参数：pcm 字节数（16bit mono → 每样本 2 字节）、采样率。
 */
function buildWavHeader(pcmByteLength: number, sampleRate = 16000): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(44)
  const dv = new DataView(header.buffer)
  const byteRate = sampleRate * 2 // 16bit mono
  const blockAlign = 2
  const bitsPerSample = 16

  // RIFF chunk
  header.set([0x52, 0x49, 0x46, 0x46], 0) // "RIFF"
  dv.setUint32(4, 36 + pcmByteLength, true) // chunk size（44 头之后的字节数）
  header.set([0x57, 0x41, 0x56, 0x45], 8) // "WAVE"

  // fmt subchunk
  header.set([0x66, 0x6d, 0x74, 0x20], 12) // "fmt "
  dv.setUint32(16, 16, true) // fmt 块长度
  dv.setUint16(20, 1, true) // 音频格式：1 = PCM
  dv.setUint16(22, 1, true) // 声道数：1 = mono
  dv.setUint32(24, sampleRate, true) // 采样率
  dv.setUint32(28, byteRate, true) // 字节率
  dv.setUint16(32, blockAlign, true) // 块对齐
  dv.setUint16(34, bitsPerSample, true) // 位深

  // data subchunk
  header.set([0x64, 0x61, 0x74, 0x61], 36) // "data"
  dv.setUint32(40, pcmByteLength, true) // 数据字节数
  return header
}

/** 16kHz/16bit/mono PCM → WAV Blob（可直接给 <audio> 播放） */
export function pcmToWavBlob(pcm: Uint8Array, sampleRate = 16000): Blob {
  const header = buildWavHeader(pcm.byteLength, sampleRate)
  const out = new Uint8Array(header.byteLength + pcm.byteLength)
  out.set(header, 0)
  out.set(pcm, header.byteLength)
  return new Blob([out], { type: "audio/wav" })
}
