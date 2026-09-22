package com.example.ai.data.aihistory

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.example.ai.data.aichinese.TextBlock
import com.example.ai.data.aichinese.TextBlockLine
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/** 历史里的一条对话轮次（会话型历史用） */
data class AiHistoryTurn(
    val role: String = "",      // user / assistant
    val content: String = "",
)

/** 历史里的一条问答快照 */
data class AiHistoryQa(
    val q: String = "",
    val a: String = "",
)

/**
 * 一条 AI 历史（识别快照 或 会话摘要）：
 * - 识别快照：text/questions/blocks/thumb 有值，turns 空；
 * - 会话摘要：turns/sessionId 有值（服务端会话续聊），blocks 空。
 */
data class AiHistoryItem(
    val id: String = "",
    val module: String = "chinese",   // chinese / math / english
    val text: String = "",
    val questions: List<String> = emptyList(),
    val blocks: List<TextBlock> = emptyList(),
    val thumb: String = "",           // base64 jpeg data URL（无图则空）
    val createdAt: Long = 0,
    val qa: Map<String, List<AiHistoryQa>> = emptyMap(), // 相对键（block-N / q-N / text）→ 问答
    val turns: List<AiHistoryTurn> = emptyList(),
    val sessionId: String = "",       // 会话型历史的服务端会话 id
)

/**
 * AI 历史本地存储 — 对齐 web/src/lib/aiHistory.ts：
 * 一个 JSON 文件按 module 三桶（chinese/math/english），每桶上限 50 条，新条目头插。
 * 调用方需在 Dispatchers.IO 上调用（文件同步读写）。
 */
class AiHistoryStore(private val context: android.content.Context) {

    companion object {
        const val MAX_PER_MODULE = 50
        val MODULES = listOf("chinese", "math", "english")

        /** TextBlock 列表 → JSON（与识别接口返回结构一致） */
        fun blocksToJson(blocks: List<TextBlock>): JSONArray = JSONArray().apply {
            blocks.forEach { b ->
                put(JSONObject().apply {
                    put("type", b.type)
                    put("text", b.text)
                    put("align", b.align)
                    put("lines", JSONArray().apply {
                        b.lines.forEach { l ->
                            put(JSONObject().apply {
                                put("text", l.text)
                                put("indent", l.indent)
                            })
                        }
                    })
                    if (b.polyphones.isNotEmpty()) {
                        put("polyphones", JSONObject().apply {
                            b.polyphones.forEach { (k, v) -> put(k, v) }
                        })
                    }
                })
            }
        }

        /** JSON → TextBlock 列表 */
        fun blocksFromJson(arr: JSONArray): List<TextBlock> = buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val text = o.optString("text", "")
                if (text.isBlank()) continue
                val lines = buildList {
                    val la = o.optJSONArray("lines") ?: JSONArray()
                    for (j in 0 until la.length()) {
                        val lo = la.optJSONObject(j) ?: continue
                        val lt = lo.optString("text", "")
                        if (lt.isBlank()) continue
                        add(TextBlockLine(text = lt, indent = lo.optInt("indent", 0)))
                    }
                }
                val polyphones = buildMap {
                    val po = o.optJSONObject("polyphones") ?: JSONObject()
                    val it = po.keys()
                    while (it.hasNext()) {
                        val k = it.next()
                        val v = po.optString(k, "")
                        if (k.length == 1 && v.isNotEmpty()) put(k, v)
                    }
                }
                add(TextBlock(
                    type = o.optString("type", "body"),
                    text = text,
                    align = o.optString("align", "left"),
                    lines = lines,
                    polyphones = polyphones,
                ))
            }
        }
    }

    private val file: File get() = File(context.filesDir, "ai_history.json")
    private val lock = Any()

    // ── 文件读写 ──

    private fun loadAll(): MutableMap<String, MutableList<AiHistoryItem>> {
        val result = MODULES.associateWith { mutableListOf<AiHistoryItem>() }.toMutableMap()
        try {
            if (!file.exists()) return result
            val root = JSONObject(file.readText())
            for (module in MODULES) {
                val arr = root.optJSONArray(module) ?: continue
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    result[module]?.add(fromJson(o))
                }
            }
        } catch (_: Exception) {
            // 损坏文件视为空历史（下次保存会覆盖）
        }
        return result
    }

    private fun saveAll(map: Map<String, List<AiHistoryItem>>) {
        try {
            val root = JSONObject()
            for (module in MODULES) {
                root.put(module, JSONArray().apply {
                    map[module].orEmpty().forEach { put(toJson(it)) }
                })
            }
            val tmp = File(file.parentFile, "ai_history.json.tmp")
            tmp.writeText(root.toString())
            tmp.renameTo(file) // 原子覆盖
        } catch (_: Exception) {
        }
    }

    private fun toJson(it: AiHistoryItem): JSONObject = JSONObject().apply {
        put("id", it.id)
        put("module", it.module)
        put("text", it.text)
        put("questions", JSONArray(it.questions))
        put("blocks", blocksToJson(it.blocks))
        put("thumb", it.thumb)
        put("createdAt", it.createdAt)
        put("qa", JSONObject().apply {
            it.qa.forEach { (k, list) ->
                put(k, JSONArray().apply {
                    list.forEach { qa -> put(JSONObject().put("q", qa.q).put("a", qa.a)) }
                })
            }
        })
        put("turns", JSONArray().apply {
            it.turns.forEach { t -> put(JSONObject().put("role", t.role).put("content", t.content)) }
        })
        put("sessionId", it.sessionId)
    }

    private fun fromJson(o: JSONObject): AiHistoryItem = AiHistoryItem(
        id = o.optString("id", ""),
        module = o.optString("module", "chinese"),
        text = o.optString("text", ""),
        questions = buildList {
            val q = o.optJSONArray("questions") ?: JSONArray()
            for (i in 0 until q.length()) add(q.optString(i, ""))
        },
        blocks = blocksFromJson(o.optJSONArray("blocks") ?: JSONArray()),
        thumb = o.optString("thumb", ""),
        createdAt = o.optLong("createdAt", 0),
        qa = buildMap {
            val qaRoot = o.optJSONObject("qa") ?: JSONObject()
            val keys = qaRoot.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                val list = buildList {
                    val arr = qaRoot.optJSONArray(k) ?: JSONArray()
                    for (i in 0 until arr.length()) {
                        val qo = arr.optJSONObject(i) ?: continue
                        add(AiHistoryQa(q = qo.optString("q", ""), a = qo.optString("a", "")))
                    }
                }
                if (list.isNotEmpty()) put(k, list)
            }
        },
        turns = buildList {
            val arr = o.optJSONArray("turns") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val to = arr.optJSONObject(i) ?: continue
                add(AiHistoryTurn(role = to.optString("role", ""), content = to.optString("content", "")))
            }
        },
        sessionId = o.optString("sessionId", ""),
    )

    // ── 对外 API ──

    /** 按模块取历史（新→旧） */
    fun list(module: String): List<AiHistoryItem> = synchronized(lock) {
        loadAll()[module].orEmpty().toList()
    }

    /** 新增（id 空则生成；头插；超上限裁剪）；返回最终 id */
    fun add(item: AiHistoryItem): String = synchronized(lock) {
        val all = loadAll()
        val id = item.id.ifBlank { "${System.currentTimeMillis()}-${(100000..999999).random()}" }
        val stamped = item.copy(id = id, createdAt = if (item.createdAt > 0) item.createdAt else System.currentTimeMillis())
        val bucket = all[stamped.module] ?: mutableListOf()
        bucket.add(0, stamped)
        while (bucket.size > MAX_PER_MODULE) bucket.removeAt(bucket.size - 1)
        all[stamped.module] = bucket
        saveAll(all)
        id
    }

    /** 更新指定条目（找不到则忽略） */
    fun update(module: String, id: String, transform: (AiHistoryItem) -> AiHistoryItem) = synchronized(lock) {
        val all = loadAll()
        val bucket = all[module] ?: return@synchronized
        val idx = bucket.indexOfFirst { it.id == id }
        if (idx >= 0) {
            bucket[idx] = transform(bucket[idx])
            saveAll(all)
        }
    }

    /** 删除指定条目 */
    fun remove(module: String, id: String) = synchronized(lock) {
        val all = loadAll()
        val bucket = all[module] ?: return@synchronized
        if (bucket.removeAll { it.id == id }) saveAll(all)
    }

    /** 原图字节 → 缩略图 base64 data URL（≤240px、JPEG 60%；失败返回空串） */
    fun makeThumb(imageBytes: ByteArray?): String {
        if (imageBytes == null || imageBytes.isEmpty()) return ""
        return try {
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, opts)
            var sample = 1
            while (opts.outWidth / sample > 480 || opts.outHeight / sample > 480) sample *= 2
            val bmp = BitmapFactory.decodeByteArray(
                imageBytes, 0, imageBytes.size,
                BitmapFactory.Options().apply { inSampleSize = sample },
            ) ?: return ""
            val scaled = if (bmp.width > 240 || bmp.height > 240) {
                val scale = 240f / maxOf(bmp.width, bmp.height)
                Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true)
            } else bmp
            val bos = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 60, bos)
            if (scaled !== bmp) bmp.recycle()
            "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            ""
        }
    }
}
