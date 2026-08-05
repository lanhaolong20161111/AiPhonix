package com.example.ai.ui.articlereading

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.articlereading.ArticleContent
import com.example.ai.data.articlereading.ArticleContentParser
import com.example.ai.data.userimport.UserImportItem
import com.example.ai.data.userimport.UserImportStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** 文章列表页状态 */
data class ArticleListUiState(
    val articles: List<ArticleListItem> = emptyList(),
    val loading: Boolean = true,
)

/** 列表展示项：标题 + 段落数 + 首段预览 */
data class ArticleListItem(
    val key: String,
    val item: UserImportItem,
    val content: ArticleContent,
    val paragraphCount: Int,
    val preview: String,
)

class ArticleListViewModel(
    private val store: UserImportStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ArticleListUiState())
    val uiState: StateFlow<ArticleListUiState> = _uiState

    init {
        viewModelScope.launch {
            val articles = store.load()
                .filter { it.kind == "article" }
                .map { item ->
                    val content = ArticleContentParser.parse(item)
                    ArticleListItem(
                        key = item.id,
                        item = item,
                        content = content,
                        paragraphCount = content.paragraphs.size,
                        preview = content.paragraphs.firstOrNull()?.take(60) ?: "（无正文）",
                    )
                }
            _uiState.value = ArticleListUiState(articles = articles, loading = false)
        }
    }
}
