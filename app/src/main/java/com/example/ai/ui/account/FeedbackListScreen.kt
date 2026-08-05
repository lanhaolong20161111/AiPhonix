package com.example.ai.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val PAGE_SIZE = 50

data class FeedbackListUiState(
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val items: List<FeedbackItem> = emptyList(),
    val total: Int = 0,
) {
    val hasMore get() = items.size < total
}

class FeedbackListViewModel(
    private val serverBase: String,
    private val status: String,
) : ViewModel() {
    private val _uiState = MutableStateFlow(FeedbackListUiState())
    val uiState: StateFlow<FeedbackListUiState> = _uiState

    init { loadMore(reset = true) }

    fun loadMore(reset: Boolean = false) {
        val state = _uiState.value
        if (state.loading || state.loadingMore) return
        if (!reset && !state.hasMore) return
        viewModelScope.launch {
            _uiState.value = if (reset) {
                _uiState.value.copy(loading = true, error = null)
            } else {
                _uiState.value.copy(loadingMore = true, error = null)
            }
            try {
                val offset = if (reset) 0 else _uiState.value.items.size
                val (total, page) = withContext(Dispatchers.IO) { fetchPage(offset) }
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    loadingMore = false,
                    total = total,
                    items = if (reset) page else _uiState.value.items + page,
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    loadingMore = false,
                    error = e.message ?: "加载失败",
                )
            }
        }
    }

    private fun fetchPage(offset: Int): Pair<Int, List<FeedbackItem>> {
        val client = OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .build()
        val url = "$serverBase/api/v1/char-images/feedback" +
            "?user_id=${TokenManager.userId}&limit=$PAGE_SIZE&offset=$offset"
        val request = Request.Builder().url(url).build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
            val body = resp.body?.string() ?: return 0 to emptyList()
            val json = JSONObject(body)
            val total = json.optInt("total", 0)
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
            return total to list
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedbackListScreen(
    status: String,
    onBack: () -> Unit,
    onOpenList: (CharImageList) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = when (status) {
        "wrong" -> "📕 错题本"
        "correct" -> "✅ 掌握情况"
        "unsure" -> "🤔 待确认"
        else -> "反馈列表"
    }
    val viewModel: FeedbackListViewModel = androidx.lifecycle.viewmodel.compose.viewModel {
        FeedbackListViewModel(com.example.ai.di.ServiceModule.serverBase, status)
    }
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Text("←", fontSize = 20.sp)
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            state.error != null && state.items.isEmpty() -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Text(
                        "加载失败：${state.error}\n点此重试",
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.clickable { viewModel.loadMore(reset = true) }.padding(16.dp),
                    )
                }
            }
            state.items.isEmpty() -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Text("暂无记录", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    item {
                        Text(
                            "共 ${state.total} 条",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                    }
                    items(state.items, key = { "${it.timestamp}_${it.char}_${it.type}" }) { item ->
                        item.FeedbackRow(onOpenList)
                        HorizontalDivider(Modifier.padding(vertical = 2.dp))
                    }
                    item {
                        Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                            if (state.loadingMore) {
                                CircularProgressIndicator(Modifier.size(28.dp))
                            } else if (state.hasMore) {
                                Text(
                                    "加载更多（${state.items.size}/${state.total}）",
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(20.dp))
                                        .clickable { viewModel.loadMore() }
                                        .padding(horizontal = 20.dp, vertical = 8.dp),
                                )
                            } else {
                                Text(
                                    "— 已全部加载 —",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
