package com.example.ai.data.phonics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `PhonemeTips` 对拍单测 —— 期望值来自 web 真实现（`web/_phonics_probe.ts` 跑
 * `phoneTip` / `tipSpeechText` 产出的 JSON）。
 */
class PhonemeTipsTest {

    @Test
    fun local_tip_count() {
        assertEquals(44, LOCAL_TIP_COUNT)
    }

    @Test
    fun phone_tip_lookup_and_norm() {
        assertEquals("舌尖轻轻伸到上下牙齿中间，送气，别读成 s 或 z", phoneTip("th")?.tip)
        // 尾随重音数字应被去掉（th1 → TH）
        assertEquals(phoneTip("th")?.tip, phoneTip("th1")?.tip)
        // 小写也行
        assertEquals(phoneTip("th")?.tip, phoneTip("TH")?.tip)
        // 带 r 双元音的逗号写法 ih,r → IHR
        assertEquals("从 ɪ 滑向卷舌，一口气连着", phoneTip("ih,r")?.tip)
        assertEquals(TipCategory.R_CONTROL, phoneTip("ih,r")?.cat)
        // 弱读 ah0 → AH（归并到 AH 条目，cat 是 vowel；AH0 仅在查 AH0 时命中）
        assertEquals("嘴自然放松微微张开，短促有力", phoneTip("ah0")?.tip)
        assertEquals(TipCategory.VOWEL, phoneTip("ah0")?.cat)
        // 中文拼音音素不在表内
        assertNull(phoneTip("o1"))
        assertNull(phoneTip("zzz"))
    }

    @Test
    fun has_local_tip() {
        assertTrue(hasLocalTip("th"))
        assertTrue(hasLocalTip("s"))
        assertTrue(hasLocalTip("zh"))
        assertFalse(hasLocalTip("o1"))
    }

    @Test
    fun local_tip_text() {
        assertEquals(phoneTip("v")?.tip, localTipText("v"))
        assertNull(localTipText("nope"))
    }

    @Test
    fun tip_speech_text_cleaning() {
        // 本地表 44 条全是纯中文 → 幂等不变
        val local = "上牙轻咬下唇，只送气不发声"
        assertEquals(local, tipSpeechText(local, emptyList()))

        // LLM 固定句式：的 f 时 → 的这个音时
        assertEquals(
            "读 friend 的这个音时，上牙轻轻咬下嘴唇再送气哦",
            tipSpeechText("读 friend 的 f 时，上牙轻轻咬下嘴唇再送气哦", emptyList()),
        )
        // 带定界符 /f/ → 这个音
        assertEquals(
            "读作 这个音 时嘴唇收圆",
            tipSpeechText("读作 /f/ 时嘴唇收圆", emptyList()),
        )
        // 带定界符 [th] → 这个音
        assertEquals(
            "标成 这个音 的时候要卷舌",
            tipSpeechText("标成 [th] 的时候要卷舌", emptyList()),
        )
        // 的 th 的「音」是中文但 th 后面没有紧跟中文 → 不变（防误改）
        assertEquals(
            "读 th 的音，舌尖伸到牙齿中间",
            tipSpeechText("读 th 的音，舌尖伸到牙齿中间", emptyList()),
        )
    }
}
