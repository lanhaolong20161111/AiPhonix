package com.k2fsa.sherpa.onnx.dictation

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.*

/**
 * Streaming PCM recorder → on-disk WAV file.
 *
 * Writes raw 16-bit PCM during the session, then prepends a 44-byte WAV
 * header at finalisation time (avoiding a full copy).
 */
class AudioStorage(private val context: Context) {

    companion object {
        private const val TAG = "AudioStorage"
        const val SAMPLE_RATE = 16000
        const val BITS_PER_SAMPLE = 16
        const val NUM_CHANNELS = 1

        private const val WAV_HEADER_SIZE = 44
    }

    private var pcmFile: File? = null
    private var output: DataOutputStream? = null
    private var byteCount: Long = 0

    /** Start a new recording. Creates a temp PCM file. */
    fun start(sessionId: Long) {
        val dir = File(context.cacheDir, "audio")
        dir.mkdirs()
        pcmFile = File(dir, "session_${sessionId}.pcm")
        output = DataOutputStream(BufferedOutputStream(FileOutputStream(pcmFile!!)))
        byteCount = 0
        Log.i(TAG, "PCM recording → ${pcmFile!!.absolutePath}")
    }

    /** Append a chunk of raw PCM audio (ShortArray → little-endian bytes). */
    fun writePcm(samples: ShortArray, count: Int) {
        val dos = output ?: return
        for (i in 0 until count) {
            val s = samples[i].toInt()
            dos.write(s and 0xFF)          // low byte first (little-endian)
            dos.write((s shr 8) and 0xFF)  // high byte second
        }
        byteCount += count * 2L
    }

    /** Append raw PCM bytes directly (from a buffer). */
    fun writePcmBytes(buffer: ByteArray, count: Int) {
        output?.write(buffer, 0, count)
        byteCount += count
    }

    /** Get the current byte offset in the PCM stream (for SpeechSegment.audioOffset). */
    fun currentOffset(): Long = byteCount

    /** Stop the PCM stream and close. Return the WAV file. */
    suspend fun finalise(sessionId: Long): String? {
        output?.close()
        output = null
        val pcm = pcmFile ?: run {
            Log.e(TAG, "finalise: pcmFile is null (start() may not have been called or was called twice)")
            return null
        }
        pcmFile = null
        Log.i(TAG, "finalise: PCM=${pcm.absolutePath} exists=${pcm.exists()} bytes=$byteCount")

        val wavDir = File(context.filesDir, "audio")
        wavDir.mkdirs()
        val wavFile = File(wavDir, "session_${sessionId}.wav")

        return withContext(Dispatchers.IO) {
            try {
                if (!pcm.exists()) throw IOException("PCM file not found: ${pcm.absolutePath}")
                prependWavHeader(pcm, wavFile, byteCount.toInt())
                pcm.delete()
                Log.i(TAG, "WAV saved → ${wavFile.absolutePath} size=${wavFile.length()}")
                wavFile.absolutePath
            } catch (e: Exception) {
                Log.e(TAG, "Failed to write WAV header — PCM exists=${pcm.exists()} size=${pcm.length()} bytes=$byteCount", e)
                try { pcm.delete() } catch (e2: Exception) { Log.e(TAG, "delete PCM failed", e2) }
                null
            }
        }
    }

    /**
     * Prepend a 44-byte WAV header in front of raw PCM data.
     *
     * Reads the PCM file, writes [header + PCM] into the target WAV.
     */
    private fun prependWavHeader(pcm: File, wav: File, dataSizeBytes: Int) =
        writeWavFile(pcm, wav, dataSizeBytes, SAMPLE_RATE, NUM_CHANNELS, BITS_PER_SAMPLE)
}

/** @see AudioStorage.prependWavHeader — extracted for testing. */
internal fun writeWavFile(
    pcm: File, wav: File, dataSizeBytes: Int,
    sampleRate: Int = AudioStorage.SAMPLE_RATE,
    numChannels: Int = AudioStorage.NUM_CHANNELS,
    bitsPerSample: Int = AudioStorage.BITS_PER_SAMPLE,
) {
    val byteRate = sampleRate * numChannels * bitsPerSample / 8
    val blockAlign = numChannels * bitsPerSample / 8

    DataOutputStream(BufferedOutputStream(FileOutputStream(wav))).use { wavOut ->
        // RIFF header
        wavOut.writeBytes("RIFF")
        wavOut.writeInt(Integer.reverseBytes(36 + dataSizeBytes))
        wavOut.writeBytes("WAVE")

        // fmt sub-chunk
        wavOut.writeBytes("fmt ")
        wavOut.writeInt(Integer.reverseBytes(16))       // Sub-chunk size (PCM)
        wavOut.writeByte(1); wavOut.writeByte(0)        // Audio format = PCM
        wavOut.writeByte(numChannels); wavOut.writeByte(0)
        wavOut.writeInt(Integer.reverseBytes(sampleRate))
        wavOut.writeInt(Integer.reverseBytes(byteRate))
        wavOut.writeByte(blockAlign); wavOut.writeByte(0)
        wavOut.writeByte(bitsPerSample); wavOut.writeByte(0)

        // data sub-chunk
        wavOut.writeBytes("data")
        wavOut.writeInt(Integer.reverseBytes(dataSizeBytes))

        // PCM payload
        FileInputStream(pcm).use { pcmIn ->
            val buf = ByteArray(8192)
            var read: Int
            while (pcmIn.read(buf).also { read = it } > 0) {
                wavOut.write(buf, 0, read)
            }
        }
    }
}
