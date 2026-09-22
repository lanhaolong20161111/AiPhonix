package com.example.ai.ui.englishtalk

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [cleanAsrText] / [appendSaid] / [PauseWatch] 的单测。
 *
 * ⚠️ 期望值全部来自跑 web 真实现的探针（web `useEnglishTurn.ts#cleanAsrText`），
 * 不是语义推导 —— 尤其 `a,b.c!d?e` **原样保留**（词中标点不清洗）这种反直觉口径。
 */
class EnglishTurnAsrTest {

    // ── cleanAsrText：与 web 逐例对齐 ──

    @Test
    fun clean_asr_text_matches_web_probe() {
        // 探针（tsx 跑 web 真实现）输出：
        assertEquals("hello world", cleanAsrText("hello, world."))
        assertEquals("i like apples", cleanAsrText("i like apples 。"))
        assertEquals("what is your name", cleanAsrText("what  is   your name?"))
        assertEquals("my name is Tom", cleanAsrText("my name is Tom."))
        assertEquals("hi", cleanAsrText("hi."))
        assertEquals("hello world foo", cleanAsrText("hello . world , foo !"))
        assertEquals("spaced out", cleanAsrText("  spaced   out  "))
        assertEquals("no punctuation here", cleanAsrText("no punctuation here"))
        assertEquals("wait ok", cleanAsrText("wait... ok!"))
        assertEquals("end with space", cleanAsrText("end with space. "))
        // 反直觉口径：词中标点后没有空白/句尾 ⇒ 原样保留
        assertEquals("a,b.c!d?e", cleanAsrText("a,b.c!d?e"))
    }

    @Test
    fun clean_asr_text_handles_js_whitespace_set() {
        // JS \s 含全角空格 U+3000 / NBSP；Kotlin \s 不认 ⇒ 必须用 JS 空白集
        assertEquals("hello world", cleanAsrText("hello\u3000world。"))
        assertEquals("ok", cleanAsrText("\u00A0ok\uFEFF"))
    }

    @Test
    fun clean_asr_text_empty_and_blank() {
        assertEquals("", cleanAsrText(""))
        assertEquals("", cleanAsrText("   "))
        assertEquals("", cleanAsrText("。！"))
    }

    // ── appendSaid：FIN_TEXT 拼接口径 ──

    @Test
    fun append_said_concat_rules() {
        assertEquals("hello", appendSaid("", "hello", "en"))
        assertEquals("hello world", appendSaid("hello", "world", "en"))
        // prev 已以空格结尾 → 不再插空格
        assertEquals("hello world", appendSaid("hello ", "world", "en"))
        // 百度重复回同一段 → 直接跳过（防整句翻倍）
        assertEquals("hello world", appendSaid("hello world", "world", "en"))
        // 中文不插空格
        assertEquals("你好世界", appendSaid("你好", "世界", "zh"))
    }

    // ── PauseWatch：静音判定（假时钟） ──

    /** 可手拨的假时钟（毫秒） */
    private class FakeClock {
        var t: Long = 0
        fun now(): Long = t
    }

    @Test
    fun pause_watch_fires_initial_silence_once() {
        val clock = FakeClock()
        val w = PauseWatch(pauseMs = 2_000, initialSilenceMs = 6_000, now = clock::now)
        w.onOpened()
        clock.t = 3_000
        assertEquals(PauseWatch.Tick.NONE, w.tick()) // 还没到 6s
        clock.t = 6_000
        assertEquals(PauseWatch.Tick.INITIAL, w.tick())
        clock.t = 6_300
        assertEquals(PauseWatch.Tick.NONE, w.tick()) // 只触发一次
    }

    @Test
    fun pause_watch_fires_pause_after_silence_and_resets_on_voice() {
        val clock = FakeClock()
        val w = PauseWatch(pauseMs = 2_000, initialSilenceMs = 6_000, now = clock::now)
        w.onOpened()
        clock.t = 1_000
        w.onVoice() // t=1000 说过话 → 首静默分支不再走
        clock.t = 2_500 // 距说话 1.5s < 2s
        assertEquals(PauseWatch.Tick.NONE, w.tick())
        clock.t = 3_100 // 距说话 2.1s ≥ 2s
        assertEquals(PauseWatch.Tick.PAUSE, w.tick())
        clock.t = 3_400
        assertEquals(PauseWatch.Tick.NONE, w.tick()) // 不重复触发
        // 一说话就重新允许提示
        clock.t = 3_500
        w.onVoice()
        clock.t = 5_600 // 距上次说话 2.1s
        assertEquals(PauseWatch.Tick.PAUSE, w.tick())
    }

    @Test
    fun pause_watch_asr_text_counts_as_speaking() {
        val clock = FakeClock()
        val w = PauseWatch(pauseMs = 2_000, initialSilenceMs = 6_000, now = clock::now)
        w.onOpened()
        w.onVoice() // t=0 说话
        clock.t = 2_500
        w.onAsrText() // ASR 出字 = 在说话：重置计时
        clock.t = 4_300 // 距 ASR 1.8s < 2s（若只看 onVoice 早已该触发）
        assertEquals(PauseWatch.Tick.NONE, w.tick())
        clock.t = 4_600 // 距 ASR 2.1s
        assertEquals(PauseWatch.Tick.PAUSE, w.tick())
    }

    @Test
    fun pause_watch_resume_keeps_initial_hint_fired() {
        val clock = FakeClock()
        val w = PauseWatch(pauseMs = 2_000, initialSilenceMs = 6_000, now = clock::now)
        w.onOpened()
        clock.t = 6_000
        assertEquals(PauseWatch.Tick.INITIAL, w.tick())
        // resume 续说：onOpened 不清 initialHintFired（只有新一轮 resetRound 才清）
        w.onOpened()
        clock.t = 12_000
        assertEquals(PauseWatch.Tick.NONE, w.tick())
        // 新一轮：允许再次触发
        w.resetRound()
        clock.t = 18_000
        assertEquals(PauseWatch.Tick.INITIAL, w.tick())
    }

    @Test
    fun pause_watch_zero_initial_silence_disables_it() {
        val clock = FakeClock()
        val w = PauseWatch(pauseMs = 2_000, initialSilenceMs = 0, now = clock::now)
        w.onOpened()
        clock.t = 60_000
        // initialSilenceMs=0（关闭）且没说过话 ⇒ 停顿分支也要求 hadVoice ⇒ 永不触发
        assertEquals(PauseWatch.Tick.NONE, w.tick())
    }
}
