package com.example.ai.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 去拼音单测。期望值来自把 web `src/lib/pinyin.ts` 的 `stripPinyin` /
 * `stripPinyinKeepDelimiters` 原样复制到 node 跑的探针（`web/_ocrpick_probe.mjs`，已删）。
 *
 * 重点是把**三条反直觉行为**钉住（大写声调字母不剔、纯拼音返回空、保留分隔符分支保留残渣），
 * 它们看着像 bug，实际就是 web 的行为，改了会让导入结果与 web 不一致。
 */
class StripPinyinTest {

    @Test
    fun `stripPinyin 只保留汉字纯拼音一律返回空串`() {
        assertEquals("", stripPinyin("rì yuè shuǐ huǒ", separate = false))
        assertEquals("", stripPinyin("rì yuè shuǐ huǒ", separate = true))
        assertEquals("", stripPinyin("chūn tiān，péng you", separate = false))
        assertEquals("", stripPinyin("chūn tiān，péng you", separate = true))
        assertEquals("", stripPinyin("nǐ hǎo！wǒ hěn hǎo。", separate = false))
        assertEquals("", stripPinyin("ā á ǎ à", separate = true))
        assertEquals("", stripPinyin("ABC", separate = false))
        assertEquals("", stripPinyin("", separate = true))
        // ★ 大写声调字母不在字符类里 ⇒ 剔不掉，但也不是汉字 ⇒ 最终仍返回空
        assertEquals("", stripPinyin("RÌ YUÈ", separate = true))
    }

    @Test
    fun `stripPinyin 汉字与拼音混排时只留汉字`() {
        assertEquals("日月", stripPinyin("日rì 月yuè", separate = false))
        assertEquals("日 月", stripPinyin("日rì 月yuè", separate = true))
        assertEquals("文字", stripPinyin("zhōng 文 hàn 字", separate = false))
        assertEquals("世界", stripPinyin("hello 世界 world", separate = false))
        assertEquals("拼 音", stripPinyin("拼音pīn yīn", separate = true))
        // 全角空格不是汉字 ⇒ 被丢弃，重新用半角空格连接
        assertEquals("日 月", stripPinyin("\u3000日\u3000月\u3000", separate = true))
    }

    @Test
    fun `stripPinyinKeepDelimiters 只剔拼音与 ASCII 字母段其余原样保留`() {
        // 拼音段被剔掉，原来夹在中间的空白/标点留在原地
        assertEquals("   ", stripPinyinKeepDelimiters("rì yuè shuǐ huǒ"))
        assertEquals(" ， ", stripPinyinKeepDelimiters("chūn tiān，péng you"))
        assertEquals("春天 朋友\n认真", stripPinyinKeepDelimiters("春天 朋友\n认真"))
        assertEquals("日，月、水", stripPinyinKeepDelimiters("日rì，月yuè、水shuǐ"))
        assertEquals(" 世界", stripPinyinKeepDelimiters("hello 世界"))
        assertEquals("", stripPinyinKeepDelimiters(""))
        // ★ 大写声调字母既不是 ASCII 字母段也不是被剔的字符类 ⇒ 残渣留下，换行保留
        assertEquals("Ì È\n", stripPinyinKeepDelimiters("RÌ YUÈ\nABC"))
    }
}
