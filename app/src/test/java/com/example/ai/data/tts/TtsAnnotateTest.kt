package com.example.ai.data.tts

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 期望值取自 `web/_ttsannot_probe.mts`（直接 import web 的 `annotateTts`）打印的输出。
 *
 * ⚠️ 只覆盖 `polyphoneOnly = false`（古诗朗读走的分支）：
 * Android 端没有 web 的 `data/polyphoneChars` 多音字表，`polyphoneOnly = true` 时一律不注音
 * （探针里 `重庆银行` 传 true 的输出也恰好是原样，两边一致）。
 */
class TtsAnnotateTest {

    @Test
    fun annotatesEveryHanziWithNumericTone() {
        assertEquals(
            "远(yuan3)上(shang4)寒(han2)山(shan1)石(shi2)径(jing4)斜(xie2)，白(bai2)云(yun2)生(sheng1)处(chu4)有(you3)人(ren2)家(jia1)。",
            annotateTts(
                "远上寒山石径斜，白云生处有人家。",
                "yuan3 shang4 han2 shan1 shi2 jing4 xie2 bai2 yun2 sheng1 chu4 you3 ren2 jia1",
            ),
        )
    }

    @Test
    fun toneMarkedPinyinIsNormalizedToNumericTone() {
        // 「xié」（带声调符号）也要转成 xie2
        assertEquals(
            "远(yuan3)上(shang4)寒(han2)山(shan1)石(shi2)径(jing4)斜(xie2)，白(bai2)云(yun2)生(sheng1)处(chu4)有(you3)人(ren2)家(jia1)。",
            annotateTts(
                "远上寒山石径斜，白云生处有人家。",
                "yuǎn shàng hán shān shí jìng xié bái yún shēng chù yǒu rén jiā",
            ),
        )
        assertEquals("石(shi2)径(jing4)斜(xie2)", annotateTts("石径斜", "shi2 jing4 xié"))
    }

    @Test
    fun syllableWithoutToneIsNotAnnotated() {
        // 「xie」没有声调 ⇒ toBaiduSyllable 返回 "" ⇒ 该字不注音（否则百度会把拼音字母念出来）
        assertEquals("石(shi2)径(jing4)斜", annotateTts("石径斜", "shi2 jing4 xie"))
    }

    @Test
    fun hanziCountMustMatchSyllableCount() {
        // 少一个音节 ⇒ 原样返回
        assertEquals("石径斜", annotateTts("石径斜", "shi2 jing4"))
        // 多一个音节 ⇒ 原样返回
        assertEquals("石径斜", annotateTts("石径斜", "shi2 jing4 xie2 duo1"))
    }

    @Test
    fun blankPinyinReturnsTextUnchanged() {
        assertEquals("石径斜", annotateTts("石径斜", ""))
        assertEquals("石径斜", annotateTts("石径斜", "   "))
    }

    @Test
    fun punctuationAndNewlinesArePreserved() {
        assertEquals(
            "床(chuang2)前(qian2)明(ming2)月(yue4)光(guang1)，\n疑(yi2)是(shi4)地(di4)上(shang4)霜(shuang1)。",
            annotateTts(
                "床前明月光，\n疑是地上霜。",
                "chuang2 qian2 ming2 yue4 guang1 yi2 shi4 di4 shang4 shuang1",
            ),
        )
    }

    @Test
    fun nonHanziAreLeftAloneButStillCountedCorrectly() {
        // 「第1句：好的」只有 4 个汉字 ⇒ 4 个音节可注音，数字/标点原样保留
        assertEquals("第(di4)1句(ju4)：好(hao3)的(de5)", annotateTts("第1句：好的", "di4 ju4 hao3 de5"))
        // 音节数按"汉字数"算，给了 5 个（多算了数字 1）⇒ 对不上 ⇒ 原样返回
        assertEquals("第1句：好的", annotateTts("第1句：好的", "di4 yi1 ju4 hao3 de5"))
    }

    @Test
    fun polyphoneOnlyTrueDoesNotAnnotateOnAndroid() {
        // Android 无多音字表 ⇒ true 分支一律不注音（web 探针此例输出也是原样，两边一致）
        assertEquals("重庆银行", annotateTts("重庆银行", "chong2 qing4 yin2 hang2", polyphoneOnly = true))
    }
}
