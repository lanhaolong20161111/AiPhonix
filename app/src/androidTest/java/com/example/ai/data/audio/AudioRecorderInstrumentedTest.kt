package com.example.ai.data.audio

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * AudioRecorder 仪器化测试 — 在真机或模拟器上运行。
 */
@RunWith(AndroidJUnit4::class)
class AudioRecorderInstrumentedTest {

    private val recorder = AudioRecorder()

    @After
    fun tearDown() {
        recorder.stop()
    }

    @Test
    fun recordThreeSeconds() = runBlocking {
        val deferred = async { recorder.record() }
        delay(3500)
        recorder.stop()
        val pcm = deferred.await()
        assertTrue(pcm.isNotEmpty())
        assertTrue("3s PCM should be > 80KB", pcm.size > 80000)
    }

    @Test
    fun recordThenEarlyStop() = runBlocking {
        val deferred = async { recorder.record() }
        delay(800)
        recorder.stop()
        val pcm = deferred.await()
        assertTrue(pcm.isNotEmpty())
    }

    @Test
    fun recordTwiceAfterReset() = runBlocking {
        var deferred = async { recorder.record() }
        delay(1000)
        recorder.stop()
        val pcm1 = deferred.await()
        assertTrue("first recording not empty", pcm1.isNotEmpty())

        delay(500) // 等待 AudioRecord 完全释放
        recorder.reset()
        deferred = async { recorder.record() }
        delay(1000)
        recorder.stop()
        val pcm2 = deferred.await()
        assertTrue("second recording not empty", pcm2.isNotEmpty())
    }
}
