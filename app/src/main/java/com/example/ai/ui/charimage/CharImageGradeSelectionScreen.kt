package com.example.ai.ui.charimage

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.CharImageList
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.progress.CharImageProgressStore

data class TypeEntry(
    val label: String,
    val type_: String,
    val emoji: String,
    val description: String,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CharImageGradeSelectionScreen(
    grade: String,
    semester: String,
    onNavigateToList: (CharImageList) -> Unit,
    onBack: () -> Unit,
) {
    val gradeLabel = "${grade}${if (semester == "上") "上册" else "下册"}"

    val types = mutableListOf(
        TypeEntry("识字表", "认", "📖", "课本认字表全部图片"),
        TypeEntry("写字表", "写", "✏️", "课本写字表全部图片"),
        TypeEntry("词语表", "词", "📝", "课本词语表全部图片"),
    )
    if (grade == "三年级" && semester == "上") {
        types.add(TypeEntry("英语词汇表", "英词", "🔤", "三年级上册英语词汇图片"))
        types.add(TypeEntry("英语句子表", "英句", "💬", "三年级上册英语句子图片"))
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(gradeLabel) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                ),
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(32.dp))
            Text(
                "选择字词表",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                gradeLabel,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(40.dp))

            types.forEach { entry ->
                val lastIndex = CharImageProgressStore.getPosition(
                    TokenManager.userId, grade, semester, entry.type_,
                )
                TypeCard(
                    entry = entry,
                    lastIndex = if (lastIndex >= 0) lastIndex else null,
                    onClick = {
                        onNavigateToList(
                            CharImageList(
                                grade = grade,
                                semester = semester,
                                type_ = entry.type_,
                            )
                        )
                    },
                )
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun TypeCard(
    entry: TypeEntry,
    lastIndex: Int? = null,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(100.dp),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = if (lastIndex != null) 6.dp else 4.dp),
        border = if (lastIndex != null) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(entry.emoji, fontSize = 36.sp)
            Spacer(Modifier.width(20.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    entry.label,
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    entry.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f),
                )
            }
            if (lastIndex != null) {
                Text(
                    "⏩ 上次：第 ${lastIndex + 1} 个",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
