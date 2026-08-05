package com.example.ai.ui.report

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.data.speech.ScoreClient
import com.example.ai.di.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/** 学习报告：展示真实练习统计与最近练习记录（/practice/stats + /practice/history）。 */
@Composable
fun ReportScreen(modifier: Modifier = Modifier) {
    val data by produceState(ReportData()) { value = withContext(Dispatchers.IO) { fetchReport() } }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(16.dp))
        Text("📊 学习报告", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(20.dp))

        if (data.failed) {
            Text(
                "⚠️ 统计数据加载失败（断网），请检查网络后重试",
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.error,
            )
            Spacer(Modifier.height(120.dp))
            return
        }

        if (data.totalSessions == 0 && data.history.isEmpty()) {
            Text(
                "还没有练习记录。\n去「我的学习」开始第一次训练吧！",
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(120.dp))
            return
        }

        // 总览统计
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("🗓️ 练习次数", fontSize = 16.sp)
                    Text("${data.totalSessions} 次", fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("📝 累计练习", fontSize = 16.sp)
                    Text("${data.totalChars} 项", fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("🎯 总正确率", fontSize = 16.sp)
                    Text(
                        if (data.totalChars > 0) "${data.totalCorrect * 100 / data.totalChars}%" else "—",
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        // 最近练习记录
        if (data.history.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            Text("最近练习", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.height(8.dp))
            data.history.forEach { session ->
                Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column {
                            Text(moduleLabel(session.module), fontSize = 16.sp, fontWeight = FontWeight.Medium)
                            Text(session.date, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(
                            "${session.score} / ${session.max}",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (session.max > 0 && session.score * 100 / session.max >= 80)
                                androidx.compose.ui.graphics.Color(0xFF2E7D32)
                            else
                                MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
}

private data class ReportSession(val module: String, val date: String, val score: Int, val max: Int)
private data class ReportData(
    val totalSessions: Int = 0,
    val totalChars: Int = 0,
    val totalCorrect: Int = 0,
    val history: List<ReportSession> = emptyList(),
    /** 网络加载失败 */
    val failed: Boolean = false,
)

private fun moduleLabel(module: String): String = when (module) {
    "dictation" -> "默写"
    "word" -> "词语练习"
    "quiz" -> "本地题库"
    "sentence" -> "句子跟读"
    else -> module
}

private fun fetchReport(): ReportData {
    return try {
        val statsJson = get("/api/v1/practice/stats")
        val historyJson = get("/api/v1/practice/history?limit=10")
        val stats = JSONObject(statsJson)
        val history = JSONArray(historyJson)
        ReportData(
            totalSessions = stats.optInt("total_sessions", 0),
            totalChars = stats.optInt("total_chars", 0),
            totalCorrect = stats.optInt("total_correct", 0),
            history = (0 until history.length()).mapNotNull { i ->
                val s = history.optJSONObject(i) ?: return@mapNotNull null
                ReportSession(
                    module = s.optString("module"),
                    date = s.optString("date"),
                    score = s.optInt("total_score", 0),
                    max = s.optInt("max_score", 0),
                )
            },
        )
    } catch (e: Exception) {
        ReportData(failed = true)
    }
}

private fun get(path: String): String {
    val req = Request.Builder()
        .url("${ScoreClient.serverBase()}$path")
        .get()
        .build()
    NetworkModule.httpClient.newCall(req).execute().use { resp ->
        return resp.body?.string().orEmpty()
    }
}
