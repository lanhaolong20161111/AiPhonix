package com.example.ai.ui.articlereading

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleListScreen(
    viewModel: ArticleListViewModel,
    onBack: () -> Unit,
    onOpenArticle: (articleKey: String, title: String) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("📖 文章跟读", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
            )
        },
    ) { inner ->
        if (state.loading) {
            CircularProgressIndicator(Modifier.padding(inner))
            return@Scaffold
        }
        if (state.articles.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(inner).padding(32.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                Text("还没有文章。", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text(
                    "去「导入学习内容 → 文本 → 文章」导入课文后，这里就能朗读和跟读了。",
                    color = Color.Gray,
                )
            }
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(inner),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(state.articles, key = { it.key }) { article ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenArticle(article.key, article.content.title) },
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Row {
                            Text(
                                article.content.title,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "${article.paragraphCount} 段",
                                fontSize = 13.sp,
                                color = Color.Gray,
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            article.preview,
                            fontSize = 14.sp,
                            color = Color.Gray,
                            maxLines = 2,
                        )
                    }
                }
            }
        }
    }
}
