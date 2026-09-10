package com.example.ai.util

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream

/**
 * 解码原图并应用 LLM 识别的页面内容边界（裁掉四周白边/背景）。
 *
 * @param bytes 图片原始字节
 * @param pageBounds 页面内容边界 [left, top, right, bottom]（0~1000 相对坐标）；null 表示页面占满、不裁剪
 * @return 已纠正方向并按页面边界裁剪的 Bitmap；解码失败返回 null
 */
fun decodePageCrop(bytes: ByteArray, pageBounds: FloatArray?): Bitmap? {
    val bitmap = decodeByteArrayOriented(bytes) ?: return null
    if (pageBounds == null || pageBounds.size < 4) return bitmap
    val w = bitmap.width
    val h = bitmap.height
    val left = (pageBounds[0] / 1000f * w).toInt().coerceIn(0, w - 1)
    val top = (pageBounds[1] / 1000f * h).toInt().coerceIn(0, h - 1)
    val right = (pageBounds[2] / 1000f * w).toInt().coerceIn(left + 1, w)
    val bottom = (pageBounds[3] / 1000f * h).toInt().coerceIn(top + 1, h)
    // 边界保护：页面区域须占原图至少 30%，避免异常裁剪
    if (right - left < w * 0.3 || bottom - top < h * 0.3) return bitmap
    val cropped = try {
        Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
    } catch (e: Exception) {
        null
    }
    if (cropped != null && cropped !== bitmap) bitmap.recycle()
    return cropped ?: bitmap
}

/**
 * 按 EXIF 方向解码照片：横拍/倒置的照片自动纠正为正确方向。
 *
 * `BitmapFactory.decodeByteArray` 不应用 EXIF orientation 标签，
 * 导致手机横拍的照片在 App 里显示为横向。此函数读取 EXIF 方向后旋转位图。
 *
 * **无 EXIF 方向标签的旧照片**（如历史导入的课本照片，手机未写方向信息）：
 * 采用长宽比启发式——宽明显大于高（宽/高 > 1.3）时视为横拍竖用，自动转 90°。
 * 课本页/作业页均为竖版内容，此规则能覆盖绝大多数横拍旧图；
 * 若个别宽幅插图被误转，用户可手动点"↻"再调回。
 *
 * 同时自动裁剪四周白边（拍照时页面四周留白/背景），只保留页面内容。
 *
 * @return 已纠正方向并裁剪白边的 Bitmap；解码失败返回 null
 */
fun decodeByteArrayOriented(bytes: ByteArray): Bitmap? {
    val bitmap = try {
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Exception) {
        null
    } ?: return null

    val orientation = try {
        ExifInterface(ByteArrayInputStream(bytes))
            .getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
    } catch (e: Exception) {
        ExifInterface.ORIENTATION_NORMAL
    }

    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> {
            matrix.postRotate(90f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_TRANSVERSE -> {
            matrix.postRotate(90f)
            matrix.postScale(1f, -1f)
        }
        // 无方向标签的旧照片：宽明显大于高 → 横拍竖用，自动转 90°
        ExifInterface.ORIENTATION_NORMAL -> {
            if (bitmap.width > bitmap.height && bitmap.width.toFloat() / bitmap.height > 1.3f) {
                matrix.postRotate(90f)
            } else {
                // 无需旋转，仍可能需裁白边
            }
        }
        else -> return bitmap
    }

    var result = bitmap
    if (!matrix.isIdentity) {
        result = try {
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (e: Exception) {
            null
        } ?: bitmap
        if (result !== bitmap) bitmap.recycle()
    }
    val cropped = autoCropWhite(result)
    if (cropped !== result) result.recycle()
    return cropped
}

/**
 * 自动裁剪四周近白边（RGB 各通道 > 200 视为背景白，容忍浅灰/米白拍照留白）。
 * 按行/列白像素占比 ≥85% 判定，容忍边缘噪点；降采样扫描边界再映射回原图；
 * 裁剪量过少（<10%）则放弃，防止误裁页面内容。
 * @return 裁剪后的 Bitmap；无白边则返回原 bitmap
 */
fun autoCropWhite(src: Bitmap): Bitmap {
    val w = src.width
    val h = src.height
    if (w < 200 || h < 200) return src
    // 降采样扫描（最长边 600）
    val scale = minOf(1f, 600f / maxOf(w, h))
    val sw = maxOf(1, (w * scale).toInt())
    val sh = maxOf(1, (h * scale).toInt())
    val small = Bitmap.createScaledBitmap(src, sw, sh, true)
    val pixel = IntArray(sw * sh)
    small.getPixels(pixel, 0, sw, 0, 0, sw, sh)
    small.recycle()
    fun isWhite(x: Int, y: Int): Boolean {
        val c = pixel[y * sw + x]
        return (c shr 16 and 0xFF) > 200 && (c shr 8 and 0xFF) > 200 && (c and 0xFF) > 200
    }
    fun rowWhite(y: Int): Boolean {
        var cnt = 0
        var tot = 0
        for (x in 0 until sw step 3) { tot++; if (isWhite(x, y)) cnt++ }
        return tot > 0 && cnt.toFloat() / tot >= 0.85f
    }
    // 上（先定上/下，再定左/右，colWhite 依赖 top/bottom）
    var top = 0
    while (top < sh - 2 && rowWhite(top)) top++
    var bottom = sh - 1
    while (bottom > top + 2 && rowWhite(bottom)) bottom--
    fun colWhite(x: Int): Boolean {
        var cnt = 0
        var tot = 0
        for (y in top..bottom step 3) { tot++; if (isWhite(x, y)) cnt++ }
        return tot > 0 && cnt.toFloat() / tot >= 0.85f
    }
    var left = 0
    while (left < sw - 2 && colWhite(left)) left++
    var right = sw - 1
    while (right > left + 2 && colWhite(right)) right--
    val x0 = (left / scale).toInt()
    val y0 = (top / scale).toInt()
    val x1 = ((right + 1) / scale).toInt()
    val y1 = ((bottom + 1) / scale).toInt()
    // 保护性裁剪：裁后面积 ≥ 原图 40% 且裁掉至少 2%（有真实白边才裁，防误裁页面内容）
    val cw = x1 - x0
    val ch = y1 - y0
    if (cw >= w * 0.4 && ch >= h * 0.4 && (cw < w * 0.98 || ch < h * 0.98)) {
        val rect = android.graphics.Rect(x0, y0, x1, y1)
        if (rect.width() > 0 && rect.height() > 0) {
            return try {
                Bitmap.createBitmap(src, rect.left, rect.top, rect.width(), rect.height())
            } catch (e: Exception) {
                src
            }
        }
    }
    return src
}
