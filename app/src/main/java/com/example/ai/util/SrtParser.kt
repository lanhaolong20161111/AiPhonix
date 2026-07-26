package com.example.ai.util

import android.util.Log

data class SubtitleEntry(
    val index: Int,
    val startMs: Long,
    val endMs: Long,
    val text: String
)

object SrtParser {

    private val TIMESTAMP_REGEX = Regex("""(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})""")

    /**
     * 解析 SRT 字幕文件内容，返回字幕条目列表
     */
    fun parse(srtContent: String): List<SubtitleEntry> {
        val entries = mutableListOf<SubtitleEntry>()
        val blocks = srtContent.trim().split(Regex("\n\n|\r\n\r\n"))

        for (block in blocks) {
            val lines = block.trim().split("\n").map { it.trim() }.filter { it.isNotBlank() }
            if (lines.size < 3) continue

            val index = lines[0].toIntOrNull() ?: continue
            val timeMatch = TIMESTAMP_REGEX.findAll(lines[1]).toList()
            if (timeMatch.size < 2) continue

            val startMs = timeToMs(timeMatch[0].groupValues)
            val endMs = timeToMs(timeMatch[1].groupValues)

            // 字幕文本可能是多行（去掉序号行和时间行）
            val text = lines.drop(2).joinToString(" ").trim()
                .replace(Regex("<[^>]*>"), "")   // 去掉 HTML 标签
                .replace(Regex("""\{[^}]*\}"""), "") // 去掉 {} 样式标记
                .replace(Regex("""\[[^\]]*\]"""), "") // 去掉 [Music] 等描述性标记
                .trim()

            if (text.isNotBlank()) {
                entries.add(SubtitleEntry(index, startMs, endMs, text))
            }
        }

        Log.d("SrtParser", "解析完成：${entries.size} 条字幕")
        return entries
    }

    /**
     * 根据当前播放时间（毫秒）查找对应的字幕
     * 返回当前应该显示的字幕条目，如果不在任何字幕时间范围内则返回 null
     */
    fun findCurrentSubtitle(subtitles: List<SubtitleEntry>, positionMs: Long): SubtitleEntry? {
        return subtitles.firstOrNull { positionMs in it.startMs..it.endMs }
    }

    private fun timeToMs(groups: List<String>): Long {
        val hours = groups[1].toLong()
        val minutes = groups[2].toLong()
        val seconds = groups[3].toLong()
        val millis = groups[4].toLong()
        return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis
    }
}
