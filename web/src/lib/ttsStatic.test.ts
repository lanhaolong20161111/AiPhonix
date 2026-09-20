import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  staticCharAudioPath,
  markTtsStaticMiss,
  isTtsStaticMiss,
  __resetTtsStaticMisses,
} from "./ttsStatic"

describe("staticCharAudioPath", () => {
  beforeEach(() => __resetTtsStaticMisses())

  test("单个汉字 → /tts-cache/data/tts_char/{字}.mp3", () => {
    assert.equal(staticCharAudioPath("学"), "/tts-cache/data/tts_char/%E5%AD%A6.mp3")
    assert.equal(staticCharAudioPath("一"), "/tts-cache/data/tts_char/%E4%B8%80.mp3")
  })

  test("非单个汉字一律返回 null（静态库里只有汉字）", () => {
    // 英文/数字/标点/拼音音节 —— 静态库无对应文件，探测只会白拿 404
    for (const s of ["a", "A", "1", ".", ",", "hao3", "xué"]) {
      assert.equal(staticCharAudioPath(s), null, `${s} 不该有静态路径`)
    }
  })

  test("多字/空串返回 null", () => {
    assert.equal(staticCharAudioPath("学习"), null)
    assert.equal(staticCharAudioPath(""), null)
  })

  test("路径带 encodeURIComponent，特殊字也不裸拼", () => {
    // 汉字会被百分号编码；不出现未编码的非 ASCII
    const p = staticCharAudioPath("龘")
    assert.ok(p)
    assert.match(p!, /^\/tts-cache\/data\/tts_char\/%[0-9A-F]{2}/)
  })
})

describe("静态库 miss 记忆", () => {
  beforeEach(() => __resetTtsStaticMisses())

  test("初始未记录", () => {
    assert.equal(isTtsStaticMiss("鑫"), false)
  })

  test("mark 之后应命中", () => {
    markTtsStaticMiss("鑫")
    assert.equal(isTtsStaticMiss("鑫"), true)
    assert.equal(isTtsStaticMiss("学"), false, "mark 不该影响其它字")
  })

  test("重复 mark 幂等", () => {
    markTtsStaticMiss("鑫")
    markTtsStaticMiss("鑫")
    assert.equal(isTtsStaticMiss("鑫"), true)
  })
})
