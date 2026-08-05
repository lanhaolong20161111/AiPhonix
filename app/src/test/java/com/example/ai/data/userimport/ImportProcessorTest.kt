package com.example.ai.data.userimport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.jsonObject

/**
 * ImportProcessor 本地加工层测试 — LLM 费用外移模式的核心逻辑。
 * 不依赖 Android Context，纯 Kotlin 规则测试。
 */
class ImportProcessorTest {

    private val processor = ImportProcessor()

    // ── 提示词生成 ──

    private fun template(
        id: String = "text_to_vocab",
        contentType: String = "vocab",
        inputType: String = "text",
        prompt: String = "提取：{{grade}}，原文：{{input_text}}",
        params: List<TemplateParam> = listOf(
            TemplateParam(key = "grade", label = "年级", type = "select", options = listOf("二年级上"), default = "二年级上"),
        ),
    ) = ImportTemplate(
        id = id, group = "text", name = "t", description = "",
        inputType = inputType, contentType = contentType, params = params,
        promptTemplate = prompt, privacyNotice = "", version = 1,
    )

    @Test
    fun `generatePrompt 替换参数与原文`() {
        val t = template(prompt = "年级{{grade}}，原文：{{input_text}}")
        val prompt = processor.generatePrompt(t, mapOf("grade" to "三年级上"), "猫 狗")
        assertEquals("年级三年级上，原文：猫 狗", prompt)
    }

    @Test
    fun `generatePrompt 补全模式注入 mode_note`() {
        val t = template(prompt = "{{mode_note}}开始")
        val prompt = processor.generatePrompt(t, mapOf("mode" to "补全"), "")
        assertTrue(prompt.contains("补全 pinyin"))
        assertTrue(prompt.startsWith("你收到的内容"))
    }

    // ── JSON 解析容错 ──

    @Test
    fun `parseJsonArray 容忍 markdown 代码块`() {
        val raw = """```json
[{"text":"猫","pinyin":"mao1","meaning":"猫科","type":"char","tags":["二年级上"]}]
```"""
        val arr = processor.parseJsonArray(raw)
        assertEquals(1, arr?.size)
    }

    @Test
    fun `parseJsonArray 容忍前后说明文字`() {
        val raw = "好的，已提取如下：\n[{\"text\":\"猫\"}]\n以上共 1 条。"
        val arr = processor.parseJsonArray(raw)
        assertEquals(1, arr?.size)
        assertEquals("猫", arr?.get(0)?.jsonObject?.get("text")?.toString()?.trim('"'))
    }

    @Test
    fun `parseJsonArray 非法输入返回 null`() {
        assertNull(processor.parseJsonArray("完全不是 JSON"))
        assertNull(processor.parseJsonArray(""))
    }

    // ── 词汇加工 ──

    @Test
    fun `buildCandidates vocab 正常与去重`() {
        val t = template()
        val raw = """[{"text":"狗","pinyin":"yī","meaning":"哺乳动物","type":"char","tags":["识字"]},
            {"text":"猫","pinyin":"mao1","meaning":"重复","type":"char","tags":[]},
            {"text":"苹果","pinyin":"ping2guo3","meaning":"水果","type":"word","tags":["二年级上"]}]"""
        val existing = setOf("猫", "苹果")
        val result = processor.buildCandidates(t, raw, existing)!!
        // 3 条：狗 NEW（含声调符号转换）、猫 DUPLICATE、苹果 DUPLICATE
        assertEquals(3, result.size)
        val dog = result.first { it.text == "狗" && it.status == CandidateStatus.NEW }
        assertEquals("yi1", dog.pinyin)          // yī → yi1
        assertEquals("char", dog.kind)
        assertEquals(listOf("识字"), dog.tags)   // 原 tags 非空 → 保留原样（默认年级仅空时补）
        assertTrue(result.any { it.text == "猫" && it.status == CandidateStatus.DUPLICATE })
        assertTrue(result.any { it.text == "苹果" && it.status == CandidateStatus.DUPLICATE })
    }

    @Test
    fun `buildCandidates vocab 缺 text 标 INVALID`() {
        val t = template()
        val raw = """[{"pinyin":"mao1","meaning":"没有text","type":"char"}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(CandidateStatus.INVALID, result[0].status)
    }

    @Test
    fun `buildCandidates vocab 缺拼音释义给 reason 但不拦截`() {
        val t = template()
        val raw = """[{"text":"狗","type":"char"}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(CandidateStatus.NEW, result[0].status)
        assertTrue(result[0].reason.contains("缺拼音"))
    }

    @Test
    fun `normalizePinyin 声调符号转数字`() {
        assertEquals("yi1", processor.normalizePinyin("yī"))
        assertEquals("xiang3", processor.normalizePinyin("xiǎng"))
        assertEquals("lv4", processor.normalizePinyin("lǜ"))
        assertEquals("mao1", processor.normalizePinyin("mao1"))  // 已是数字格式
        assertEquals("hello", processor.normalizePinyin("hello")) // 非拼音原样
    }

    // ── 文章加工 ──

    @Test
    fun `buildCandidates article 对象解析`() {
        val t = template(id = "text_to_article", contentType = "article", prompt = "{{input_text}}")
        val raw = """{"title":"小壁虎借尾巴","content":"小壁虎在墙角捉蚊子。","paragraphs":["小壁虎在墙角捉蚊子。"],"gradeLevel":"二年级上"}"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        val c = result[0]
        assertEquals("article", c.kind)
        assertEquals("小壁虎借尾巴", c.text)
        assertTrue(c.payload.contains("小壁虎在墙角捉蚊子"))
        assertTrue(c.tags.contains("二年级上"))
    }

    @Test
    fun `buildCandidates article 无标题标 INVALID`() {
        val t = template(id = "text_to_article", contentType = "article", prompt = "{{input_text}}")
        val raw = """{"content":"只有正文没有标题"}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(CandidateStatus.INVALID, result[0].status)
    }

    // ── 句子/题目/答案加工 ──

    @Test
    fun `buildCandidates sentence 提取翻译与关键词`() {
        val t = template(id = "text_to_sentence", contentType = "sentence", prompt = "{{input_text}}")
        val raw = """[{"sentence":"How are you?","translation":"你好吗？","keywords":["how","are","you"]}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertEquals("sentence", result[0].kind)
        assertEquals("How are you?", result[0].text)
        assertEquals("你好吗？", result[0].meaning)
        assertTrue(result[0].payload.contains("how"))
    }

    @Test
    fun `buildCandidates vocab 元信息透传进 payload`() {
        val t = template(id = "text_to_vocab", contentType = "vocab", prompt = "{{input_text}}")
        val raw = """[{"text":"cat","pinyin":"","meaning":"猫","type":"word","tags":["二年级上"],
            "pos":"noun","phonetic":"/kæt/","example":"The cat is sleeping.","exampleTranslation":"猫在睡觉。",
            "synonyms":["kitty"],"antonyms":[],"difficulty":1}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertEquals("cat", result[0].text)
        assertTrue(result[0].payload.contains("\"pos\":\"noun\""))
        assertTrue(result[0].payload.contains("/kæt/"))
        assertTrue(result[0].payload.contains("The cat is sleeping."))
        assertTrue(result[0].payload.contains("kitty"))
        assertTrue(result[0].payload.contains("\"difficulty\":1"))
        // 已消费字段不进 payload
        assertFalse(result[0].payload.contains("\"text\""))
        assertFalse(result[0].payload.contains("\"pinyin\""))
        assertFalse(result[0].payload.contains("\"meaning\""))
    }

    @Test
    fun `buildCandidates vocab 未知字段也透传不丢`() {
        val t = template(id = "text_to_vocab", contentType = "vocab", prompt = "{{input_text}}")
        val raw = """[{"text":"花","pinyin":"hua1","meaning":"植物开的花朵","type":"char","tags":["一年级下"],
            "radical":"艹","strokes":7,"customField":"任意值"}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertTrue(result[0].payload.contains("\"radical\":\"艹\""))
        assertTrue(result[0].payload.contains("\"strokes\":7"))
        assertTrue(result[0].payload.contains("customField"))
    }

    @Test
    fun `buildCandidates pinyin 提取拼音与元信息透传`() {
        val t = template(id = "text_to_pinyin", contentType = "pinyin", prompt = "{{input_text}}")
        val raw = """[{"sentence":"我喜欢学习","pinyin":"wǒ xǐ huān xué xí","translation":"I like studying","scene":"课堂","difficulty":1}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertEquals("pinyin", result[0].kind)
        assertEquals("我喜欢学习", result[0].text)
        assertEquals("wǒ xǐ huān xué xí", result[0].pinyin)
        assertEquals("I like studying", result[0].meaning)
        // 元信息透传进 payload
        assertTrue(result[0].payload.contains("\"scene\":\"课堂\""))
        assertTrue(result[0].payload.contains("\"difficulty\":1"))
        // 已消费字段不进 payload
        assertFalse(result[0].payload.contains("\"sentence\""))
        assertFalse(result[0].payload.contains("\"pinyin\""))
        assertFalse(result[0].payload.contains("\"translation\""))
    }

    @Test
    fun `buildCandidates sentence 语法场景难度透传`() {
        val t = template(id = "text_to_sentence", contentType = "sentence", prompt = "{{input_text}}")
        val raw = """[{"sentence":"How are you?","translation":"你好吗？","keywords":["how"],
            "grammar":"特殊疑问句","scene":"打招呼","difficulty":1}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertTrue(result[0].payload.contains("特殊疑问句"))
        assertTrue(result[0].payload.contains("打招呼"))
        assertTrue(result[0].payload.contains("\"difficulty\":1"))
        // sentence/translation 已消费不进 payload
        assertFalse(result[0].payload.contains("How are you?"))
        assertFalse(result[0].payload.contains("你好吗？"))
    }

    @Test
    fun `buildCandidates article 摘要主题生词透传`() {
        val t = template(id = "text_to_article", contentType = "article", prompt = "{{input_text}}")
        val raw = """{"title":"小壁虎借尾巴","content":"小壁虎在墙角捉蚊子。",
            "paragraphs":["小壁虎在墙角捉蚊子。"],"gradeLevel":"二年级上",
            "summary":"小壁虎借尾巴的故事","theme":"动物尾巴的作用",
            "newWords":[{"word":"壁虎","pinyin":"bi4 hu3","meaning":"一种爬行动物"}]}"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertEquals("小壁虎借尾巴", result[0].text)
        assertTrue(result[0].payload.contains("小壁虎在墙角捉蚊子"))
        assertTrue(result[0].payload.contains("小壁虎借尾巴的故事"))
        assertTrue(result[0].payload.contains("动物尾巴的作用"))
        assertTrue(result[0].payload.contains("壁虎"))
        // title 已消费进 text，不进 payload
        assertFalse(result[0].payload.contains("\"title\""))
    }

    @Test
    fun `buildCandidates quiz 提取题目明细`() {
        val t = template(id = "image_to_quiz", contentType = "quiz", inputType = "image", prompt = "识别图片")
        val raw = """[{"type":"选择","stem":"3+5=？","options":["6","7","8","9"],"answer":"8","explanation":""}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertEquals("quiz", result[0].kind)
        assertEquals("3+5=？", result[0].text)
        assertEquals("8", result[0].meaning)
        assertTrue(result[0].payload.contains("\"options\""))
        assertTrue(result[0].payload.contains("8"))
    }

    @Test
    fun `buildCandidates answer 提取答案与判定`() {
        val t = template(id = "image_to_answer", contentType = "answer", inputType = "image", prompt = "识别图片")
        val raw = """[{"question":"3+5=？","answer":"8","isCorrect":true,"explanation":"3+5=8"}]"""
        val result = processor.buildCandidates(t, raw, emptySet())!!
        assertEquals(1, result.size)
        assertEquals("answer", result[0].kind)
        assertTrue(result[0].payload.contains("true"))
    }

    @Test
    fun `buildCandidates 未知 contentType 返回 null`() {
        val t = template(contentType = "unknown")
        assertNull(processor.buildCandidates(t, "[]", emptySet()))
    }
}
