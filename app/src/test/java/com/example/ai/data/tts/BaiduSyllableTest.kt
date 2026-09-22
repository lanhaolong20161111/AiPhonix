package com.example.ai.data.tts

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `toBaiduSyllable` / `charAudioUrl` 的期望值**全部取自 web 真实实现的输出**
 * （用 `npx tsx` 跑 `web/src/lib/ttsPinyin.ts` 的 toBaiduSyllable 逐项打印），
 * 不是我自己推导的 —— 避免「自己实现自己验」。
 */
class BaiduSyllableTest {

    @Test
    fun `带声调拼音转数字调`() {
        assertEquals("qing1", toBaiduSyllable("qīng"))
        assertEquals("qing2", toBaiduSyllable("qíng"))
        assertEquals("qing3", toBaiduSyllable("qǐng"))
        assertEquals("jing1", toBaiduSyllable("jīng"))   // 睛：偏旁屋的「例外」字
        assertEquals("bao4", toBaiduSyllable("bào"))
        assertEquals("bao3", toBaiduSyllable("bǎo"))
        assertEquals("pao3", toBaiduSyllable("pǎo"))
        assertEquals("mao1", toBaiduSyllable("māo"))
        assertEquals("miao4", toBaiduSyllable("miào"))
        assertEquals("gen1", toBaiduSyllable("gēn"))
        assertEquals("hen4", toBaiduSyllable("hèn"))
        assertEquals("yan3", toBaiduSyllable("yǎn"))
    }

    @Test
    fun `已是数字调则幂等`() {
        assertEquals("zhong4", toBaiduSyllable("zhong4"))
        assertEquals("de5", toBaiduSyllable("de5"))
    }

    @Test
    fun `大小写不敏感`() {
        assertEquals("qing1", toBaiduSyllable("QĪNG"))
    }

    @Test
    fun `ü 系列写作 v`() {
        assertEquals("lv4", toBaiduSyllable("lǜ"))
        assertEquals("nv3", toBaiduSyllable("nǚ"))
        assertEquals("v1", toBaiduSyllable("ǖ"))
    }

    @Test
    fun `无声调一律拒绝`() {
        // ⚠️ 这是本函数存在的关键约束：百度对「字(无声调)」会把拼音字母念出来，
        //    所以宁可返回 ""（不注音），也绝不返回 "zhong" 这种半成品。
        assertEquals("", toBaiduSyllable("zhong"))
        assertEquals("", toBaiduSyllable("lü"))     // 无调 ü 也不够（tone=0）
        assertEquals("", toBaiduSyllable("ma"))     // 偏旁字族里真实存在的轻声
        assertEquals("", toBaiduSyllable("ba"))
        assertEquals("", toBaiduSyllable("men"))
        assertEquals("", toBaiduSyllable("a"))
        assertEquals("", toBaiduSyllable("x"))
        assertEquals("", toBaiduSyllable(""))
    }

    @Test
    fun `多音节不接受`() {
        // normalizePinyin 给出 "xi1 gua1"，含空格，不是单个音节
        assertEquals("", toBaiduSyllable("xī guā"))
    }

    @Test
    fun `charAudioUrl 按是否有注音拼两种 URL`() {
        val base = "https://example.test"
        assertEquals(
            "$base/api/v1/tts/char/%E6%B8%85?pinyin=qing1",
            charAudioUrl("清", "qīng", base),
        )
        assertEquals(
            "$base/api/v1/tts/char/%E6%B8%85",
            charAudioUrl("清", "", base),
        )
        // 注音不可用（轻声）→ 退化为不注音，而不是拼出 ?pinyin=
        assertEquals(
            "$base/api/v1/tts/char/%E6%B8%85",
            charAudioUrl("清", "ma", base),
        )
    }
}
