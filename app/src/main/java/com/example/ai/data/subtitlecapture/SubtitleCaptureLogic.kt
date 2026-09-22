package com.example.ai.data.subtitlecapture

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 字幕采集的**纯逻辑**（无 Android 依赖 ⇒ 可直接 JVM 单测）。
 *
 * 每条规则都逐条对齐 web `SubtitleCapturePage.tsx`，**不要"顺手优化"**：
 * 这类页面里「差 1px / 差 1ms 的判据」直接决定「画框框不到字幕」「书签不亮」。
 */
object SubtitleCaptureLogic {

    // ────────────────────────────── 时间戳 ──────────────────────────────

    /**
     * 精确时间戳 `HH:MM:SS.mmm`。
     *
     * 与 web `fmt()` **以及**服务端 `fmtTimestamp()` 逐位一致（小时补 2 位、毫秒补 3 位）——
     * 三处必须同源，否则列表里 Android 本地先显示的时间戳与刷新后的服务端值会"跳一下"。
     * 负数按 0 处理（服务端 `Math.max(0, ...)`）。
     */
    fun fmtTimestamp(ms: Long): String {
        val v = if (ms < 0) 0L else ms
        val totalSec = v / 1000
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        val millis = v % 1000
        return "%02d:%02d:%02d.%03d".format(h, m, s, millis)
    }

    // ────────────────────────────── 画框换算 ──────────────────────────────

    /**
     * 显示区画框 → **视频像素坐标**（web `cropBlob` / `meta.crop` 的 scaleX/scaleY 两步）。
     *
     * 任一边长为 0（视频未就绪、容器未测量）时返回 null —— web 在同样条件下返回 null/拒绝，
     * 不能拿 0 当缩放因子（会得到全 0 的 crop，服务端照样存盘，后续回看是一片黑）。
     */
    fun toVideoRect(rect: CaptureRect, wrapW: Int, wrapH: Int, videoW: Int, videoH: Int): CaptureRect? {
        if (wrapW <= 0 || wrapH <= 0 || videoW <= 0 || videoH <= 0) return null
        val sx = videoW.toDouble() / wrapW
        val sy = videoH.toDouble() / wrapH
        return CaptureRect(
            x = (rect.x * sx).roundToInt(),
            y = (rect.y * sy).roundToInt(),
            w = (rect.w * sx).roundToInt(),
            h = (rect.h * sy).roundToInt(),
        )
    }

    /**
     * 记忆画框按当前容器尺寸等比还原（web `restoreRectForMovie`）。
     *
     * 缺任何一方尺寸就放弃 —— web 用 `if (!r || !r.wrapW || !r.wrapH || !wrapW || !wrapH) return null`
     * 做同样的事（0 尺寸会把整个框缩成 0，看起来像"记忆失效"）。
     */
    fun restoreRect(mem: RectMemory?, wrapW: Int, wrapH: Int): CaptureRect? {
        if (mem == null) return null
        if (mem.wrapW <= 0 || mem.wrapH <= 0 || wrapW <= 0 || wrapH <= 0) return null
        val sx = wrapW.toDouble() / mem.wrapW
        val sy = wrapH.toDouble() / mem.wrapH
        return CaptureRect(
            x = (mem.x * sx).roundToInt(),
            y = (mem.y * sy).roundToInt(),
            w = (mem.w * sx).roundToInt(),
            h = (mem.h * sy).roundToInt(),
        )
    }

    /** web 点「截屏」且当前无框时的默认框：中间偏下，横向 80% / 纵向 25%。 */
    fun defaultRect(wrapW: Int, wrapH: Int): CaptureRect = CaptureRect(
        x = (wrapW * 0.1).roundToInt(),
        y = (wrapH * 0.7).roundToInt(),
        w = (wrapW * 0.8).roundToInt(),
        h = (wrapH * 0.25).roundToInt(),
    )

    /** web 在空白处按下、尚无框时的起手框（`w=0,h=0`，随拖拽长大）。 */
    fun draftRect(wrapW: Int, wrapH: Int): CaptureRect = CaptureRect(
        x = 0,
        y = 0,
        w = (wrapW * 0.3).roundToInt(),
        h = (wrapH * 0.2).roundToInt(),
    )

    /** 画框是否可用（web 用 `w >= 8 && h >= 8`：太小既框不住字幕，也没法拖手柄）。 */
    fun isUsable(rect: CaptureRect?): Boolean = rect != null && rect.w >= 8 && rect.h >= 8

    /**
     * 拖拽 / 缩放的坐标计算（web `mousemove` 处理器逐行对齐）。
     *
     * [handle] 取 `move` 或八向之一（`nw`/`n`/`ne`/`e`/`se`/`s`/`sw`/`w`）。
     * ★ 反直觉但必须照抄的两点：
     * ① 最小边长硬编码 **8**（不是 10、不是 dp）；
     * ② `w`/`n` 方向用的是「**反推**新边长」`w = start.w + (start.x - nx)`，不是 `start.w - dx` ——
     *   当 `nx` 被下界 clamp 住（拖到左边界）时两者结果不同，照抄才能与 web 完全一致。
     * `maxW - start.w < 0`（框比容器还宽，只可能来自记忆数据换分辨率）时 clamp 退化成下界 0/8，也不抛错。
     */
    fun dragRect(start: CaptureRect, handle: String, dx: Int, dy: Int, maxW: Int, maxH: Int): CaptureRect {
        fun clamp(v: Int, lo: Int, hi: Int): Int = maxOf(lo, minOf(hi, v))

        var x = start.x
        var y = start.y
        var w = start.w
        var h = start.h

        if (handle == "move") {
            x = clamp(start.x + dx, 0, maxW - start.w)
            y = clamp(start.y + dy, 0, maxH - start.h)
        } else {
            if (handle.contains("e")) w = clamp(start.w + dx, 8, maxW - start.x)
            if (handle.contains("s")) h = clamp(start.h + dy, 8, maxH - start.y)
            if (handle.contains("w")) {
                val nx = clamp(start.x + dx, 0, start.x + start.w - 8)
                w = start.w + (start.x - nx)
                x = nx
            }
            if (handle.contains("n")) {
                val ny = clamp(start.y + dy, 0, start.y + start.h - 8)
                h = start.h + (start.y - ny)
                y = ny
            }
        }
        return CaptureRect(x, y, w, h)
    }

    // ────────────────────────────── 书签 / 列表 ──────────────────────────────

    /** 本片截图，按时间戳升序（web 采集列表的 `sort`）。 */
    fun marksOfMovie(items: List<CaptureItem>, movieName: String): List<CaptureItem> =
        items.filter { it.movieName == movieName }.sortedBy { it.timestampMs }

    /**
     * 相邻截图（间隔 < [nearMs]，默认 1500ms）归为一组，返回需要**红框高亮**的 seq 集合。
     *
     * 与 web 完全一致：按升序只比**相邻两项**（传递性不展开 —— A-B 近、B-C 近但 A-C 不近时，
     * 三张都会被标上，因为每张都至少有一次相邻命中）。默认 1500ms 与 web `NEAR_MS` 同值。
     */
    fun nearDuplicateSeqs(items: List<CaptureItem>, nearMs: Long = 1500L): Set<Int> {
        val sorted = items.sortedBy { it.timestampMs }
        val hit = mutableSetOf<Int>()
        for (i in 1 until sorted.size) {
            val prev = sorted[i - 1].timestampMs
            val cur = sorted[i].timestampMs
            if (abs(cur - prev) < nearMs) {
                hit.add(sorted[i - 1].seq)
                hit.add(sorted[i].seq)
            }
        }
        return hit
    }

    /**
     * 播放头命中的书签（web `activeMark`：`|mark.ts - curMs| <= 800`，取**第一个**命中）。
     * 传 `null` 表示当前没有书签。容差 800ms 与 web 同值 —— 调小会让书签"闪过去就不亮"。
     */
    fun findActiveMark(marks: List<SubtitleMark>, curMs: Long, toleranceMs: Long = 800L): SubtitleMark? =
        marks.firstOrNull { abs(it.ts - curMs) <= toleranceMs }

    /**
     * 自动复习命中判据（web `timeupdate` 里的 `|mk.ts - tMs| < 400`，比展示用的 800 更严）。
     *
     * [lastHitTs] 是上次已触发过的书签时间戳（web `lastMarkHit`），用于防止同一书签重复触发；
     * 拖动进度条（`seeked`）后 web 会把它重置为 -1。
     */
    fun findAutoReviewHit(
        marks: List<SubtitleMark>,
        curMs: Long,
        lastHitTs: Long,
        toleranceMs: Long = 400L,
    ): SubtitleMark? = marks.firstOrNull { abs(it.ts - curMs) < toleranceMs && it.ts != lastHitTs }

    /** 已评测结果按 seq 去重后并入（web `loadList` 的回灌：`list` 里有 `eval` 且本地还没有的）。 */
    fun mergeEvalCards(prev: List<EvalCardModel>, incoming: List<EvalCardModel>): List<EvalCardModel> {
        val have = prev.map { it.seq }.toSet()
        val added = incoming.filter { it.seq !in have }
        return (prev + added).sortedByDescending { it.seq }
    }

    // ────────────────────────────── 影片名 ──────────────────────────────

    /** 去掉最后一个扩展名（web `name.replace(/\.[^.]+$/, "")`；`.hidden` 会变成空串，与 JS 同）。 */
    fun stripExtension(name: String): String = Regex("\\.[^.]+$").replace(name, "")

    /**
     * 从 URL 推导影片名（web `openUrl`）：能解析时用 `host · 文件名`，否则退回截断的前 24 字符。
     *
     * ★ web 的判据是 `u.startsWith("http")`（**不是** `https`）⇒ `http://…` 与 `https://…` 都直接使用，
     * 其它一切（含裸域名）都补 `https://` 再解析。
     *
     * ★★ **不能用 `java.net.URL`**：它比 JS 的 WHATWG `new URL()` **宽松得多** ——
     * `new URL("https://not a url at all with spaces")` 在 JS 里抛错（走"截断 24 字符"兜底），
     * 而 `java.net.URL` 会把 `not a url at all with spaces` **整串当主机名**吃掉，于是名字变成一长串乱码。
     * 这里改用**严格**的 `java.net.URI`（空格直接抛）+ 主机非空校验，行为与 JS 对齐。
     * （单测里 `not a url at all with spaces` 就是这条的回归用例。）
     *
     * ⚠️ 已知小差异（有意不追）：URL **路径里带空格**时，WHATWG 会自动编码成 `%20` 再取名，
     * 而 `URI` 直接抛错 ⇒ 退回"截断 24 字符"。这种链接 <video> 本身也放不出来，不值得为它加一层编码。
     */
    fun movieNameFromUrl(raw: String): String {
        val u = raw.trim()
        if (u.isEmpty()) return ""
        val fallback = u.take(24)
        return try {
            val withScheme = if (u.startsWith("http")) u else "https://$u"
            val uri = java.net.URI(withScheme)
            // JS 的 `URL` 会把 hostname 转小写；URI 保留原样，这里手动对齐
            val host = (uri.host ?: uri.authority)?.lowercase().orEmpty()
            if (host.isBlank()) return fallback
            val path = uri.path.orEmpty()
            val last = path.split("/").filter { it.isNotEmpty() }.lastOrNull() ?: ""
            val stem = stripExtension(last)
            if (stem.isNotEmpty()) "$host · $stem" else host
        } catch (e: Exception) {
            fallback
        }
    }

    /** B站预览地址（web `applyBili`，参数顺序与取值逐字一致）。 */
    fun biliPlayerUrl(bvid: String): String =
        "https://player.bilibili.com/player.html?bvid=$bvid&page=1&high_quality=1&danmaku=0"
}
