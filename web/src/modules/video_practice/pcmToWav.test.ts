/** PCM→WAV 转换单测 — 验证 WAV 头字段与数据完整性（A/B 对比回放依赖） */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { pcmToWavBlob } from "./pcmToWav.js"

describe("pcmToWavBlob", () => {
  it("生成的 Blob 以 RIFF/WAVE 头开始且总长 = 44 + PCM 字节", async () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe])
    const blob = pcmToWavBlob(pcm)
    assert.equal(blob.size, 44 + pcm.byteLength)
    assert.equal(blob.type, "audio/wav")
    const buf = new Uint8Array(await blob.arrayBuffer())
    // 魔数
    assert.equal(new TextDecoder().decode(buf.subarray(0, 4)), "RIFF")
    assert.equal(new TextDecoder().decode(buf.subarray(8, 12)), "WAVE")
    // 数据块大小字段 = PCM 字节数
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    assert.equal(dv.getUint32(40, true), pcm.byteLength)
  })

  it("PCM 数据原样保留在 44 字节头之后", async () => {
    const pcm = new Uint8Array([0x10, 0x20, 0x30, 0x40])
    const buf = new Uint8Array(await pcmToWavBlob(pcm).arrayBuffer())
    assert.deepEqual(buf.subarray(44), pcm)
  })

  it("fmt 块字段正确：PCM(1) / mono(1) / 16kHz / 16bit", async () => {
    const buf = new Uint8Array(await pcmToWavBlob(new Uint8Array(4)).arrayBuffer())
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    assert.equal(dv.getUint16(20, true), 1) // PCM
    assert.equal(dv.getUint16(22, true), 1) // mono
    assert.equal(dv.getUint32(24, true), 16000) // 采样率
    assert.equal(dv.getUint16(34, true), 16) // 位深
  })

  it("空 PCM 也能生成合法（0 数据）WAV", async () => {
    const blob = pcmToWavBlob(new Uint8Array(0))
    assert.equal(blob.size, 44)
  })
})
