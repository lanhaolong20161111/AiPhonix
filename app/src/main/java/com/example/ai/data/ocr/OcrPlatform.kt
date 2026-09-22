package com.example.ai.data.ocr

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.core.content.FileProvider
import com.example.ai.util.decodeByteArrayOriented
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * OCR 框选的**唯一持 Context 的类**：读 URI 字节 / 建相机临时文件 / 生成「规范图」与按框裁剪。
 *
 * ★ 为什么要有「规范图」这一步：web 的框选面板把 `<img>` 显示出来、按显示坐标换算到
 * `naturalWidth/naturalHeight` 裁剪原图。Android 这里把 **转正 + 缩放 + 重编码** 做一次，
 * 之后显示、文字行检测（吸附）、裁剪**全部基于同一张规范图**，坐标天然自洽 ——
 * 否则「检测块用的是原图归一化坐标、显示用的是转正后位图」就会出现整页偏移。
 *
 * 规范图规格：EXIF 转正（沿用 [decodeByteArrayOriented]，含四周白边自动裁剪）、
 * 最长边 ≤ [MAX_SIDE]、JPEG（[DEFAULT_QUALITY]）。
 */
class OcrPlatform(private val context: Context) {

    /** 规范图：位图（显示用）+ JPEG 字节（检测/识别用），二者尺寸一致 */
    data class Canonical(val bitmap: Bitmap, val jpeg: ByteArray) {
        val width: Int get() = bitmap.width
        val height: Int get() = bitmap.height
    }

    /** 读相册/相机的图片字节；失败返回 null */
    fun readBytes(uri: Uri): ByteArray? = try {
        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
    } catch (e: Exception) {
        null
    }

    /**
     * 建一个相机拍照用的临时文件。
     * ⚠️ 必须落在 FileProvider 配置的 `cache/import_photos` 下，否则 `getUriForFile` 抛异常闪退。
     */
    fun newCameraFile(): File {
        val dir = File(context.cacheDir, "import_photos").apply { mkdirs() }
        return File(dir, "ocr_photo_${System.currentTimeMillis()}.jpg")
    }

    /** 相机临时文件的 content:// URI */
    fun cameraUri(file: File): Uri =
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

    /**
     * 生成规范图。解码失败（不是图片/已损坏）返回 null，由调用方报「图片读取失败」。
     */
    suspend fun canonicalize(
        bytes: ByteArray,
        maxSide: Int = MAX_SIDE,
        quality: Int = DEFAULT_QUALITY,
    ): Canonical? = withContext(Dispatchers.IO) {
        val oriented = try {
            decodeByteArrayOriented(bytes)
        } catch (e: Exception) {
            null
        } ?: return@withContext null
        val scaled = scaleDown(oriented, maxSide)
        if (scaled !== oriented) oriented.recycle()
        val jpeg = try {
            ByteArrayOutputStream().use { out ->
                scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                out.toByteArray()
            }
        } catch (e: Exception) {
            null
        }
        if (jpeg == null || jpeg.isEmpty()) {
            scaled.recycle()
            return@withContext null
        }
        Canonical(scaled, jpeg)
    }

    /**
     * 按**规范图像素坐标**裁剪并重新编码（供送识别接口）。
     *
     * 越界会被 `coerceIn` 夹回来；夹完仍不足 [OcrBoxLogic.MIN_CROP_PX] 就返回 null
     * （对齐 web 的「框选区域太小」）。**不会**动到 [canonical] 里的位图。
     */
    suspend fun cropToJpeg(
        canonical: Canonical,
        x: Int,
        y: Int,
        w: Int,
        h: Int,
        quality: Int = CROP_QUALITY,
    ): ByteArray? = withContext(Dispatchers.IO) {
        val src = canonical.bitmap
        if (src.isRecycled || src.width <= 0 || src.height <= 0) return@withContext null
        val cx = x.coerceIn(0, src.width - 1)
        val cy = y.coerceIn(0, src.height - 1)
        val cw = w.coerceIn(0, src.width - cx)
        val ch = h.coerceIn(0, src.height - cy)
        if (cw < OcrBoxLogic.MIN_CROP_PX || ch < OcrBoxLogic.MIN_CROP_PX) return@withContext null
        val sub = try {
            Bitmap.createBitmap(src, cx, cy, cw, ch)
        } catch (e: Exception) {
            return@withContext null
        }
        try {
            ByteArrayOutputStream().use { out ->
                sub.compress(Bitmap.CompressFormat.JPEG, quality, out)
                out.toByteArray().takeIf { it.isNotEmpty() }
            }
        } catch (e: Exception) {
            null
        } finally {
            if (sub !== src) sub.recycle()
        }
    }

    /** 只缩不放：最长边超过 [maxSide] 才按比例缩到该值 */
    private fun scaleDown(src: Bitmap, maxSide: Int): Bitmap {
        val longest = maxOf(src.width, src.height)
        if (longest <= maxSide || longest <= 0) return src
        val scale = maxSide.toFloat() / longest
        val w = maxOf(1, (src.width * scale).toInt())
        val h = maxOf(1, (src.height * scale).toInt())
        return try {
            Bitmap.createScaledBitmap(src, w, h, true)
        } catch (e: Exception) {
            src
        }
    }

    private companion object {
        /** 与 web `prepareImageFile(file, 1600, 0.85)` 的 1600 一致 */
        const val MAX_SIDE = 1600
        const val DEFAULT_QUALITY = 85

        /** 裁剪产物是小图，质量给高一点（web 用 `canvas.toBlob(..., "image/jpeg", 0.92)`） */
        const val CROP_QUALITY = 92
    }
}
