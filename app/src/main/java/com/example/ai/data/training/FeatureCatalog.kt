package com.example.ai.data.training

/**
 * 可训练功能目录 — 家长在设置页勾选这些功能组成"今日任务"。
 *
 * 注意：此处只描述功能元数据，**不引用 NavKey**（避免 data 层反向依赖 UI）。
 * FeatureId → NavKey 的映射放在 Navigation.kt（UI 层扩展函数）。
 *
 * [isTraining] = false 的功能是**家长管理功能**（导入/管理内容），不参与学生任务勾选，
 * 固定显示在家长设置页的"内容管理"区。
 */
enum class FeatureId(
    val id: String,
    val emoji: String,
    val title: String,
    val subtitle: String,
    val isTraining: Boolean = true,
) {
    RECOGNITION("recognition", "🔤", "认字", "看图认汉字，跟读发音"),
    DICTATION("dictation", "✏️", "默写", "听音写字，检验掌握"),
    WORD_PRACTICE("word_practice", "📚", "词语", "词语跟读与辨析"),
    ORAL_WRITING("oral_writing", "🎙️", "口述作文", "看图/听题口述表达"),
    CHAR_IMAGE("char_image", "🖼️", "看图识字", "汉字图片 · 左右滑动"),
    ENGLISH("english_learning", "🇬🇧", "英语学习", "字母 · 拼读 · 视频跟读"),
    VIDEO_PRACTICE("video_practice", "🎬", "视频跟读", "跟读视频练发音"),
    DAILY_PRACTICE("daily_practice", "🏆", "每日一练", "语文 · 数学 · 英语"),
    MY_LEARNING("my_learning", "📊", "我的学习", "用导入内容练习"),
    IMPORT_CENTER("import_center", "📥", "导入学习内容", "词汇 · 文章 · 句子 · 题目", isTraining = false),
    MY_IMPORTS("my_imports", "📋", "我的导入", "查看 / 删除已导入内容", isTraining = false),
    ;

    companion object {
        private val byId = entries.associateBy { it.id }

        /** 可勾选为训练任务的目录（排除家长管理功能） */
        val trainableEntries: List<FeatureId> get() = entries.filter { it.isTraining }

        /** 按存储 id 解析；未知 id 返回 null（容错旧数据） */
        fun fromId(id: String): FeatureId? = byId[id]
    }
}
