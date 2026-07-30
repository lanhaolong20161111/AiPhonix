package com.k2fsa.sherpa.onnx.data

import android.content.Context

/**
 * Simplified in-memory store for dictation sessions.
 * Replaces the Room-based AppDatabase to avoid Room dependency.
 */
class AppDatabase private constructor() {

    private val _topicDao = TopicDao()
    private val _writingSessionDao = WritingSessionDao()
    private val _speechSegmentDao = SpeechSegmentDao()
    private val _hintRecordDao = HintRecordDao()
    private val _studentProfileDao = StudentProfileDao()

    fun topicDao() = _topicDao
    fun writingSessionDao() = _writingSessionDao
    fun speechSegmentDao() = _speechSegmentDao
    fun hintRecordDao() = _hintRecordDao
    fun studentProfileDao() = _studentProfileDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: AppDatabase().also { INSTANCE = it }
            }
        }
    }
}
