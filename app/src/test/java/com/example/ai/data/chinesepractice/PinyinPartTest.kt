package com.example.ai.data.chinesepractice

import com.example.ai.data.audio.PinyinAudioPlayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PinyinPartTest {

    @Test
    fun `normalize 带声调符号转数字`() {
        assertEquals("xi1", normalizePinyin("xī"))
        assertEquals("gua1", normalizePinyin("guā"))
        assertEquals("biao1", normalizePinyin("biāo"))
        assertEquals("zhong1", normalizePinyin("zhōng"))
        assertEquals("lv3", normalizePinyin("lǚ"))   // ü -> v
        assertEquals("nve4", normalizePinyin("nüè")) // üe -> ve
        assertEquals("xi1 gua1", normalizePinyin("xī guā")) // 多字空格分隔
    }

    @Test
    fun `normalize 数字格式幂等`() {
        assertEquals("xi1", normalizePinyin("xi1"))
        assertEquals("biao3", normalizePinyin("biao3"))
        assertEquals("", normalizePinyin(""))
    }

    @Test
    fun `parsePinyin 带声调符号的单字`() {
        val p = parsePinyin("xī")
        assertEquals("x", p.initial)
        assertEquals("", p.medial)
        assertEquals("i", p.final)
        assertEquals(1, p.tone)
        assertFalse(p.isOverall)
    }

    @Test
    fun `parsePinyin 三拼 带介母`() {
        val p = parsePinyin("biāo")
        assertEquals("b", p.initial)
        assertEquals("i", p.medial)
        assertEquals("ao", p.final)
        assertEquals(1, p.tone)
    }

    @Test
    fun `parsePinyin ü 介母`() {
        val p = parsePinyin("lǜ")
        assertEquals("l", p.initial)
        assertEquals("v", p.final)  // ü 写作 v
        assertEquals(4, p.tone)
    }

    @Test
    fun `parsePinyin 零声母`() {
        val p = parsePinyin("ài")
        assertEquals("", p.initial)
        assertEquals("ai", p.final)
        assertEquals(4, p.tone)
    }

    @Test
    fun `parsePinyin 整体认读音节带声调`() {
        val p = parsePinyin("zhī")
        assertTrue(p.isOverall)
        assertEquals("zhi", p.final)
        assertEquals(1, p.tone)

        val p2 = parsePinyin("yuè")
        assertTrue(p2.isOverall)
        assertEquals("yue", p2.final)
        assertEquals(4, p2.tone)
    }

    @Test
    fun `parsePinyin 轻声`() {
        val p = parsePinyin("de5")
        assertEquals("d", p.initial)
        assertEquals("e", p.final)
        assertEquals(5, p.tone)
    }

    @Test
    fun `parsePinyin jqx 后的 u 是 ue 省略写法`() {
        // qún -> q + vn（ün），不是 q + un
        val q = parsePinyin("qún")
        assertEquals("q", q.initial)
        assertEquals("vn", q.final)
        assertEquals(2, q.tone)
        // jué -> j + ve（üe）
        val j = parsePinyin("jué")
        assertEquals("j", j.initial)
        assertEquals("ve", j.final)
        // xū -> x + v（ü）
        val x = parsePinyin("xū")
        assertEquals("x", x.initial)
        assertEquals("v", x.final)
        assertEquals(1, x.tone)
        // 非 jqx：lu 保持 u（如 lù 路）
        val l = parsePinyin("lù")
        assertEquals("l", l.initial)
        assertEquals("u", l.final)
        assertEquals(4, l.tone)
    }

    @Test
    fun `ian 是整体韵母 不拆介母`() {
        // biān（边）= b + ian，读"烟"系，不是 b + i + an
        val b = parsePinyin("biān")
        assertEquals("b", b.initial)
        assertEquals("", b.medial)
        assertEquals("ian", b.final)
        assertEquals(1, b.tone)
        // tiān（天）
        val t = parsePinyin("tiān")
        assertEquals("t", t.initial)
        assertEquals("ian", t.final)
        // xiān（先）
        val x = parsePinyin("xiān")
        assertEquals("x", x.initial)
        assertEquals("", x.medial)
        assertEquals("ian", x.final)
        assertEquals(1, x.tone)
    }

    @Test
    fun `uan 是整体韵母 不拆介母`() {
        // duān（端）= d + uan，读"弯"系，不是 d + u + an
        val d = parsePinyin("duān")
        assertEquals("d", d.initial)
        assertEquals("", d.medial)
        assertEquals("uan", d.final)
        assertEquals(1, d.tone)
        // guān（关）
        val g = parsePinyin("guān")
        assertEquals("g", g.initial)
        assertEquals("uan", g.final)
        // nuǎn（暖）
        val n = parsePinyin("nuǎn")
        assertEquals("n", n.initial)
        assertEquals("uan", n.final)
        assertEquals(3, n.tone)
    }

    @Test
    fun `yan wan 按课本拆 y w 声母加 an 复韵母`() {
        // 课本教法：y/w 是声母，yan = y + an（烟/严/演/燕），wan = w + an（弯/玩/晚/万）
        val y = parsePinyin("yān")
        assertEquals("y", y.initial)
        assertEquals("an", y.final)
        assertEquals(1, y.tone)
        // wān = w + an（弯）
        val w = parsePinyin("wān")
        assertEquals("w", w.initial)
        assertEquals("an", w.final)
        assertEquals(1, w.tone)
        // wǎn（晚）
        val w2 = parsePinyin("wǎn")
        assertEquals("w", w2.initial)
        assertEquals("an", w2.final)
        assertEquals(3, w2.tone)
    }

    @Test
    fun `jqx 加 uan 读 yuan`() {
        // quán（全）= q + uan，读 yuan2
        val q = parsePinyin("quán")
        assertEquals("q", q.initial)
        assertEquals("uan", q.final)
        assertEquals(2, q.tone)
        // juān（捐）
        val j = parsePinyin("juān")
        assertEquals("j", j.initial)
        assertEquals("uan", j.final)
        assertEquals(1, j.tone)
        // xuǎn（选）
        val x = parsePinyin("xuǎn")
        assertEquals("x", x.initial)
        assertEquals("uan", x.final)
        assertEquals(3, x.tone)
    }

    @Test
    fun `jqx 加 ue un u 系列全部转 ue 系`() {
        // ju/qu/xu：ü 省略写法 → v
        assertEquals("v", parsePinyin("jū").final)
        assertEquals("v", parsePinyin("qǔ").final)
        assertEquals("v", parsePinyin("xū").final)
        // jue/que/xue：üe → ve
        assertEquals("ve", parsePinyin("jué").final)
        assertEquals("ve", parsePinyin("què").final)
        assertEquals("ve", parsePinyin("xuě").final)
        // jun/qun/xun：ün → vn
        assertEquals("vn", parsePinyin("jūn").final)
        assertEquals("vn", parsePinyin("qún").final)
        assertEquals("vn", parsePinyin("xùn").final)
    }

    @Test
    fun `kuan 与 juan 区分 读弯还是渊`() {
        // kuan：普通 uan（弯），特殊韵母声调
        val k = parsePinyin("kuān")
        assertEquals("k", k.initial)
        assertEquals("uan", k.final)
        assertEquals("声母/k.mp3,特殊韵母声调/uan1.mp3", PinyinAudioPlayer.audioPathFor(k))
        // juan：üan 伪装（渊），读 yuan
        val j = parsePinyin("juān")
        assertEquals("j", j.initial)
        assertEquals("uan", j.final)
        assertEquals("声母/j.mp3,整体认读声调/yuan1.mp3", PinyinAudioPlayer.audioPathFor(j))
    }

    @Test
    fun `y 系整体认读音节 音频映射`() {
        // yu/yue/yuan/yun：零声母整体认读，音频用整体认读声调
        assertEquals("整体认读声调/yu2.mp3", PinyinAudioPlayer.audioPathFor(parsePinyin("yú")))
        assertEquals("整体认读声调/yue4.mp3", PinyinAudioPlayer.audioPathFor(parsePinyin("yuè")))
        assertEquals("整体认读声调/yuan2.mp3", PinyinAudioPlayer.audioPathFor(parsePinyin("yuán")))
        assertEquals("整体认读声调/yun2.mp3", PinyinAudioPlayer.audioPathFor(parsePinyin("yún")))
        // yin/ying：i 组零声母整体认读
        assertEquals("整体认读声调/yin2.mp3", PinyinAudioPlayer.audioPathFor(parsePinyin("yín")))
        assertEquals("整体认读声调/ying1.mp3", PinyinAudioPlayer.audioPathFor(parsePinyin("yīng")))
        // yi：站点无 yi1~4，映射 i 声调
        assertEquals("单韵母声调/i1.mp3", PinyinAudioPlayer.audioPathFor(parsePinyin("yī")))
        // yuan 禁止拆分 y-u-an：整体认读
        assertTrue(parsePinyin("yuán").isOverall)
        assertFalse(parsePinyin("yuán").isOverall.not())
    }

    @Test
    fun `音频路径特殊映射`() {
        // ian -> 特殊韵母声调（biān = b + iān）
        assertEquals("声母/b.mp3,特殊韵母声调/ian1.mp3",
            PinyinAudioPlayer.audioPathFor(parsePinyin("biān")))
        // jqx+uan -> yuan 声调（quán = q + uán，读 yuan2）
        assertEquals("声母/q.mp3,整体认读声调/yuan2.mp3",
            PinyinAudioPlayer.audioPathFor(parsePinyin("quán")))
        // wan 按课本拆：w 声母 + an 复韵母（鼻韵母声调/an3.mp3）
        assertEquals("声母/w.mp3,鼻韵母声调/an3.mp3",
            PinyinAudioPlayer.audioPathFor(parsePinyin("wǎn")))
        // yi 声调 = i 声调（站点无 yi1~4）
        assertEquals("单韵母声调/i1.mp3",
            PinyinAudioPlayer.audioPathFor(parsePinyin("yī")))
        // 普通声母+韵母不变
        assertEquals("声母/t.mp3,单韵母声调/i1.mp3",
            PinyinAudioPlayer.audioPathFor(parsePinyin("tī")))
        // 整体认读带声调
        assertEquals("整体认读声调/wu1.mp3",
            PinyinAudioPlayer.audioPathFor(parsePinyin("wū")))
    }
}
