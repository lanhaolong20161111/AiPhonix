package com.example.ai.data.tts

import com.example.ai.data.chinesepractice.normalizePinyin

/** 汉字范围（不含标点、字母、数字）。与 web `lib/ttsPinyin.ts` 的 `CJK` 同范围。 */
private val CJK = Regex("[\u4e00-\u9fa5]")

/**
 * 给中文文本标注读音，产出百度 TTS 的 tex（对齐 web `lib/ttsPinyin.ts` 的 `annotateTts`）。
 *
 * ⚠️ 语法为实测确认（web 侧 2026-08-30 对生产 `/api/v1/tts/synthesize` 做对照实验）：
 *   - 生效：`字(拼音数字调)`，例 `重(zhong4)庆` / `银行(xing2)` / `好(hao3)的(de5)`；
 *     数字调 1~5 均可（5 = 轻声），大小写不敏感。
 *   - 无效：`{字^拼音}`（旧写法，拼音会被当字面内容念出来）、`字(声调符号)`（如 `重(zhòng)`）、
 *     `字(无声调)`（如 `重(zhong)`）—— 后两者同样会被当字面念出来。
 *
 * **安全策略**：字数与音节数对不上、或音节格式非法时**原样返回文本**，
 * 宁可让百度自由发挥，也绝不把文本改坏（改坏了会读出拼音字母）。
 *
 * @param text   中文原文（可含标点/换行，标点不占音节位）
 * @param pinyin 与 text 逐字对应的拼音（空格分隔，可带声调符号或数字调）
 * @param polyphoneOnly 只给多音字注音。
 *   ⚠️ **Android 端暂无多音字表（web 的 `data/polyphoneChars`），故 `true` 时逐字不注音
 *   （等价于原样返回文本）**。古诗朗读走的是 web 的 `polyphoneOnly: false` 分支，
 *   不依赖该表，故不受影响。
 */
fun annotateTts(text: String, pinyin: String, polyphoneOnly: Boolean = false): String {
    if (text.isEmpty() || pinyin.isBlank()) return text

    val syls = normalizePinyin(pinyin).trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (syls.isEmpty()) return text

    // 字数与音节数必须严格一致，否则无法保证逐字对齐
    val cnCount = text.count { CJK.matches(it.toString()) }
    if (cnCount != syls.size) return text

    var si = 0
    val sb = StringBuilder(text.length + syls.size * 6)
    for (ch in text) {
        if (!CJK.matches(ch.toString())) {
            sb.append(ch)
            continue
        }
        // ⚠️ 无论音节是否合法都要前移下标，保证与汉字一一对应（与 web 的 `syls[si++]` 一致）
        val syl = syls.getOrNull(si) ?: ""
        si++
        val py = toBaiduSyllable(syl)
        // 音节非法（如无声调的 "xie"）：不注音，让百度自由发挥
        if (py.isEmpty()) {
            sb.append(ch)
            continue
        }
        if (polyphoneOnly) {
            // Android 无多音字表 ⇒ 保守：一律不注音（等价于原样返回）
            sb.append(ch)
            continue
        }
        sb.append(ch).append('(').append(py).append(')')
    }
    return sb.toString()
}
