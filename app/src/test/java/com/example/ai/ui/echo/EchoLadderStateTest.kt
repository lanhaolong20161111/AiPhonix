package com.example.ai.ui.echo

import com.example.ai.data.model.WordScore
import com.example.ai.util.splitEnWords
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `EchoLadderState` 的单测 —— 期望值来自探针 `web/_echoladder_probe.mjs`：
 * 该探针**照抄** `web/src/components/EchoLadder.tsx` 的 `PASS` / `normWord` / `soeScene` /
 * `failingChunk` / `handleScore` 与 `AiEnglishTalkPage.tsx` 的 `EN_WORD_RE`，
 * 用 `node` 跑出真实结果（含状态迁移序列），而非手推。
 *
 * 钉住的反直觉点：
 * - `failingChunk` 用 `steps.find` ⇒ 常返回**第 1 个单位**，不是当前等级的单位
 * - 失败判据是**严格 `< 70`**：恰好 70 分**不算**失败
 * - `level == 1` 时**永远不降级**到小步（哪怕连错很多次）
 * - 小步过关后**回原级**（不升级、也不清 level）
 * - `accuracy` 缺失按 0 处理 ⇒ 缺明细的词一律算失败
 */
class EchoLadderStateTest {

    /** 台阶样例（与探针一致）：splitEnWords("Yes, I like the park.") */
    private val units = splitEnWords("Yes, I like the park.")

    private fun state() = EchoLadderState(units = units, sentence = "Yes, I like the park.")

    /** 全部单位都给同一分数 */
    private fun allAt(score: Float): List<WordScore> = units.map { WordScore(word = it, pronAccuracy = score) }

    @Test
    fun `每个单位都是一个台阶`() {
        val s = state()
        assertEquals(listOf("Yes", "I", "like", "the", "park"), s.steps)
        assertEquals(5, s.total)
        assertTrue(s.wordMode)
        assertEquals("词", s.unitLabel)
        assertEquals(1, s.level)
        assertEquals("Yes", s.target)
        assertEquals("word", s.scene)
    }

    @Test
    fun `target 是前 level 个单位的空格拼接`() {
        val s = state()
        s.onScore(95, allAt(95f)) // -> level 2
        assertEquals(2, s.level)
        assertEquals("Yes I", s.target)
        assertEquals("sentence", s.scene)
        s.onScore(95, allAt(95f)) // -> level 3
        assertEquals("Yes I like", s.target)
    }

    @Test
    fun `chunks 模式与空台阶的退化`() {
        val c = EchoLadderState(chunks = listOf("I want", "to go", "home"), sentence = "I want to go home")
        assertFalse(c.wordMode)
        assertEquals("片段", c.unitLabel)
        assertEquals(3, c.total)
        assertEquals("I want", c.target)

        // steps 为空 ⇒ target 退化成整句（web：total > 0 ? slice : sentence）
        val empty = EchoLadderState(sentence = "Hello there")
        assertEquals(0, empty.total)
        assertEquals("Hello there", empty.target)

        // units 里全是空白 ⇒ wordMode 仍为 true（按 units 是否**非空**判），但 steps 被过滤空了
        val blank = EchoLadderState(units = listOf("  ", "\t"))
        assertTrue(blank.wordMode)
        assertEquals(0, blank.total)
    }

    @Test
    fun `一路满分逐级升到整句后完成`() {
        val s = state()
        assertEquals(EchoLadderState.Event.LEVEL_UP, s.onScore(95, allAt(95f)))
        assertEquals(2, s.level)
        assertEquals(EchoLadderState.Event.LEVEL_UP, s.onScore(95, allAt(95f)))
        assertEquals(EchoLadderState.Event.LEVEL_UP, s.onScore(95, allAt(95f)))
        assertEquals(EchoLadderState.Event.LEVEL_UP, s.onScore(95, allAt(95f)))
        assertEquals(5, s.level)
        assertEquals("Yes I like the park", s.target)
        // 第 5 级过关 ⇒ 完成（不再升到 6）
        assertEquals(EchoLadderState.Event.FINISH_ALL, s.onScore(95, allAt(95f)))
        assertTrue(s.done)
        assertEquals(5, s.level)
        // 完成后再来分数：不再改状态
        assertEquals(EchoLadderState.Event.NONE, s.onScore(95, allAt(95f)))
        assertEquals(EchoLadderState.Event.NONE, s.onScore(20, allAt(20f)))
    }

    @Test
    fun `第 1 级连错也不降级`() {
        val s = state()
        assertEquals(EchoLadderState.Event.FAIL, s.onScore(50, allAt(50f)))
        assertEquals(1, s.failCount)
        assertNull(s.drill)
        assertEquals(EchoLadderState.Event.FAIL, s.onScore(50, allAt(50f)))
        assertEquals(2, s.failCount)
        assertNull(s.drill) // level == 1 ⇒ 永远不降级
        assertEquals(2, s.retry)
        // 过关 → 进第 2 级，failCount 清零
        assertEquals(EchoLadderState.Event.LEVEL_UP, s.onScore(95, allAt(95f)))
        assertEquals(2, s.level)
        assertEquals(0, s.failCount)
    }

    @Test
    fun `第 2 级连错两次降级到失败单位做小步`() {
        val s = state()
        s.onScore(95, allAt(95f)) // -> level 2
        assertEquals(EchoLadderState.Event.FAIL, s.onScore(50, allAt(50f)))
        assertNull(s.drill)
        assertEquals(EchoLadderState.Event.FAIL, s.onScore(50, allAt(50f)))
        assertEquals(2, s.failCount)
        // 探针实测：全错时 failingChunk 命中**第 1 个单位** "Yes"
        assertEquals("Yes", s.drill)
        assertEquals("Yes", s.target)
    }

    @Test
    fun `失败词在第 2 个单位时小步命中它`() {
        val s = state()
        s.onScore(95, allAt(95f)) // -> level 2
        val secondBad = units.mapIndexed { i, w -> WordScore(word = w, pronAccuracy = if (i == 1) 30f else 95f) }
        s.onScore(30, secondBad)
        s.onScore(30, secondBad)
        assertEquals("I", s.drill)
    }

    @Test
    fun `小步过关回原级且不清等级`() {
        val s = state()
        s.onScore(95, allAt(95f)) // level 2
        s.onScore(50, allAt(50f))
        s.onScore(50, allAt(50f)) // drill = "Yes"
        assertEquals("Yes", s.drill)
        assertEquals(EchoLadderState.Event.DRILL_CLEAR, s.onScore(95, allAt(95f)))
        assertNull(s.drill)
        assertEquals(0, s.failCount)
        assertEquals(2, s.level) // 回原级，不升级
        assertEquals("Yes I", s.target)
    }

    @Test
    fun `小步再不过则失败次数继续累加且小步不变`() {
        val s = state()
        s.onScore(95, allAt(95f))
        s.onScore(50, allAt(50f))
        s.onScore(50, allAt(50f))
        assertEquals(2, s.failCount)
        assertEquals(EchoLadderState.Event.FAIL, s.onScore(40, allAt(40f)))
        assertEquals(3, s.failCount)
        assertEquals("Yes", s.drill) // 已有 drill ⇒ 不再重新定位
    }

    @Test
    fun `分数字段的边界 Null 与恰好过关线`() {
        val s = state()
        // null = 没拿到分数 ⇒ 不改状态（web 直接 return）
        assertEquals(EchoLadderState.Event.NONE, s.onScore(null, allAt(95f)))
        assertEquals(1, s.level)
        assertEquals(0, s.failCount)
        // 恰好 70 分 ⇒ 过关
        assertEquals(EchoLadderState.Event.LEVEL_UP, s.onScore(70, allAt(70f)))
        assertEquals(2, s.level)
        // 69 分 ⇒ 失败
        assertEquals(EchoLadderState.Event.FAIL, s.onScore(69, allAt(69f)))
        assertEquals(1, s.failCount)
    }

    @Test
    fun `failingChunk 的明细判定`() {
        val s = state()
        // 全对 ⇒ 没有失败词
        assertNull(s.failingChunk(allAt(90f)))
        // 恰好 70 分不算失败（严格小于）
        assertNull(s.failingChunk(allAt(70f)))
        // 第 3 个词（like）差
        val thirdBad = units.mapIndexed { i, w -> WordScore(word = w, pronAccuracy = if (i == 2) 55f else 90f) }
        assertEquals("like", s.failingChunk(thirdBad))
        // 末词（park）差
        val lastBad = units.mapIndexed { i, w -> WordScore(word = w, pronAccuracy = if (i == units.size - 1) 10f else 90f) }
        assertEquals("park", s.failingChunk(lastBad))
        // accuracy 缺失 ⇒ 默认 0 ⇒ 算失败
        assertEquals("like", s.failingChunk(listOf(WordScore(word = "like"))))
        // 词表带标点/大小写也能匹配（normEnWord 归一化两侧）
        assertEquals("park", s.failingChunk(listOf(WordScore(word = "PARK,", pronAccuracy = 10f))))
        // 坏词不在台阶里 ⇒ null
        assertNull(s.failingChunk(listOf(WordScore(word = "banana", pronAccuracy = 10f))))
        // 拿不到明细 ⇒ null（web：words 非数组即返回 null）
        assertNull(s.failingChunk(null))
        assertNull(s.failingChunk(emptyList()))
    }

    @Test
    fun `forceFinish 只置完成不动等级`() {
        val s = state()
        s.onScore(95, allAt(95f)) // level 2
        s.forceFinish()
        assertTrue(s.done)
        assertEquals(2, s.level)
        assertEquals(0, s.failCount)
        assertNull(s.drill)
        // 完成后再来分数不再改状态
        assertEquals(EchoLadderState.Event.NONE, s.onScore(95, allAt(95f)))
        assertEquals(2, s.level)
    }

    @Test
    fun `view 快照带出渲染需要的全部派生值`() {
        val s = state()
        s.onScore(95, allAt(95f))
        val v = s.view()
        assertEquals(units, v.steps)
        assertEquals(2, v.level)
        assertEquals(5, v.total)
        assertNull(v.drill)
        assertFalse(v.done)
        assertTrue(v.wordMode)
        assertEquals("Yes I", v.target)
        assertEquals("词", v.unitLabel)
        assertEquals(70, EchoLadderState.PASS)
    }
}
