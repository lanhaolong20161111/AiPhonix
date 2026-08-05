package com.example.ai.data.userimport

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * 导入数据本地加工层 — LLM 费用外移模式的核心（零 LLM 调用，纯本地规则）。
 *
 * 职责：
 * 1. generatePrompt — 用参数/原文填充模板占位符，生成用户要复制的提示词
 * 2. parse — 宽松解析 LLM 输出（容忍 markdown 代码块、多余文本）
 * 3. buildCandidates — 按 contentType 分派解析器 → 校验 → 规范化 → 去重
 *
 * 模板 → 解析器按 outputSchema（即 contentType）分组复用：vocab 一族共用一套，
 * article 是对象、其余是数组。这是"提示词 + schema + 解析器耦合"护城河的落地点。
 */
class ImportProcessor {

    private val json = Json { ignoreUnknownKeys = true }

    // ── 提示词生成 ──

    /** 用参数值 + 用户原文填充模板占位符 {{key}} */
    fun generatePrompt(
        template: ImportTemplate,
        paramValues: Map<String, String>,
        inputText: String,
    ): String {
        var prompt = template.promptTemplate

        // 特殊占位：mode=补全 时给 A1 模板追加说明
        if (template.id == "text_to_vocab" && paramValues["mode"] == "补全") {
            val note = "你收到的内容是一批已有词条（可能缺少拼音/释义/标签）。请为每条补全 pinyin、meaning、type、tags 字段，保持 text 不变，输出同样的 JSON 数组。\n"
            prompt = prompt.replace("{{mode_note}}", note)
        } else {
            prompt = prompt.replace("{{mode_note}}", "")
        }

        for ((key, value) in paramValues) {
            prompt = prompt.replace("{{$key}}", value)
        }
        prompt = prompt.replace("{{input_text}}", inputText)
        return prompt
    }

    // ── LLM 输出解析 ──

    /**
     * 从 LLM 原始输出中提取 JSON 数组。容忍：
     * - markdown 代码块 ```json ... ```
     * - 前后多余说明文字（取第一个 [ 到最后一个 ]）
     */
    fun parseJsonArray(raw: String): JsonArray? {
        val trimmed = raw.trim()
            .removePrefix("```json").removePrefix("```")
            .trim()
        // 直接尝试整体解析
        runCatching { return json.parseToJsonElement(trimmed).jsonArray }
        // 剥代码块后整体解析
        val cleaned = trimmed
            .removePrefix("```json").removePrefix("```")
            .removeSuffix("```")
            .trim()
        runCatching { return json.parseToJsonElement(cleaned).jsonArray }
        // 取第一个 [ 到最后一个 ]
        val start = trimmed.indexOf('[')
        val end = trimmed.lastIndexOf(']')
        if (start >= 0 && end > start) {
            runCatching {
                return json.parseToJsonElement(trimmed.substring(start, end + 1)).jsonArray
            }
        }
        return null
    }

    /** 从 LLM 原始输出中提取 JSON 对象（article 用） */
    fun parseJsonObject(raw: String): JsonObject? {
        val trimmed = raw.trim()
            .removePrefix("```json").removePrefix("```")
            .removeSuffix("```")
            .trim()
        runCatching { return json.parseToJsonElement(trimmed).jsonObject }
        val start = trimmed.indexOf('{')
        val end = trimmed.lastIndexOf('}')
        if (start >= 0 && end > start) {
            runCatching {
                return json.parseToJsonElement(trimmed.substring(start, end + 1)).jsonObject
            }
        }
        return null
    }

    // ── 加工：按 contentType 分派 → 校验 → 规范化 → 去重 ──

    /**
     * 透传：输出 JSON 对象中除已消费字段外的全部剩余字段，序列化为 payload JSON。
     * 这样模板新增任何元信息关键词（pos/phonetic/example/grammar/summary…）都不会丢。
     * 无剩余字段时返回空串。
     */
    private fun JsonObject.extraPayload(consumed: Set<String>): String {
        val extra = this.filterKeys { it !in consumed }
        if (extra.isEmpty()) return ""
        return Json.encodeToString(JsonElement.serializer(), JsonObject(extra))
    }

    /**
     * @param existingTexts 本地已存该 kind 的 text 集合（用于去重）
     * @return 加工后的候选列表；解析失败返回 null
     */
    fun buildCandidates(
        template: ImportTemplate,
        llmRaw: String,
        existingTexts: Set<String>,
    ): List<ImportCandidate>? {
        val raw = llmRaw.trim()
        if (raw.isEmpty()) return emptyList()

        return when (template.contentType) {
            "article" -> buildArticleCandidates(template, raw, existingTexts)
            "vocab" -> buildVocabCandidates(template, raw, existingTexts)
            "sentence" -> buildSentenceCandidates(template, raw, existingTexts)
            "pinyin" -> buildPinyinCandidates(template, raw, existingTexts)
            "quiz" -> buildQuizCandidates(template, raw, existingTexts)
            "answer" -> buildAnswerCandidates(template, raw, existingTexts)
            else -> null
        }
    }

    private fun buildArticleCandidates(
        template: ImportTemplate,
        raw: String,
        existingTexts: Set<String>,
    ): List<ImportCandidate>? {
        val obj = parseJsonObject(raw) ?: return null
        val title = obj.stringOr("title") ?: obj.stringOr("text")
        if (title.isNullOrBlank()) {
            return listOf(
                ImportCandidate(CandidateStatus.INVALID, "未识别到标题", "article", ""),
            )
        }
        val gradeLevel = obj.stringOr("gradeLevel").orEmpty()
        // 元信息透传：content/paragraphs/gradeLevel/summary/theme/newWords 及未知字段全保留
        val payloadJson = obj.extraPayload(setOf("title", "text"))
        val status = if (title in existingTexts) CandidateStatus.DUPLICATE else CandidateStatus.NEW
        return listOf(
            ImportCandidate(
                status = status,
                reason = if (status == CandidateStatus.DUPLICATE) "已存在" else "",
                kind = "article",
                text = title,
                meaning = "",
                tags = listOfNotNull(gradeLevel),
                payload = payloadJson,
            ),
        )
    }

    private fun buildVocabCandidates(
        template: ImportTemplate,
        raw: String,
        existingTexts: Set<String>,
    ): List<ImportCandidate>? {
        val array = parseJsonArray(raw) ?: return null
        val defaultTag = paramOf(template, "grade")
        return array.mapNotNull { el ->
            val obj = el.jsonObject
            val text = obj.stringOr("text")?.trim().orEmpty()
            if (text.isEmpty()) {
                return@mapNotNull ImportCandidate(CandidateStatus.INVALID, "缺少 text", "char", "")
            }
            val pinyin = normalizePinyin(obj.stringOr("pinyin").orEmpty())
            val meaning = obj.stringOr("meaning").orEmpty()
            val type = obj.stringOr("type")?.trim()?.takeIf { it == "word" } ?: "char"
            val tags = normalizeTags(obj.stringArrayOr("tags"), defaultTag)
            // 元信息透传：pos/phonetic/example/radical/strokes/synonyms/antonyms/difficulty 等
            // 除已消费字段外的全部剩余字段打包进 payload，未知字段也不丢
            val payload = obj.extraPayload(setOf("text", "pinyin", "meaning", "type", "tags"))
            val reason = when {
                text in existingTexts -> CandidateStatus.DUPLICATE
                else -> CandidateStatus.NEW
            }.let { status ->
                if (status == CandidateStatus.DUPLICATE) {
                    "已存在"
                } else {
                    listOfNotNull(
                        pinyin.isEmpty().takeIf { it }?.let { "缺拼音" },
                        meaning.isEmpty().takeIf { it }?.let { "缺释义" },
                    ).joinToString("/")
                }
            }
            ImportCandidate(
                status = if (text in existingTexts) CandidateStatus.DUPLICATE else CandidateStatus.NEW,
                reason = reason,
                kind = type,
                text = text,
                pinyin = pinyin,
                meaning = meaning,
                tags = tags,
                payload = payload,
            )
        }
    }

    private fun buildSentenceCandidates(
        template: ImportTemplate,
        raw: String,
        existingTexts: Set<String>,
    ): List<ImportCandidate>? {
        val array = parseJsonArray(raw) ?: return null
        return array.mapNotNull { el ->
            val obj = el.jsonObject
            val sentence = obj.stringOr("sentence")?.trim().orEmpty()
            if (sentence.isEmpty()) return@mapNotNull null
            val translation = obj.stringOr("translation").orEmpty()
            // 元信息透传：keywords/grammar/scene/difficulty 等剩余字段打包进 payload
            val payload = obj.extraPayload(setOf("sentence", "translation"))
            ImportCandidate(
                status = if (sentence in existingTexts) CandidateStatus.DUPLICATE else CandidateStatus.NEW,
                reason = if (sentence in existingTexts) "已存在" else "",
                kind = "sentence",
                text = sentence,
                pinyin = "",
                meaning = translation,
                tags = emptyList(),
                payload = payload,
            )
        }
    }

    private fun buildPinyinCandidates(
        template: ImportTemplate,
        raw: String,
        existingTexts: Set<String>,
    ): List<ImportCandidate>? {
        val array = parseJsonArray(raw) ?: return null
        return array.mapNotNull { el ->
            val obj = el.jsonObject
            val sentence = obj.stringOr("sentence")?.trim().orEmpty()
            if (sentence.isEmpty()) return@mapNotNull null
            val pinyin = obj.stringOr("pinyin").orEmpty()
            val translation = obj.stringOr("translation").orEmpty()
            // 元信息透传：scene/difficulty 等剩余字段打包进 payload
            val payload = obj.extraPayload(setOf("sentence", "pinyin", "translation"))
            ImportCandidate(
                status = if (sentence in existingTexts) CandidateStatus.DUPLICATE else CandidateStatus.NEW,
                reason = if (sentence in existingTexts) "已存在" else "",
                kind = "pinyin",
                text = sentence,
                pinyin = pinyin,
                meaning = translation,
                tags = emptyList(),
                payload = payload,
            )
        }
    }

    private fun buildQuizCandidates(
        template: ImportTemplate,
        raw: String,
        existingTexts: Set<String>,
    ): List<ImportCandidate>? {
        val array = parseJsonArray(raw) ?: return null
        return array.mapNotNull { el ->
            val obj = el.jsonObject
            val stem = obj.stringOr("stem")?.trim().orEmpty()
            if (stem.isEmpty()) return@mapNotNull null
            val type = obj.stringOr("type").orEmpty()
            val options = obj.stringArrayOr("options")
            val answer = obj.stringOr("answer").orEmpty()
            val explanation = obj.stringOr("explanation").orEmpty()
            val payload = buildString {
                append("{\"type\":")
                append(Json.encodeToString(JsonElement.serializer(), JsonPrimitive(type)))
                append(",\"options\":")
                append(Json.encodeToString(JsonElement.serializer(), JsonArray(options.map { JsonPrimitive(it) })))
                append(",\"answer\":")
                append(Json.encodeToString(JsonElement.serializer(), JsonPrimitive(answer)))
                append(",\"explanation\":")
                append(Json.encodeToString(JsonElement.serializer(), JsonPrimitive(explanation)))
                append("}")
            }
            ImportCandidate(
                status = if (stem in existingTexts) CandidateStatus.DUPLICATE else CandidateStatus.NEW,
                reason = if (stem in existingTexts) "已存在" else "",
                kind = "quiz",
                text = stem,
                pinyin = "",
                meaning = answer,
                tags = emptyList(),
                payload = payload,
            )
        }
    }

    private fun buildAnswerCandidates(
        template: ImportTemplate,
        raw: String,
        existingTexts: Set<String>,
    ): List<ImportCandidate>? {
        val array = parseJsonArray(raw) ?: return null
        return array.mapNotNull { el ->
            val obj = el.jsonObject
            val question = obj.stringOr("question")?.trim().orEmpty()
            if (question.isEmpty()) return@mapNotNull null
            val answer = obj.stringOr("answer").orEmpty()
            val isCorrect = obj["isCorrect"]?.jsonPrimitive?.booleanOrNull ?: true
            val explanation = obj.stringOr("explanation").orEmpty()
            val payload = buildString {
                append("{\"isCorrect\":")
                append(if (isCorrect) "true" else "false")
                append(",\"explanation\":")
                append(Json.encodeToString(JsonElement.serializer(), JsonPrimitive(explanation)))
                append("}")
            }
            ImportCandidate(
                status = if (question in existingTexts) CandidateStatus.DUPLICATE else CandidateStatus.NEW,
                reason = if (question in existingTexts) "已存在" else "",
                kind = "answer",
                text = question,
                pinyin = "",
                meaning = answer,
                tags = emptyList(),
                payload = payload,
            )
        }
    }

    // ── 规范化工具 ──

    /** 带声调符号 → 数字声调（yī → yi1、xiǎng → xiang3、lǜ → lv4）；已是数字格式保留 */
    fun normalizePinyin(p: String): String {
        val s = p.trim()
        if (s.isEmpty()) return ""
        // 已含数字声调（如 yi1 / xiang3 / lü4）→ 原样
        if (Regex("""[a-zA-ZüÜvV]+[1-5]$""").matches(s)) return s
        // 多音节（空格分隔）逐段转换，每段声调数字追加到音节末尾
        return s.split(' ').joinToString(" ") { convertToneSegment(it) }
    }

    private fun convertToneSegment(segment: String): String {
        val base = mapOf(
            'ā' to 'a', 'á' to 'a', 'ǎ' to 'a', 'à' to 'a',
            'ē' to 'e', 'é' to 'e', 'ě' to 'e', 'è' to 'e',
            'ī' to 'i', 'í' to 'i', 'ǐ' to 'i', 'ì' to 'i',
            'ō' to 'o', 'ó' to 'o', 'ǒ' to 'o', 'ò' to 'o',
            'ū' to 'u', 'ú' to 'u', 'ǔ' to 'u', 'ù' to 'u',
            'ǖ' to 'v', 'ǘ' to 'v', 'ǚ' to 'v', 'ǜ' to 'v',
        )
        val tone = mapOf(
            'ā' to '1', 'á' to '2', 'ǎ' to '3', 'à' to '4',
            'ē' to '1', 'é' to '2', 'ě' to '3', 'è' to '4',
            'ī' to '1', 'í' to '2', 'ǐ' to '3', 'ì' to '4',
            'ō' to '1', 'ó' to '2', 'ǒ' to '3', 'ò' to '4',
            'ū' to '1', 'ú' to '2', 'ǔ' to '3', 'ù' to '4',
            'ǖ' to '1', 'ǘ' to '2', 'ǚ' to '3', 'ǜ' to '4',
        )
        val sb = StringBuilder()
        var toneDigit: Char? = null
        for (c in segment) {
            val b = base[c]
            if (b != null) {
                sb.append(b)
                toneDigit = tone[c]
            } else {
                sb.append(c)
            }
        }
        if (toneDigit != null) sb.append(toneDigit)
        return sb.toString()
    }

    /** 标签去空白去重；空标签时补默认年级标签 */
    fun normalizeTags(tags: List<String>, defaultTag: String?): List<String> {
        val cleaned = tags.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        return if (cleaned.isEmpty() && !defaultTag.isNullOrBlank()) listOf(defaultTag) else cleaned
    }

    // ── 内部工具 ──

    private fun paramOf(template: ImportTemplate, key: String): String? =
        template.params.firstOrNull { it.key == key }?.default?.takeIf { it.isNotBlank() }
}

// ── JsonObject 便捷读取 ──

private fun JsonObject.stringOr(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.stringArrayOr(key: String): List<String> {
    val el = this[key] ?: return emptyList()
    if (el is JsonArray) {
        return el.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
    }
    return emptyList()
}
