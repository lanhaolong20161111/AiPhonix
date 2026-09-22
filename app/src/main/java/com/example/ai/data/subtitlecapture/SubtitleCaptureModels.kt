package com.example.ai.data.subtitlecapture

/**
 * 字幕采集的数据模型 —— 对齐 web `SubtitleCapturePage.tsx` 与 `server_cf/src/routes/subtitleCapture.ts`。
 *
 * 契约以**服务端**为准：`GET /subtitle-capture/list` 的元素字段是 snake_case
 * （`file_name` / `movie_name` / `timestamp_ms` / `crop_width`…），解析时逐字段映射，别指望驼峰。
 *
 * ⚠️ 该路由整段挂了 `requireAuth()`（含 `GET /file/:fileName`）⇒ 截图直链**必须带 Authorization 头**，
 *   `<img src>` 那种裸用法在 Android 会 401（web 靠 `api()` 的 fetch 带 token，Android 要用 Coil 的
 *   `ImageRequest.addHeader`，见 `SubtitleCaptureScreen` 的缩略图）。
 */

/** 画框（**显示区**像素坐标；与 web `Rect` 同义）。视频像素坐标经 [SubtitleCaptureLogic.toVideoRect] 换算。 */
data class CaptureRect(val x: Int, val y: Int, val w: Int, val h: Int)

/** 语法/表达纠错一条（服务端 `grammar_corrections` 元素） */
data class GrammarFix(
    val original: String = "",
    val corrected: String = "",
    val reason: String = "",
)

/** 一次 LLM 测评结果（服务端 `EvalResult`，`auto-evaluate` / `re-evaluate` 顶层展开返回） */
data class SubtitleEval(
    val subtitleText: String = "",
    val translation: String = "",
    val grammar: List<GrammarFix> = emptyList(),
    val explanation: String = "",
    val evaluatedAt: String = "",
)

/** 跟读得分里的一个词（web `SoeWord` 的最小投影：词面 + 准确度 + 漏读标记） */
data class SoeWordItem(
    val word: String,
    val accuracy: Float,
    /** 0=正确 1=漏读 2=增读 3=错读；与 `util/SoeDisplay.isMissing` 配套（-1 分被 clamp 成 0 的坑） */
    val matchTag: Int = 0,
)

/**
 * 一条采集记录（对齐服务端 `CaptureMeta` + `list` 里附加的 `url`）。
 * 时间字段统一用 `Long` 毫秒（服务端 `timestamp_ms`），`timestampText` 是服务端给的 `HH:MM:SS.mmm`。
 */
data class CaptureItem(
    val seq: Int = 0,
    val fileName: String = "",
    val movieName: String = "",
    val timestampMs: Long = 0L,
    val timestampText: String = "",
    val videoWidth: Int = 0,
    val videoHeight: Int = 0,
    val crop: CaptureRect = CaptureRect(0, 0, 0, 0),
    val cropWidth: Int = 0,
    val cropHeight: Int = 0,
    val note: String = "",
    val url: String = "",
    val eval: SubtitleEval? = null,
)

/**
 * 测评区一张卡（对齐 web `EvalCard` 的展示字段）。
 *
 * [fromMark] —— 该卡由「书签」补出来的占位（书签存的字幕在本地，但完整 grammar/explanation 只在
 * 服务端 `list` 的 `eval` 里，未拉到时 web 也会先渲染一个 `fromMark: true` 的占位卡）。
 */
data class EvalCardModel(
    val seq: Int = 0,
    val timestampText: String = "",
    val movieName: String = "",
    val url: String = "",
    val subtitleText: String = "",
    val translation: String = "",
    val grammar: List<GrammarFix> = emptyList(),
    val explanation: String = "",
    val cached: Boolean = false,
    val live: Boolean = false,
    val fromMark: Boolean = false,
    val soeScore: Int? = null,
    val soeWords: List<SoeWordItem> = emptyList(),
)

/** 书签：每次测评成功（或「存图」）记一个时间戳，按影片名分组（web `subtitle_capture_marks`） */
data class SubtitleMark(
    val ts: Long = 0L,
    val tsText: String = "",
    val subtitle: String = "",
    val translation: String = "",
    val seq: Int = 0,
    val soeScore: Int? = null,
    val soeWords: List<SoeWordItem> = emptyList(),
)

/** 按影片名记忆的画框（web `subtitle_capture_rects`：像素 + 当时容器尺寸，恢复时按比例缩放） */
data class RectMemory(
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
    val wrapW: Int,
    val wrapH: Int,
)

/** 上次打开的影片（web 把文件二进制存 IndexedDB；Android 记 SAF URI + 进度） */
data class LastMovie(
    val movieName: String = "",
    val uri: String = "",
    val lastTimeMs: Long = 0L,
)

/** 影片来源 —— 只有 本地/云端直链 可画框截图采集（web `canCapture`） */
enum class MovieSource(val label: String) {
    NONE("未选片"),
    LOCAL("本地文件"),
    URL("云端直链"),
    BILI("B站预览");

    val canCapture: Boolean get() = this == LOCAL || this == URL
}

/** B站搜索结果一项（服务端 `/bili/search` 的 `items`） */
data class BiliItem(
    val bvid: String = "",
    val title: String = "",
    val author: String = "",
    val duration: String = "",
)

/** 「存图」/「识别」的请求元信息（服务端 `parseMeta` 读的字段，名字不能改） */
data class CaptureRequest(
    val movieName: String,
    val timestampMs: Long,
    val videoWidth: Int,
    val videoHeight: Int,
    val crop: CaptureRect,
    val cropWidth: Int,
    val cropHeight: Int,
    val note: String = "",
    val lang: String = "en",
    val force: Boolean = false,
)
