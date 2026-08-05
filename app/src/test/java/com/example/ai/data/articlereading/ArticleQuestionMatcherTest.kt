package com.example.ai.data.articlereading

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticleQuestionMatcherTest {

    private val article = ArticleContent(
        title = "秋天的雨",
        paragraphs = listOf(
            "秋天的雨，是一把钥匙。它带着清凉和温柔，轻轻地、轻轻地，趁你没留意，把秋天的大门打开了。",
            "秋天的雨，有一盒五彩缤纷的颜料。你看，它把黄色给了银杏树，黄黄的叶子像一把把小扇子。",
            "秋天的雨，藏着非常好闻的气味。梨香香的，菠萝甜甜的，还有苹果、橘子，好多好多香甜的气味。",
        ),
    )

    @Test
    fun `匹配文章相关题目`() {
        val candidates = listOf(
            ImportedQuizQuestion(text = "《秋天的雨》里秋天的雨像什么？", answer = "一把钥匙"),
            ImportedQuizQuestion(text = "银杏树的叶子像什么？", answer = "小扇子"),
            ImportedQuizQuestion(text = "春天来了，小草发芽了。", answer = "春天"),
        )
        val matched = ArticleQuestionMatcher.match(article, candidates, limit = 3)
        assertEquals(2, matched.size)
        assertTrue(matched[0].text.contains("秋天的雨") || matched[0].text.contains("银杏"))
    }

    @Test
    fun `无相关题目时返回空`() {
        val candidates = listOf(
            ImportedQuizQuestion(text = "How are you?", answer = "Fine"),
            ImportedQuizQuestion(text = "计算机的工作原理是什么？", answer = "略"),
        )
        val matched = ArticleQuestionMatcher.match(article, candidates, limit = 3)
        assertTrue(matched.isEmpty())
    }

    @Test
    fun `空题库返回空`() {
        assertTrue(ArticleQuestionMatcher.match(article, emptyList()).isEmpty())
    }

    @Test
    fun `关键词提取过滤停用词并含标题词`() {
        val keywords = ArticleQuestionMatcher.extractKeywords(article)
        assertTrue(keywords.isNotEmpty())
        // 标题词加权更高
        val titleGram = keywords.entries.maxByOrNull { it.value }
        assertTrue(titleGram != null && titleGram.value >= 2)
        // 停用词不应出现
        assertTrue(keywords.keys.none { it in ArticleQuestionMatcher.STOP_WORDS })
    }

    @Test
    fun `限制返回数量`() {
        val candidates = listOf(
            ImportedQuizQuestion(text = "秋天的雨像什么？", answer = "钥匙"),
            ImportedQuizQuestion(text = "秋天的雨给了银杏什么颜色？", answer = "黄色"),
            ImportedQuizQuestion(text = "秋天的雨藏着什么气味？", answer = "香甜"),
            ImportedQuizQuestion(text = "秋天的雨是一把什么？", answer = "钥匙"),
        )
        val matched = ArticleQuestionMatcher.match(article, candidates, limit = 2)
        assertEquals(2, matched.size)
    }
}
