package com.example.ai.data.ocr

import com.example.ai.util.splitJsWhitespace
import kotlin.math.abs
import kotlin.math.hypot

/**
 * OCR 框选的**纯几何与文本引擎** —— 逐条对齐 web `web/src/components/OcrPickSheet.tsx`
 * 与 `web/src/pages/DailyChinesePage.tsx` 的 `joinOcrTexts`。
 *
 * 全是纯函数（不碰 Android API），可直接 JVM 单测；期望值取自把 web 源码原样复制到 node
 * 跑的探针（`web/_ocrpick_probe.mjs`），不是按语义推导。
 *
 * ★ 三处**极易搞错、必须照抄**的细节：
 * 1. **画新框与调整已有框的尺寸门槛不一样**：新框要求 `w > 8 && h > 8`（严格大于），
 *    调整已有框要求 `w >= 8 && h >= 8`。统一成一个就会在 8 像素边界上表现不同。
 * 2. **吸附只在新框分支生效**，且门槛是 `w > 2 && h > 2`（与成框门槛不同）；比例判定用
 *    **严格大于** [SNAP_RATIO] 且按文本行顺序**首个胜出**（不是取最大）。
 * 3. **命中把手用半径 18 的圆**、命中框内用 `pad = 6` 的**严格不等式**窄带排除；顺序是
 *    **从后往前**遍历框（后画的压住先画的），每个框内先查 8 个把手再查内部。
 */
object OcrBoxLogic {

    /** 把手命中半径（显示坐标，触屏友好）—— web `HANDLE_HIT` */
    const val HANDLE_HIT = 18f

    /** 吸附触发比例：交集面积 / 用户框面积 需**严格大于**该值 —— web `SNAP_RATIO` */
    const val SNAP_RATIO = 0.35f

    /** 框内部命中时排除的边框窄带 —— web `pad = 6` */
    const val MOVE_PAD = 6f

    /** 框太小则忽略/丢弃的门槛（宽高都要 >8 才成框）—— web 的 `8` */
    const val MIN_BOX_SIDE = 8f

    /** 缩放时单边最小长度 —— web 的 `10` */
    const val MIN_RESIZE_SIDE = 10f

    /** 画新框时的吸附门槛 —— web 的 `w > 2 && h > 2` */
    const val SNAP_GATE = 2f

    /** 服务端裁剪的最小像素边长（再小就报「框选区域太小」）—— web 的 `4` */
    const val MIN_CROP_PX = 4

    /** 调整已有框后判定「有变化」的阈值（任一维度差 >1 才重新识别）—— web 的 `1` */
    const val CHANGED_EPS = 1f

    /** 8 个把手的名字与几何顺序（web `Object.entries(handlePoints)` 的插入顺序） */
    val HANDLE_NAMES: List<String> = listOf("nw", "n", "ne", "e", "se", "s", "sw", "w")

    /** 一个把手的位置 */
    data class Handle(val name: String, val x: Float, val y: Float)

    /** 8 个把手的坐标（顺序 = 命中判定顺序） */
    fun handlePoints(r: PickRect): List<Handle> = listOf(
        Handle("nw", r.x, r.y),
        Handle("n", r.x + r.w / 2f, r.y),
        Handle("ne", r.right, r.y),
        Handle("e", r.right, r.y + r.h / 2f),
        Handle("se", r.right, r.bottom),
        Handle("s", r.x + r.w / 2f, r.bottom),
        Handle("sw", r.x, r.bottom),
        Handle("w", r.x, r.y + r.h / 2f),
    )

    /** 交集面积 / 用户框面积；任一面积为 0 或不相交都返回 0 */
    fun intersectRatio(r: PickRect, b: PickRect): Float {
        val ix = maxOf(0f, minOf(r.right, b.right) - maxOf(r.x, b.x))
        val iy = maxOf(0f, minOf(r.bottom, b.bottom) - maxOf(r.y, b.y))
        val area = ix * iy
        val userArea = r.w * r.h
        if (area <= 0f || userArea <= 0f) return 0f
        return area / userArea
    }

    /**
     * 在所有文字行里找吸附目标：交集占比**严格大于** [SNAP_RATIO] 且**首个**满足者胜出。
     * @return 命中的文字行矩形；无命中返回 null（保持自由框选）
     */
    fun snapRect(r: PickRect, blocks: List<PickRect>): PickRect? {
        if (blocks.isEmpty()) return null
        var best: PickRect? = null
        var bestRatio = SNAP_RATIO
        for (b in blocks) {
            val ratio = intersectRatio(r, b)
            if (ratio > bestRatio) {
                bestRatio = ratio
                best = b
            }
        }
        return best
    }

    /** 按下时命中了什么 */
    sealed interface Hit {
        /** 命中某个把手 → 缩放 */
        data class Resize(val cropKey: Int, val handle: String) : Hit

        /** 命中框内部 → 平移 */
        data class Move(val cropKey: Int) : Hit
    }

    /**
     * 几何命中：**从后往前**遍历（后画的框优先），每个框先查 8 个把手（圆半径 [HANDLE_HIT]），
     * 再查内部（排除 `pad = 6` 的边框窄带，避免把手附近被误判成 move）。
     * 边长 `< 8` 的框直接跳过。
     */
    fun hitCrop(px: Float, py: Float, crops: List<OcrCrop>): Hit? {
        for (i in crops.indices.reversed()) {
            val c = crops[i]
            if (c.rect.w < MIN_BOX_SIDE || c.rect.h < MIN_BOX_SIDE) continue
            for (h in handlePoints(c.rect)) {
                if (hypot(px - h.x, py - h.y) <= HANDLE_HIT) return Hit.Resize(c.key, h.name)
            }
            if (px > c.rect.x + MOVE_PAD && px < c.rect.right - MOVE_PAD &&
                py > c.rect.y + MOVE_PAD && py < c.rect.bottom - MOVE_PAD
            ) {
                return Hit.Move(c.key)
            }
        }
        return null
    }

    /**
     * 缩放：按把手名里的 `w/e/n/s` 决定改哪条边。
     *
     * ★ `w`/`n` 方向是**反推**新边长（`新边长 = 原右边 − 新左边`），不是 `原宽 + dx`；
     * 且左侧最多推到「右边 − 10」，所以**不会翻转**（最小宽 10）。
     * `e`/`s` 方向是 `max(原边长 + d, 10)`，同样不会缩到负。
     */
    fun resizeRect(
        handle: String,
        startX: Float,
        startY: Float,
        curX: Float,
        curY: Float,
        orig: PickRect,
    ): PickRect {
        val dx = curX - startX
        val dy = curY - startY
        var x = orig.x
        var y = orig.y
        var w = orig.w
        var h = orig.h
        if (handle.contains('w')) {
            x = minOf(orig.x + dx, orig.right - MIN_RESIZE_SIDE)
            w = orig.right - x
        } else if (handle.contains('e')) {
            w = maxOf(orig.w + dx, MIN_RESIZE_SIDE)
        }
        if (handle.contains('n')) {
            y = minOf(orig.y + dy, orig.bottom - MIN_RESIZE_SIDE)
            h = orig.bottom - y
        } else if (handle.contains('s')) {
            h = maxOf(orig.h + dy, MIN_RESIZE_SIDE)
        }
        return PickRect(x, y, w, h)
    }

    /** 平移（只改左上角，尺寸不变；负值不裁剪 —— web 靠指针本身被 clamp 在容器内来兜底） */
    fun moveRect(orig: PickRect, dx: Float, dy: Float): PickRect =
        PickRect(orig.x + dx, orig.y + dy, orig.w, orig.h)

    /** 拖拽画新框（起止点归一成左上角 + 正的宽高） */
    fun drawRect(startX: Float, startY: Float, curX: Float, curY: Float): PickRect = PickRect(
        x = minOf(startX, curX),
        y = minOf(startY, curY),
        w = abs(curX - startX),
        h = abs(curY - startY),
    )

    /** 抬手时新框是否成框：**严格**大于 [MIN_BOX_SIDE]（web `r.w > 8 && r.h > 8`） */
    fun isDrawAccepted(r: PickRect): Boolean = r.w > MIN_BOX_SIDE && r.h > MIN_BOX_SIDE

    /** 拖拽过程中是否尝试吸附（门槛比成框低得多：`> 2`） */
    fun allowsSnap(r: PickRect): Boolean = r.w > SNAP_GATE && r.h > SNAP_GATE

    /** 抬手时调整已有框是否成立：`>= 8`（**与 [isDrawAccepted] 的严格大于不同**） */
    fun isAdjustAccepted(r: PickRect): Boolean = r.w >= MIN_BOX_SIDE && r.h >= MIN_BOX_SIDE

    /** 调整后的框相比原框是否有明显变化（任一维度差 >1 才重新识别） */
    fun isChanged(orig: PickRect, r: PickRect): Boolean =
        abs(r.x - orig.x) > CHANGED_EPS ||
            abs(r.y - orig.y) > CHANGED_EPS ||
            abs(r.w - orig.w) > CHANGED_EPS ||
            abs(r.h - orig.h) > CHANGED_EPS

    /** 删除按钮的边长（显示坐标） */
    const val DELETE_SIZE = 22f

    /** 删除按钮距框右边缘的内缩量 */
    const val DELETE_INSET = 14f

    /**
     * 删除按钮的命中矩形。
     *
     * ★ **Android 适配（有意与 web 不同）**：web 把 ✕ 放在框**外**（`right:-10, top:-12`），
     * Compose 里超出父边界的子元素**收不到手势**，照抄会变成"点不到"。所以就地放到框内右上角，
     * 并**左移 36px** 让开 `ne` 把手（两者中心距 25 > [HANDLE_HIT]，互不误触）。
     */
    fun deleteButtonRect(r: PickRect): PickRect = PickRect(
        x = maxOf(r.x, r.right - DELETE_INSET - DELETE_SIZE),
        y = r.y + 2f,
        w = DELETE_SIZE,
        h = DELETE_SIZE,
    )

    /** 归一化坐标 → 显示坐标（后端 detect-blocks 的 nx/ny/nw/nh × 预览尺寸） */
    fun toDisplay(blocks: List<OcrNormBlock>, displayW: Float, displayH: Float): List<OcrTextBlock> =        blocks.map { b ->
            OcrTextBlock(
                rect = PickRect(
                    b.rect.x * displayW,
                    b.rect.y * displayH,
                    b.rect.w * displayW,
                    b.rect.h * displayH,
                ),
                text = b.text,
            )
        }

    /** 显示坐标 → 原图像素（web `recognizeRect` 的换算），附带最小裁剪校验 */
    data class CropPx(val x: Int, val y: Int, val w: Int, val h: Int, val ok: Boolean)

    /**
     * 显示坐标 → 原图像素。
     * `sx/sy` 下限 0；`sw/sh` 上限到图片边界。越界会导致 `w`/`h` 变小甚至为负 ⇒ [CropPx.ok] 为 false。
     */
    fun toCropPx(rect: PickRect, displayW: Float, displayH: Float, imgW: Int, imgH: Int): CropPx {
        if (displayW <= 0f || displayH <= 0f || imgW <= 0 || imgH <= 0) {
            return CropPx(0, 0, 0, 0, ok = false)
        }
        val scaleX = imgW / displayW
        val scaleY = imgH / displayH
        val sx = maxOf(0, Math.round(rect.x * scaleX))
        val sy = maxOf(0, Math.round(rect.y * scaleY))
        val sw = minOf(imgW - sx, Math.round(rect.w * scaleX))
        val sh = minOf(imgH - sy, Math.round(rect.h * scaleY))
        return CropPx(sx, sy, sw, sh, ok = !(sw < MIN_CROP_PX || sh < MIN_CROP_PX))
    }

    /**
     * 结果文本：按框顺序、`trim` 后**换行**连接（web `resultText`）。
     * 空文本的框被跳过。
     */
    fun combineCropTexts(crops: List<OcrCrop>): String =
        crops.map { it.text.trim() }.filter { it.isNotEmpty() }.joinToString("\n")

    /**
     * 多张图片识别结果的字段级拼接（web `DailyChinesePage.joinOcrTexts`）。
     *
     * ★ **web 这里有个真 bug，Android 按意图修正**：web 写的是 `t.split(/\\s+/)` 与
     * `join("\\n")`（字面双反斜杠），于是按空白重切是空操作、按行连接会插入**字面 `\n`**
     * 两个字符。单图导入时两处都恰好退化成「原样」，所以长期没被发现；多图导入词/句才会露馅。
     * Android 这里按**真实**的 JS 空白集切分（[splitJsWhitespace]）、用**真换行**连接。
     */
    fun joinOcrTexts(mode: OcrJoinMode, texts: List<String>): String {
        val nonEmpty = texts.map { it.trim() }.filter { it.isNotEmpty() }
        return when (mode) {
            OcrJoinMode.SPACE_SEPARATED -> nonEmpty.flatMap { splitJsWhitespace(it) }.joinToString(" ")
            OcrJoinMode.LINE_SEPARATED -> nonEmpty.joinToString("\n")
        }
    }
}
