package com.example.ai.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.example.ai.CharImageList
import com.example.ai.data.auth.TokenManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class FeedbackItem(
    val char: String,
    val grade: String,
    val semester: String,
    val type: String,
    val status: String,
    val timestamp: String,
)

data class EvalRecord(
    val refText: String,
    val language: String,
    val evalType: String,
    val totalAccuracy: Double,
    val suggestedScore: Double,
    val createdAt: String,
)

data class AccountUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val items: List<FeedbackItem> = emptyList(),
    val evalRecords: List<EvalRecord> = emptyList(),
    val feedbackTotal: Int = 0,
    val feedbackStats: Map<String, Int> = emptyMap(),
) {
    val correctItems get() = items.filter { it.status == "correct" }
    val wrongItems get() = items.filter { it.status == "wrong" }
    val unsureItems get() = items.filter { it.status == "unsure" }
    val correctTotal get() = feedbackStats["correct"] ?: 0
    val wrongTotal get() = feedbackStats["wrong"] ?: 0
    val unsureTotal get() = feedbackStats["unsure"] ?: 0
    val avgAccuracy get() =
        if (evalRecords.isEmpty()) 0.0 else evalRecords.map { it.totalAccuracy }.average()
}

class AccountViewModel(private val serverBase: String) : ViewModel() {
    private val _uiState = MutableStateFlow(AccountUiState())
    val uiState: StateFlow<AccountUiState> = _uiState

    init { load() }

    fun load() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            try {
                val items = async(Dispatchers.IO) { fetchFeedback() }
                val evals = async(Dispatchers.IO) { fetchEvalRecords() }
                val (total, stats, feedbackItems) = items.await()
                _uiState.value = AccountUiState(
                    loading = false,
                    items = feedbackItems,
                    evalRecords = evals.await(),
                    feedbackTotal = total,
                    feedbackStats = stats,
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(loading = false, error = e.message ?: "加载失败")
            }
        }
    }

    private fun fetchEvalRecords(): List<EvalRecord> {
        val client = OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .build()
        val json = JSONObject()
            .put("user_id", TokenManager.userId)
            .put("limit", 50)
        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$serverBase/api/v1/soe/records")
            .post(body)
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
            val s = resp.body?.string() ?: return emptyList()
            val arr = JSONObject(s).getJSONArray("records")
            val list = mutableListOf<EvalRecord>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(
                    EvalRecord(
                        refText = o.optString("ref_text"),
                        language = o.optString("language"),
                        evalType = o.optString("eval_type"),
                        totalAccuracy = o.optDouble("total_accuracy", 0.0),
                        suggestedScore = o.optDouble("suggested_score", 0.0),
                        createdAt = o.optString("created_at"),
                    )
                )
            }
            return list
        }
    }

    private fun fetchFeedback(): Triple<Int, Map<String, Int>, List<FeedbackItem>> {
        val client = OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .build()
        val url = "$serverBase/api/v1/char-images/feedback?user_id=${TokenManager.userId}&limit=3"
        val request = Request.Builder().url(url).build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
            val body = resp.body?.string() ?: return Triple(0, emptyMap(), emptyList())
            val json = JSONObject(body)
            val total = json.optInt("total", 0)
            val stats = mutableMapOf<String, Int>()
            val statsJson = json.optJSONObject("stats")
            if (statsJson != null) {
                val keys = statsJson.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    stats[k] = statsJson.optInt(k, 0)
                }
            }
            val arr = json.getJSONArray("items")
            val list = mutableListOf<FeedbackItem>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(
                    FeedbackItem(
                        char = o.optString("char"),
                        grade = o.optString("grade"),
                        semester = o.optString("semester"),
                        type = o.optString("type"),
                        status = o.optString("learning_status", "").ifBlank { "未标记" },
                        timestamp = o.optString("timestamp"),
                    )
                )
            }
            return Triple(total, stats, list)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    onBack: () -> Unit,
    onLogout: () -> Unit,
    onOpenList: (CharImageList) -> Unit,
    onOpenFeedbackList: (String) -> Unit,
    onOpenParent: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val viewModel: AccountViewModel = androidx.lifecycle.viewmodel.compose.viewModel {
        AccountViewModel(com.example.ai.di.ServiceModule.serverBase)
    }
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("我的账户") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Text("←", fontSize = 20.sp)
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // ---- 头部：头像 + 身份 ----
            item {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        modifier = Modifier
                            .size(72.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            TokenManager.nickname.ifBlank { TokenManager.username }.take(1),
                            color = MaterialTheme.colorScheme.onPrimary,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        TokenManager.nickname.ifBlank { TokenManager.username },
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "@${TokenManager.username} · ${TokenManager.role} · ID ${TokenManager.userId}",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // ---- 统计行 ----
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("✅ 掌握", state.correctTotal, MaterialTheme.colorScheme.secondaryContainer, Modifier.weight(1f))
                    StatCard("📕 错题", state.wrongTotal, MaterialTheme.colorScheme.errorContainer, Modifier.weight(1f))
                    StatCard("🤔 待确认", state.unsureTotal, MaterialTheme.colorScheme.tertiaryContainer, Modifier.weight(1f))
                }
            }

            // ---- 加载 / 错误 ----
            if (state.loading) {
                item {
                    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
            }
            if (state.error != null) {
                item {
                    Text(
                        "加载失败：${state.error}\n点此重试",
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().clickable { viewModel.load() }.padding(16.dp),
                    )
                }
            }

            if (!state.loading && state.error == null) {
                // ---- 错题本 ----
                item {
                    SectionCard(
                        title = "📕 错题本",
                        count = state.wrongTotal,
                        emptyText = "暂无错题，继续加油 🎉",
                        container = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.35f),
                    ) {
                        state.wrongItems.take(3).forEach { it.FeedbackRow(onOpenList) }
                        if (state.wrongTotal > state.wrongItems.size) {
                            ShowAllRow(state.wrongTotal) { onOpenFeedbackList("wrong") }
                        }
                    }
                }
                // ---- 掌握情况 ----
                item {
                    SectionCard(
                        title = "✅ 掌握情况",
                        count = state.correctTotal,
                        emptyText = "还没有标记过『掌握了』的卡片",
                        container = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.35f),
                    ) {
                        state.correctItems.take(3).forEach { it.FeedbackRow(onOpenList) }
                        if (state.correctTotal > state.correctItems.size) {
                            ShowAllRow(state.correctTotal) { onOpenFeedbackList("correct") }
                        }
                    }
                }
                // ---- 待确认 ----
                item {
                    SectionCard(
                        title = "🤔 待确认",
                        count = state.unsureTotal,
                        emptyText = "没有待确认的卡片",
                        container = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.35f),
                    ) {
                        state.unsureItems.take(3).forEach { it.FeedbackRow(onOpenList) }
                        if (state.unsureTotal > state.unsureItems.size) {
                            ShowAllRow(state.unsureTotal) { onOpenFeedbackList("unsure") }
                        }
                    }
                }
            }

                // ---- 语音评测记录 ----
                item {
                    SectionCard(
                        title = "📝 语音评测记录",
                        count = state.evalRecords.size,
                        emptyText = "还没有评测记录，去练一练吧 🎤",
                        container = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f),
                    ) {
                        if (state.evalRecords.isNotEmpty()) {
                            Row(
                                Modifier.fillMaxWidth().padding(bottom = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "平均分 ${state.avgAccuracy.toInt()}",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                )
                                Spacer(Modifier.weight(1f))
                                Text(
                                    "共 ${state.evalRecords.size} 次",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            HorizontalDivider()
                            state.evalRecords.forEach { it.EvalRow() }
                        }
                    }
                }

            // ---- 设置 ----
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("⚙️ 设置", fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "服务端：${com.example.ai.di.ServiceModule.serverBase}",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "登录方式：密码登录",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(8.dp))
                        // 家长设置入口（PIN 保护，Navigation 层传 onOpenParent）
                        Text(
                            "👨‍👩‍👧 家长设置（决定学生的今日任务 · PIN 保护）",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable { onOpenParent() }
                                .padding(vertical = 6.dp),
                        )
                    }
                }
            }

            // ---- 退出登录 ----
            item {
                Button(
                    onClick = onLogout,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                ) {
                    Text("退出登录", fontSize = 16.sp, modifier = Modifier.padding(vertical = 6.dp))
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun StatCard(
    label: String,
    count: Int,
    container: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("$count", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SectionCard(
    title: String,
    count: Int,
    emptyText: String,
    container: androidx.compose.ui.graphics.Color,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Text("$title（$count）", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Spacer(Modifier.height(10.dp))
            if (count == 0) {
                Text(emptyText, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                content()
            }
        }
    }
}

@Composable
private fun EvalRecord.EvalRow() {
    val typeLabel = when (evalType) {
        "word" -> "词语"
        "sentence" -> "句子"
        "letter" -> "字母"
        else -> evalType
    }
    val langLabel = if (language == "zh") "中文" else "英文"
    val scoreColor = when {
        totalAccuracy >= 80 -> androidx.compose.ui.graphics.Color(0xFF2E7D32)
        totalAccuracy >= 60 -> androidx.compose.ui.graphics.Color(0xFFE65100)
        else -> MaterialTheme.colorScheme.error
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                refText.take(1).ifBlank { "🎤" },
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(refText.ifBlank { "(无参考文本)" }, fontWeight = FontWeight.Medium, fontSize = 14.sp)
            Text(
                "$langLabel · $typeLabel · ${createdAt.take(10)}",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("${totalAccuracy.toInt()} 分", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = scoreColor)
    }
}

@Composable
private fun ShowAllRow(count: Int, onClick: () -> Unit) {
    Text(
        "共 $count 条 · 查看全部 →",
        color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.Medium,
        fontSize = 13.sp,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
    )
}

@Composable
internal fun FeedbackItem.FeedbackRow(onOpenList: (CharImageList) -> Unit) {
    val typeLabel = when (type) {
        "认" -> "识字"
        "写" -> "写字"
        "词" -> "词语"
        "英词" -> "英词"
        "英句" -> "英句"
        else -> type
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable { onOpenList(CharImageList(grade, semester, type)) }
            .padding(vertical = 8.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) {
            Text(char.take(1), fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(char, fontWeight = FontWeight.Medium, fontSize = 15.sp)
            Text(
                "$grade $semester · $typeLabel",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            timestamp.take(10),
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

