package com.k2fsa.sherpa.onnx.data

import com.k2fsa.sherpa.onnx.data.entity.*

/** Simple in-memory DAO for topics. */
class TopicDao {
    private val items = mutableListOf<Topic>()
    fun getAll() = items.toList()
    fun getById(id: Long) = items.find { it.id == id }
    fun insertAll(topics: List<Topic>) { items.addAll(topics) }
    fun insert(topic: Topic) { items.add(topic.copy(id = (items.size + 1L))) }
    fun update(topic: Topic) {
        val idx = items.indexOfFirst { it.id == topic.id }
        if (idx >= 0) items[idx] = topic
    }
}

/** Simple in-memory DAO for writing sessions. */
class WritingSessionDao {
    private val items = mutableListOf<WritingSession>()
    fun insert(session: WritingSession): Long {
        val newId = items.size + 1L
        items.add(session.copy(id = newId))
        return newId
    }
    fun update(session: WritingSession) {
        val idx = items.indexOfFirst { it.id == session.id }
        if (idx >= 0) items[idx] = session
    }
    fun getById(id: Long) = items.find { it.id == id }
    fun getLatest() = items.lastOrNull()
    fun getAll() = items.toList()
}

/** Simple in-memory DAO for speech segments. */
class SpeechSegmentDao {
    private val items = mutableListOf<SpeechSegment>()
    fun insert(segment: SpeechSegment): Long {
        val newId = items.size + 1L
        items.add(segment.copy(id = newId))
        return newId
    }
    fun getForSession(sessionId: Long) = items.filter { it.sessionId == sessionId }.sortedBy { it.seq }
    fun deleteBySession(sessionId: Long) { items.removeAll { it.sessionId == sessionId } }
}

/** Simple in-memory DAO for hint records. */
class HintRecordDao {
    private val items = mutableListOf<HintRecord>()
    fun insert(record: HintRecord): Long {
        val newId = items.size + 1L
        items.add(record.copy(id = newId))
        return newId
    }
    fun getForSession(sessionId: Long) = items.filter { it.sessionId == sessionId }.sortedBy { it.seq }
    fun deleteBySession(sessionId: Long) { items.removeAll { it.sessionId == sessionId } }
}

/** Simple in-memory DAO for student profile. */
class StudentProfileDao {
    private var profile: StudentProfile? = null
    fun get() = profile
    fun insertOrUpdate(p: StudentProfile) { profile = p }
    fun upsert(p: StudentProfile) { profile = p }
}
