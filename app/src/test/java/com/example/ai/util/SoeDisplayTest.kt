package com.example.ai.util

import com.example.ai.data.model.WordScore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `SoeDisplay` 的单测 —— **期望值全部取自 web 真实实现**（`web/src/lib/soeDisplay.ts`，
 * 用 `npx tsx` 跑探针打印，而非手推），保证 Android 与 web 的展示口径逐字一致。
 *
 * 反直觉点（都在下面的用例里钉住）：
 * - `accuracy = 0` 且 `matchTag = 2` 仍算「未读」（MatchTag 优先于分数）
 * - `accuracy = -0.5 / -1` 且 `matchTag !== 2` **也算**未读（负分即未读到）
 * - `59.5` 四舍五入成 `60`，但色阶是 `bad`（取整不等于分档）
 * - `restoreWordCase` 是把词**改写成参考文本里的写法**，所以 `iPad` 会被改成 `ipad`
 */
class SoeDisplayTest {

    @Test
    fun `isMissing 覆盖 匹配标记 负分 与 NaN`() {
        // 期望值来自探针：miss(-1,2)=true / miss(-1,0)=true / miss(0,2)=true / miss(NaN,0)=true / miss(-0.5,1)=true
        assertTrue(SoeDisplay.isMissing(-1f, 2))
        assertTrue(SoeDisplay.isMissing(-1f, 0))
        assertTrue(SoeDisplay.isMissing(0f, 2))
        assertTrue(SoeDisplay.isMissing(Float.NaN, 0))
        assertTrue(SoeDisplay.isMissing(-0.5f, 1))
        // 正常分不算未读
        assertFalse(SoeDisplay.isMissing(85f, 0))
        assertFalse(SoeDisplay.isMissing(0f, 0))
    }

    @Test
    fun `formatScore 缺读显示未读 其余四舍五入`() {
        assertEquals("未读", SoeDisplay.formatScore(-1f, 2))
        assertEquals("未读", SoeDisplay.formatScore(-1f, 0))
        assertEquals("未读", SoeDisplay.formatScore(Float.NaN, 0))
        assertEquals("85", SoeDisplay.formatScore(85f, 0))
        assertEquals("79", SoeDisplay.formatScore(79.4f, 0))
        assertEquals("60", SoeDisplay.formatScore(59.5f, 0))
    }

    @Test
    fun `scoreClass 分档边界`() {
        assertEquals(SoeDisplay.ScoreClass.MISS, SoeDisplay.scoreClass(-1f, 2))
        assertEquals(SoeDisplay.ScoreClass.MISS, SoeDisplay.scoreClass(Float.NaN, 0))
        assertEquals(SoeDisplay.ScoreClass.GOOD, SoeDisplay.scoreClass(80f, 0))
        assertEquals(SoeDisplay.ScoreClass.GOOD, SoeDisplay.scoreClass(100f, 0))
        assertEquals(SoeDisplay.ScoreClass.OK, SoeDisplay.scoreClass(79.4f, 0))
        assertEquals(SoeDisplay.ScoreClass.OK, SoeDisplay.scoreClass(60f, 0))
        // 59.5 取整是 60，但分档仍算 bad
        assertEquals(SoeDisplay.ScoreClass.BAD, SoeDisplay.scoreClass(59.5f, 0))
        // 0 分（读到了但很差）是 bad，不是 miss
        assertEquals(SoeDisplay.ScoreClass.BAD, SoeDisplay.scoreClass(0f, 0))
    }

    private fun words(vararg w: String) = w.map { WordScore(word = it, pronAccuracy = 90f) }

    private fun List<WordScore>.texts() = map { it.word }

    @Test
    fun `restoreWordCase 顺序双指针还原大小写`() {
        // ref="I play games" ["i","play","games"] -> ["I","play","games"]
        assertEquals(
            listOf("I", "play", "games"),
            SoeDisplay.restoreWordCase(words("i", "play", "games"), "I play games").texts(),
        )
        // 漏词时指针单向前进：ref="I play games" ["i","games"] -> ["I","games"]
        assertEquals(
            listOf("I", "games"),
            SoeDisplay.restoreWordCase(words("i", "games"), "I play games").texts(),
        )
        // 重复词不串位：the cat and the dog
        assertEquals(
            listOf("The", "cat", "and", "the", "dog"),
            SoeDisplay.restoreWordCase(
                words("the", "cat", "and", "the", "dog"),
                "The cat and the dog",
            ).texts(),
        )
        // 专名首字母大写
        assertEquals(
            listOf("Lily"),
            SoeDisplay.restoreWordCase(words("lily"), "Lily is here").texts(),
        )
        // 参考文本里找不到同形词 → 保持原样（不猜）
        assertEquals(
            listOf("xyz"),
            SoeDisplay.restoreWordCase(words("xyz"), "abc def").texts(),
        )
        // 弯撇号 → 直撇号后能匹配，并还原成参考文本的弯撇号
        assertEquals(
            listOf("Don\u2019t"),
            SoeDisplay.restoreWordCase(words("don't"), "Don\u2019t go").texts(),
        )
        // 归一化是「改写成参考写法」：iPad → ipad（因为参考文本里就是 ipad）
        assertEquals(
            listOf("ipad"),
            SoeDisplay.restoreWordCase(words("iPad"), "my ipad is new").texts(),
        )
        // 空词跳过；短语（含空格）不在 token 里 → 保持原样
        assertEquals(
            listOf(""),
            SoeDisplay.restoreWordCase(words(""), "abc").texts(),
        )
    }

    @Test
    fun `restoreWordCase 空输入原样返回`() {
        assertEquals(emptyList<String>(), SoeDisplay.restoreWordCase(emptyList(), "abc").texts())
        assertEquals(
            listOf("apple"),
            SoeDisplay.restoreWordCase(words("apple"), "   ").texts(),
        )
    }
}
