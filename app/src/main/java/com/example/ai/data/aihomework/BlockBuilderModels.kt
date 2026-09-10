package com.example.ai.data.aihomework

/**
 * 搭积木学习：画布上的积木模型（可序列化提交服务端审核）。
 *
 * 坐标归一化（0..1）：x/y 为积木中心相对画布的位置，w 为积木宽度/跨度（水平积木用）。
 * 这样序列化后与服务端/LLM 的语义描述无关画布实际像素，审核时只看结构与语义。
 */
sealed interface BuilderBlock {
    val id: String
    val x: Float // 画布归一化坐标 0..1（中心）
    val y: Float
    val w: Float // 归一化宽度/跨度 0..1

    fun withPos(x: Float, y: Float): BuilderBlock
    fun withWidth(w: Float): BuilderBlock
    fun withColor(color: String): BuilderBlock

    /** 编辑主文本：线段名 / 文本内容 / 大括号标注 / 节点名 / 数值文字（DynamicBlock 为 name） */
    fun withText(text: String): BuilderBlock
}

/** 线段中间端点：名称 + 距左端点的长度（单位与 value 相同） */
data class MidPoint(
    val label: String = "",
    val pos: String = "", // 距左端长度（数值字符串）
)

/** 线段（实线）：表示一个量；value 为空 = 未知量（题目所求）。
 *  segments > 1 = 平均切割（总长不变，段内画分割竖线）；times > 1 = 倍数复制拼接（N 段等长拼接，总长不变）。
 *  extra > 0 = 端部延长一段（绿色**虚线**，表示"增加/多出"的部分，单位与 value 相同；
 *  extraDir = "left" 向左端增长 / "right" 向右端增长）。
 *  midPoints = 中间端点列表（红点标记，每小段自动标注数量）。 */
data class SegmentBlock(
    override val id: String,
    override val x: Float = 0.5f,
    override val y: Float = 0.3f,
    override val w: Float = 0.1f, // 默认短一些，留出操作/扩展空间
    val label: String = "", // 实体名（如 故事书）
    val leftLabel: String = "", // 左端点名称（如 起点/9:00）；空 = 不显示
    val rightLabel: String = "", // 右端点名称（如 终点/10:00）；空 = 不显示
    val midPoints: List<MidPoint> = emptyList(), // 中间端点（红点，每段自动标数量）
    val value: String = "", // 已知数值；空 = 未知量
    val unit: String = "",
    val color: String = "blue",
    val dashed: Boolean = false, // true = 虚线线段（差值/关系标注用）
    val segments: Int = 1, // 平均分成几份（切割）；1 = 不切
    val times: Int = 1, // 放大倍数（复制拼接 N 段）；1 = 不放大
    val extra: Float = 0f, // 增加的长度数值（绿色虚线延长段）；0 = 无
    val extraDir: String = "right", // 增长方向："left" 向左 / "right" 向右
) : BuilderBlock {
    override fun withPos(x: Float, y: Float) = copy(x = x, y = y)
    override fun withWidth(w: Float) = copy(w = w)
    override fun withColor(color: String) = copy(color = color)
    override fun withText(text: String) = copy(label = text)
}

/** 数值标签：可自由放置的数字文字（如「126本」「？个」） */
data class ValueLabelBlock(
    override val id: String,
    override val x: Float = 0.5f,
    override val y: Float = 0.45f,
    override val w: Float = 0.3f,
    val text: String = "",
    val color: String = "blue",
) : BuilderBlock {
    override fun withPos(x: Float, y: Float) = copy(x = x, y = y)
    override fun withWidth(w: Float) = copy(w = w)
    override fun withColor(color: String) = copy(color = color)
    override fun withText(text: String) = copy(text = text)
}

/** 节点圆：表示一个量；unknown=true 时画虚线圆（未知量） */
data class NodeCircleBlock(
    override val id: String,
    override val x: Float = 0.5f,
    override val y: Float = 0.5f,
    override val w: Float = 0.12f, // 直径（归一化）
    val name: String = "",
    val color: String = "blue",
    val unknown: Boolean = true,
) : BuilderBlock {
    override fun withPos(x: Float, y: Float) = copy(x = x, y = y)
    override fun withWidth(w: Float) = copy(w = w)
    override fun withColor(color: String) = copy(color = color)
    override fun withText(text: String) = copy(name = text)
}

/** 自由文本：可随意输入的文本块（如「多3个」「一共？个」） */
data class TextBlock(
    override val id: String,
    override val x: Float = 0.5f,
    override val y: Float = 0.7f,
    override val w: Float = 0.4f,
    val text: String = "",
    val color: String = "black",
) : BuilderBlock {
    override fun withPos(x: Float, y: Float) = copy(x = x, y = y)
    override fun withWidth(w: Float) = copy(w = w)
    override fun withColor(color: String) = copy(color = color)
    override fun withText(text: String) = copy(text = text)
}

/** 小人：表示一个人（如 小明/小红），可磁吸到线段左右端点表示"谁的量" */
data class PersonBlock(
    override val id: String,
    override val x: Float = 0.5f,
    override val y: Float = 0.5f,
    override val w: Float = 0.1f, // 大小（宽度/直径，归一化）
    val name: String = "",
    val color: String = "black",
) : BuilderBlock {
    override fun withPos(x: Float, y: Float) = copy(x = x, y = y)
    override fun withWidth(w: Float) = copy(w = w)
    override fun withColor(color: String) = copy(color = color)
    override fun withText(text: String) = copy(name = text)
}

/** 大括号：框住几个量表示合并/一共；direction 为开口方向（down/up/left/right），w 为跨度，可调节长短 */
data class BraceBlock(
    override val id: String,
    override val x: Float = 0.4f,
    override val y: Float = 0.5f,
    override val w: Float = 0.5f, // 跨度（两端点距离）
    val direction: String = "down", // down / up / left / right
    val label: String = "", // 标注文字（如「一共？个」）
    val color: String = "black",
) : BuilderBlock {
    override fun withPos(x: Float, y: Float) = copy(x = x, y = y)
    override fun withWidth(w: Float) = copy(w = w)
    override fun withColor(color: String) = copy(color = color)
    override fun withText(text: String) = copy(label = text)
}

/** 动态积木：LLM 按题目建议（blocks-suggest），客户端按 type 渲染，学生拖放/调节 */
data class DynamicBlock(
    override val id: String,
    override val x: Float = 0.3f,
    override val y: Float = 0.4f,
    override val w: Float = 0.5f,
    val type: String = "multi-segment", // 渲染原语：line / rect / circle / text / brace / multi-segment
    val name: String = "", // 积木名（如 倍数条）
    val params: Map<String, String> = emptyMap(), // {color, segments, unit, ...}
    val note: String = "", // 使用说明/语义
) : BuilderBlock {
    override fun withPos(x: Float, y: Float) = copy(x = x, y = y)
    override fun withWidth(w: Float) = copy(w = w)
    override fun withColor(color: String) = copy(params = params + ("color" to color))
    override fun withText(text: String) = copy(name = text)

    val segments: Int get() = (params["segments"]?.toIntOrNull() ?: 2).coerceAtLeast(2)
    val defaultColor: String get() = params["color"] ?: "blue"
}

/** 提交给服务端审核的积木条目（与服务端 BuildBlockItem 契约逐字段一致） */
data class BuildBlockItem(
    val kind: String, // segment / dashed_segment / value_label / node_circle / text / brace / dynamic
    val label: String = "",
    val value: String = "",
    val unit: String = "",
    val color: String = "",
    val direction: String = "",
    val type: String = "",
    val note: String = "", // 语义描述（LLM 审核的主要依据）
    val segments: Int = 0, // segment 平均切割份数（>1 有效）
    val times: Int = 0, // segment 倍数复制拼接（>1 有效）
    val extra: Float = 0f, // segment 增加的长度（绿色虚线延长段；>0 有效）
    val extraDir: String = "", // 增长方向："left" 向左 / "right" 向右
)

/** 服务端 blocks-suggest 返回的动态积木定义 */
data class BlockSuggestion(
    val type: String, // 渲染原语（白名单）
    val name: String,
    val description: String = "",
    val params: Map<String, String> = emptyMap(),
    val usage: String = "",
)

/** 服务端 build-review 返回的审核结果 */
data class BuildReviewIssue(val message: String, val fix: String)

data class BuildReviewResult(
    val passed: Boolean,
    val feedback: String,
    val issues: List<BuildReviewIssue> = emptyList(),
    val suggestions: List<String> = emptyList(),
)
