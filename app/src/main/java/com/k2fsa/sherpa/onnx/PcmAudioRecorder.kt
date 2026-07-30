package com.k2fsa.sherpa.onnx

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log

/**
 * Extracted PCM audio recorder wrapping Android [AudioRecord].
 *
 * Config: 16 kHz / Mono / 16-bit PCM — matches the sherpa-onnx ASR model input.
 * Callers read audio in 100 ms chunks via [read], or use the Flow-based [samples]
 * for coroutine-friendly streaming.
 */
class PcmAudioRecorder {

    companion object {
        private const val TAG = "PcmAudioRecorder"
        const val SAMPLE_RATE = 16000
        const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        const val AUDIO_SOURCE = MediaRecorder.AudioSource.MIC

        /** 100 ms of 16-bit mono samples. */
        const val CHUNK_MS = 100
        val CHUNK_SAMPLES: Int = (CHUNK_MS * SAMPLE_RATE / 1000).toInt()
    }

    private var audioRecord: AudioRecord? = null

    @Volatile
    var isRecording: Boolean = false
        private set

    /** Initialise the internal [AudioRecord]. Returns false if permission is missing. */
    fun init(): Boolean {
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
        Log.i(TAG, "init: minBuf=$minBuf (${minBuf * 1000f / SAMPLE_RATE} ms)")

        if (minBuf <= 0) {
            Log.e(TAG, "init: getMinBufferSize failed → $minBuf (bad params or no mic?)")
            return false
        }

        audioRecord = AudioRecord(
            AUDIO_SOURCE,
            SAMPLE_RATE,
            CHANNEL_CONFIG,
            AUDIO_FORMAT,
            minBuf * 2   // 16-bit = 2 bytes per sample
        )

        val state = audioRecord?.state
        Log.i(TAG, "init: AudioRecord state=$state (INITIALIZED=${AudioRecord.STATE_INITIALIZED})")
        if (state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "init: NOT INITIALIZED — state=$state, audioRecord=${audioRecord}")
            audioRecord?.release(); audioRecord = null
            return false
        }
        return true
    }

    /** Start recording. Call [init] first. Safe to call if already recording. */
    fun start() {
        if (isRecording) { Log.w(TAG, "start: already recording, skipping"); return }
        Log.i(TAG, "start: audioRecord=${audioRecord?.hashCode()} state=${audioRecord?.state}")
        try {
            audioRecord?.startRecording()
            isRecording = true
        } catch (e: IllegalStateException) {
            Log.e(TAG, "start: AudioRecord.startRecording() failed", e)
            isRecording = false
        }
        Log.i(TAG, "start: recording state=${audioRecord?.recordingState}")
    }

    /** Blocking read of raw 16-bit PCM samples. Returns number of shorts read, or -1 on error. */
    fun read(buffer: ShortArray): Int {
        val ar = audioRecord
        if (ar == null) {
            Log.w(TAG, "read: audioRecord is null")
            return -1
        }
        val n = ar.read(buffer, 0, buffer.size)
        if (n <= 0) Log.w(TAG, "read: returned $n (ERROR_INVALID_OPERATION=-3, ERROR_BAD_VALUE=-2)")
        return n
    }

    /** Stop recording (can be restarted later). */
    fun stop() {
        isRecording = false
        Log.i(TAG, "stop: state=${audioRecord?.state} recording=${audioRecord?.recordingState}")
        audioRecord?.stop()
        Log.i(TAG, "Recording stopped")
    }

    /** Release the underlying [AudioRecord] resource. Call when done. */
    fun release() {
        audioRecord?.release()
        audioRecord = null
        Log.i(TAG, "AudioRecord released")
    }
}
