package com.k2fsa.sherpa.onnx.topic

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.k2fsa.sherpa.onnx.data.AppDatabase
import com.k2fsa.sherpa.onnx.data.entity.Topic
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Loads writing topics from local JSON and caches them in memory.
 */
class TopicRepository(private val context: Context) {

    companion object {
        private const val TAG = "TopicRepository"
        private const val TOPICS_FILE = "topics.json"
    }

    private val db = AppDatabase.getInstance(context)
    private val gson = Gson()

    fun getAll(): List<Topic> = db.topicDao().getAll()

    suspend fun getById(id: Long): Topic? = db.topicDao().getById(id)

    suspend fun ensureSeeded() {
        val topics = db.topicDao().getAll()
        if (topics.isNotEmpty()) {
            Log.d(TAG, "Topics already seeded (${topics.size}), skipping")
            return
        }

        withContext(Dispatchers.IO) {
            val json = try {
                context.assets.open(TOPICS_FILE).bufferedReader().use { it.readText() }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read $TOPICS_FILE", e)
                return@withContext
            }

            try {
                val type = object : TypeToken<List<TopicJson>>() {}.type
                val items: List<TopicJson> = gson.fromJson(json, type)
                val entities = items.map { it.toEntity(gson) }
                db.topicDao().insertAll(entities)
                Log.i(TAG, "Seeded ${entities.size} topics from $TOPICS_FILE")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse $TOPICS_FILE", e)
            }
        }
    }

    class TopicJson(
        val type: String = "",
        val title: String = "",
        val content: String = "",
        val gradeLevel: Int = 0,
        val keywords: List<String> = emptyList(),
    ) {
        fun toEntity(gson: Gson) = Topic(
            type = type,
            title = title,
            content = content,
            gradeLevel = gradeLevel,
            keywordsJson = gson.toJson(keywords),
        )
    }
}
