package com.example.ai.data.userimport

import kotlinx.serialization.Serializable

/**
 * 导入管道数据模型。
 *
 * 架构背景（见项目记忆 user-import-pipeline-architecture）：
 * App 生成提示词 → 用户复制去自己的 LLM → 粘贴结果回 App →
 * ImportProcessor 本地规则加工（零 LLM 成本）→ 确认 → 存本地 + 同步服务端。
 */

/** 服务端下发的提示词模板 */
@Serializable
data class ImportTemplate(
    val id: String,
    val group: String,          // text | image
    val name: String,
    val description: String = "",
    val inputType: String = "text",  // text | image
    val contentType: String = "vocab", // vocab | article | sentence | quiz | answer
    val params: List<TemplateParam> = emptyList(),
    val promptTemplate: String = "",
    val privacyNotice: String = "",
    val version: Int = 1,
)

/** 模板参数槽位 */
@Serializable
data class TemplateParam(
    val key: String,
    val label: String,
    val type: String = "select",  // select | number
    val options: List<String> = emptyList(),
    val default: String = "",
)

/** 模板列表响应 */
@Serializable
data class ImportTemplateListResponse(
    val status: String = "ok",
    val version: Int = 0,
    val templates: List<ImportTemplate> = emptyList(),
)

/** 单个模板响应 */
@Serializable
data class ImportTemplateSingleResponse(
    val status: String = "ok",
    val version: Int = 0,
    val template: ImportTemplate? = null,
)

/** 本地存储的用户导入条目（files 目录 JSON，同 AppDatabase 手写内存思路避免 Room 依赖） */
@Serializable
data class UserImportItem(
    val id: String,
    val kind: String,          // word | char | article | sentence | quiz | answer
    val text: String,
    val pinyin: String = "",
    val meaning: String = "",
    val tags: List<String> = emptyList(),
    val payload: String = "",  // JSON 字符串（article 正文 / quiz 明细）
    val status: String = "active",
    val createdAt: Long = System.currentTimeMillis(),
    val sourceTemplate: String = "",  // 来源模板 id（如 text_to_vocab），来源追踪
    val serverId: String = "",       // 服务端记录 id（同步成功后回填，用于删除同步）
)

@Serializable
data class UserImportStoreFile(
    val version: Int = 1,
    val items: List<UserImportItem> = emptyList(),
)

/** 加工候选状态 */
enum class CandidateStatus {
    NEW,        // 可导入
    DUPLICATE,  // 本地已存在，默认跳过
    INVALID,    // 缺 text 等无法导入
}

/** 加工后的导入候选（确认界面展示） */
data class ImportCandidate(
    val status: CandidateStatus,
    val reason: String = "",   // DUPLICATE/INVALID 的说明；NEW 时记录缺字段提醒
    val kind: String,
    val text: String,
    val pinyin: String = "",
    val meaning: String = "",
    val tags: List<String> = emptyList(),
    val payload: String = "",
)
