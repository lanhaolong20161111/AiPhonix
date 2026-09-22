package com.example.ai.data.subtitlecapture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/**
 * 「从视频某一时刻取一帧 → 按画框裁剪 → PNG 字节」。
 *
 * 对应 web 的 `cropBlob()`（`<video>` + 两层 canvas）。Android 侧**不用**抓屏/截控件，
 * 而是直接让 `MediaMetadataRetriever` 解码目标时刻的那一帧 —— 更准（不受控件缩放/遮挡影响），
 * 也不需要 `TextureView` 才行（`SurfaceView` 抓不到画面）。
 *
 * ★ 三个必须处理的坑（都在真机上会翻车）：
 * 1. **旋转元数据**：竖拍手机视频带 `rotation=90`。web 的 `videoWidth/Height` 是**旋转后**的显示尺寸，
 *    而 `getFrameAtTime` 返回的是**未应用旋转**的原始帧 ⇒ 不转就会「裁到别的位置」。
 *    这里读 `METADATA_KEY_VIDEO_ROTATION` 手动旋转，对齐 web 的坐标系。
 * 2. **`OPTION_CLOSEST` 而不是 `OPTION_CLOSEST_SYNC`**：后者只给关键帧（可能差好几秒），
 *    字幕早就换了一句。代价是解码稍慢（在 IO 线程做）。
 * 3. **画框可能越界**（缩放换算四舍五入 + 视频换分辨率后记忆框恢复）⇒ 必须 clamp 到帧内，
 *    且 `createBitmap` 越界会抛 `IllegalArgumentException`。
 *
 * ⚠️ 本类需要 `Context`（`setDataSource(Uri)` 要 `ContentResolver`），**不要注入 ViewModel**（`AGENTS.md`）；
 *    由 Screen 持有并调用，只把纯字节交给 VM 上传。
 */
class VideoFrameCropper(private val context: Context) {

    /**
     * 取 [atMs] 时刻的帧并按 [videoRect]（**视频像素坐标**，来自
     * [SubtitleCaptureLogic.toVideoRect]）裁剪，编码为 PNG 字节。
     *
     * [videoRect] 为 null 表示还没有有效画框；此时取**整帧**（web 在没有画框时直接不发请求，
     * 这里选择宽容处理，交由调用方先拦一道）。
     */
    suspend fun cropFramePng(uriString: String, atMs: Long, videoRect: CaptureRect?): Result<ByteArray> =
        withContext(Dispatchers.IO) {
            if (uriString.isBlank()) return@withContext Result.failure(IllegalStateException("尚未选择影片"))
            val retriever = MediaMetadataRetriever()
            try {
                setSource(retriever, uriString)
                val rotation = retriever
                    .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                    ?.toIntOrNull() ?: 0

                val raw = retriever.getFrameAtTime(
                    (if (atMs < 0) 0L else atMs) * 1000,
                    MediaMetadataRetriever.OPTION_CLOSEST,
                ) ?: return@withContext Result.failure(IllegalStateException("无法从该视频取帧（可能源不可解码）"))

                val frame = rotateIfNeeded(raw, rotation)
                val fw = frame.width
                val fh = frame.height
                if (fw <= 0 || fh <= 0) {
                    recycle(frame)
                    return@withContext Result.failure(IllegalStateException("取到的画面为空"))
                }

                val x0 = (videoRect?.x ?: 0).coerceIn(0, fw - 1)
                val y0 = (videoRect?.y ?: 0).coerceIn(0, fh - 1)
                val cw = (videoRect?.w ?: fw).coerceIn(1, fw - x0)
                val ch = (videoRect?.h ?: fh).coerceIn(1, fh - y0)

                val cropped = try {
                    Bitmap.createBitmap(frame, x0, y0, cw, ch)
                } catch (e: Exception) {
                    Log.w(TAG, "裁剪失败 rect=($x0,$y0,$cw,$ch) frame=${fw}x$fh: ${e.message}")
                    recycle(frame)
                    return@withContext Result.failure(IllegalStateException("画框超出画面，请重新框选"))
                }
                if (cropped !== frame) recycle(frame)

                val bytes = ByteArrayOutputStream().use { out ->
                    cropped.compress(Bitmap.CompressFormat.PNG, 100, out)
                    out.toByteArray()
                }
                recycle(cropped)
                if (bytes.isEmpty()) Result.failure(IllegalStateException("截图编码失败"))
                else Result.success(bytes)
            } catch (e: Exception) {
                Log.w(TAG, "取帧异常 uri=$uriString: ${e.message}")
                Result.failure(IllegalStateException(e.message ?: "取帧失败"))
            } finally {
                runCatching { retriever.release() }
            }
        }

    private fun setSource(retriever: MediaMetadataRetriever, uriString: String) {
        val scheme = runCatching { Uri.parse(uriString).scheme?.lowercase() }.getOrNull()
        if (scheme == "http" || scheme == "https") {
            // 网络源：走 (url, headers) 重载
            retriever.setDataSource(uriString, emptyMap<String, String>())
        } else {
            retriever.setDataSource(context, Uri.parse(uriString))
        }
    }

    /** 按视频旋转元数据转正（90/270 会交换宽高，与 web 的显示坐标系一致）。 */
    private fun rotateIfNeeded(src: Bitmap, rotation: Int): Bitmap {
        val deg = ((rotation % 360) + 360) % 360
        if (deg == 0) return src
        val matrix = Matrix().apply { postRotate(deg.toFloat()) }
        return try {
            val rotated = Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
            if (rotated !== src) recycle(src)
            rotated
        } catch (e: Exception) {
            Log.w(TAG, "旋转失败 rotation=$deg: ${e.message}")
            src
        }
    }

    private fun recycle(b: Bitmap) {
        runCatching { if (!b.isRecycled) b.recycle() }
    }

    private companion object {
        const val TAG = "VideoFrameCropper"
    }
}
