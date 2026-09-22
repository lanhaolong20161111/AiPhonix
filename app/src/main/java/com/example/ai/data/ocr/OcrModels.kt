package com.example.ai.data.ocr

/**
 * OCR 框选识别（对齐 web `web/src/components/OcrPickSheet.tsx` 与 `stores/ocrEngineStore.ts`）
 * 的**纯数据模型**，不含任何 Android API。
 */

/**
 * 识别通道 —— 决定走哪个端点与是否跳过多音字。
 *
 * 只做语文 / 英语两条：
 * - `CHINESE` → `/api/v1/ai-chinese/parse-image`（不带 mode）
 * - `ENGLISH` → 同一个端点 + `mode=english`（服务端跳过多音字与中文去噪）
 *
 * ⚠️ **数学通道（web 是 `/ai-homework/parse-image`）未接入**：Android 的数学识别页走的是
 * 整图流程，没有框选需求，接入它要动 `AiHomeworkRepository` 的签名 —— 需要时再补。
 */
enum class OcrModule(val mode: String) {
    CHINESE(""),
    ENGLISH("english"),
}

/**
 * 识别引擎（对齐 web `stores/ocrEngineStore.ts` 的 `OcrEngine`）。
 *
 * - `AUTO`   跟随服务端默认（生产为 PaddleOCR 打头阵，失败/超时回退豆包）
 * - `DOUBAO` 强制豆包多模态（慢网友好）
 * - `PADDLE` 强制 PaddleOCR（专用 OCR，通常 1~3 秒出全文，版面更准）
 *
 * `AUTO` 时**不传** `engine` 参数（与 web 一致）。
 */
enum class OcrEngine(val wire: String, val label: String) {
    AUTO("auto", "🤖 自动(默认)"),
    DOUBAO("doubao", "⚡ 豆包(快)"),
    PADDLE("paddle", "📐 PaddleOCR(准)");

    companion object {
        /** 展示顺序（web `OcrEnginePicker` 的 ORDER） */
        val ORDER: List<OcrEngine> = listOf(OcrEngine.AUTO, OcrEngine.DOUBAO, OcrEngine.PADDLE)

        /** 未知值一律回落 `AUTO`（web `readInitial` 同口径） */
        fun from(raw: String?): OcrEngine = ORDER.firstOrNull { it.wire == raw } ?: AUTO
    }
}

/**
 * 一个矩形。`w`/`h` 是**宽高**，不是右下角坐标（与 web 的 `{x,y,w,h}` 一致）。
 *
 * 同一类型同时承载两种坐标系：
 * - **显示坐标**：相对图片预览区（`OcrCrop.rect` / `OcrTextBlock.rect`）
 * - **归一化坐标 0~1**：`OcrNormBlock`（后端 detect-blocks 返回的 nx/ny/nw/nh）
 */
data class PickRect(val x: Float, val y: Float, val w: Float, val h: Float) {
    val right: Float get() = x + w
    val bottom: Float get() = y + h

    /** 左上角与右下角都在框内（供命中判定与调试） */
    fun contains(px: Float, py: Float): Boolean = px >= x && px <= right && py >= y && py <= bottom

    companion object {
        val ZERO = PickRect(0f, 0f, 0f, 0f)
    }
}

/**
 * 已画框的四种状态（web `CropItem` 的 `pending` / `busy` / `err` 三态展开）：
 * 框选/调整后是 [PENDING]（不自动识别），点「开始识别」才转 [BUSY] → [DONE]/[ERROR]。
 */
enum class CropStatus { PENDING, BUSY, DONE, ERROR }

/** 一个已画的框（对齐 web `CropItem`） */
data class OcrCrop(
    val key: Int,
    val rect: PickRect,
    val status: CropStatus = CropStatus.PENDING,
    val text: String = "",
    val err: String = "",
) {
    /** 结果列表里的一行文案（web 逐字一致） */
    val displayText: String
        get() = when (status) {
            CropStatus.BUSY -> "⏳ 识别中…"
            CropStatus.PENDING -> "⏸ 待识别"
            CropStatus.ERROR -> "❌ $err"
            CropStatus.DONE -> text
        }

    /** 框左上角编号徽标后缀（web：busy `…` / err `⚠` / pending `⏸` / 否则 `✓`） */
    val badgeSuffix: String
        get() = when (status) {
            CropStatus.BUSY -> "…"
            CropStatus.ERROR -> "⚠"
            CropStatus.PENDING -> "⏸"
            CropStatus.DONE -> "✓"
        }
}

/** 后端 `/ai-chinese/detect-blocks` 返回的一行文本（**归一化坐标 0~1**） */
data class OcrNormBlock(val rect: PickRect, val text: String = "")

/** 换成显示坐标后的文本行（吸附用） */
data class OcrTextBlock(val rect: PickRect, val text: String = "")

/** 多图结果的字段级拼接模式（web `joinOcrTexts` 的两个分支） */
enum class OcrJoinMode {
    /** 「练字」：按 JS 空白切开后**单空格**重连 */
    SPACE_SEPARATED,

    /** 「练词/练句/单词/句子」：按图片与条目**换行**连接 */
    LINE_SEPARATED,
}

/** 一屏 OCR 会话的全部状态（`OcrPickSession` 持有） */
data class OcrPickState(
    val open: Boolean = false,
    /** 面板标题（web 传 `📷 识别第 1/3 张图片（自动去除拼音）` 之类） */
    val title: String = "",
    val module: OcrModule = OcrModule.CHINESE,
    val engine: OcrEngine = OcrEngine.AUTO,
    /** 识别后是否去拼音（web `stripPinyin` 属性） */
    val stripPinyin: Boolean = false,
    /** 去拼音时字间是否加空格（web `spaceChars`：练字 true / 练词练句 false） */
    val spaceChars: Boolean = false,
    /** 规范图（已转正、已缩到 ≤1600px）的像素尺寸 —— 显示坐标 → 像素换算的分母 */
    val imageW: Int = 0,
    val imageH: Int = 0,
    /**
     * 预览区（实际绘制图片的那块）的**精确尺寸**，由 composable 的 `onSizeChanged` 回传。
     *
     * 这是**显示坐标系的定义域**：`OcrCrop.rect` / `OcrTextBlock.rect` 全部相对它。
     * 归一化文字行（`OcrNormBlock`）也要 ×`stageW`/×`stageH` 才变成显示坐标。
     *
     * ⚠️ 与 web 的差异（有意）：web 用 `object-fit: contain` 的 letterbox 容器，分母是**容器**宽高，
     * 竖图会算错；Android 让容器尺寸 = 图片实际绘制尺寸（按宽高比算出来），坐标天然自洽。
     */
    val stageW: Float = 0f,
    val stageH: Float = 0f,
    val crops: List<OcrCrop> = emptyList(),
    /** 底部可编辑文本（识别结果按框顺序拼进来，用户可再改） */
    val draft: String = "",
    val blocks: List<OcrTextBlock> = emptyList(),
    val blocksLoading: Boolean = false,
    /** 拖拽中的实时框（web `currentRect`） */
    val currentRect: PickRect? = null,
    /** 当前吸附到的文字行（web `snapTo`，渲染成绿框） */
    val snapTo: PickRect? = null,
    val starting: Boolean = false,
    val error: String = "",
) {
    val anyBusy: Boolean get() = crops.any { it.status == CropStatus.BUSY }
    val anyPending: Boolean get() = crops.any { it.status == CropStatus.PENDING }
    val pendingCount: Int get() = crops.count { it.status == CropStatus.PENDING }

    /** 有文字就能导入（忽略未识别/识别中的框，web `disabledConfirm = !draft.trim()`） */
    val canConfirm: Boolean get() = draft.trim().isNotEmpty()

    /** 面板顶部提示（web 逐字一致，末尾按文字行检测状态切换） */
    val hintText: String
        get() = buildString {
            append("👆 在图片上拖拽框出要识别的内容（可框选多个区域，按顺序拼接）；")
            append("框选/调整后点击「开始识别」才会识别。")
            append("已画好的框可拖动内部平移、拖角上/边中点把手调整大小。")
            when {
                blocksLoading -> append(" 正在检测文字行以便自动吸附…")
                blocks.isNotEmpty() -> append(" 画新框会自动吸附到最近的文字行（绿框）。")
                else -> append(" （未检测到文字行，将保持自由框选。）")
            }
        }

    /** 底部左提示（web 逐字一致，四档优先级） */
    val footerText: String
        get() = when {
            !canConfirm -> "还没有可导入的文字，请框选内容并点「开始识别」"
            anyPending -> "有 $pendingCount 个区域未识别，将忽略它们、直接导入已识别内容"
            anyBusy -> "部分区域仍在识别中…将使用已识别内容导入"
            else -> ""
        }

    /** 底部左提示的颜色语义（web 用红/橙/蓝/灰四色区分上面前三档） */
    val footerLevel: Int
        get() = when {
            !canConfirm -> 0
            anyPending -> 1
            anyBusy -> 2
            else -> 3
        }
}
