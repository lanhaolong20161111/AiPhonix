package com.example.ai.ui.charimage

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ai.CharImageGradeSelection
import com.example.ai.CharImageList
import com.example.ai.data.auth.TokenManager
import com.example.ai.data.progress.CharImageProgressStore
import com.example.ai.data.progress.CharImageProgressStore.LastVisit

data class GradeEntry(
    val label: String,
    val grade: String,
    val semester: String,
)

private val grades = listOf(
    GradeEntry("二年级 · 上册", "二年级", "上"),
    GradeEntry("二年级 · 下册", "二年级", "下"),
    GradeEntry("三年级 · 上册", "三年级", "上"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CharImageRecognitionScreen(
    onNavigateToGrade: (CharImageGradeSelection) -> Unit,
    onContinue: (CharImageList) -> Unit,
    onBack: () -> Unit,
) {
    val lastVisit = remember { CharImageProgressStore.getLastVisit(TokenManager.userId) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("看图识字") },
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
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))
            Text(
                "选择年级",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "点击进入对应年级的字词图片",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))

            // 继续上次学习入口
            if (lastVisit != null) {
                ContinueCard(
                    visit = lastVisit,
                    onClick = {
                        onContinue(
                            CharImageList(
                                grade = lastVisit.grade,
                                semester = lastVisit.semester,
                                type_ = lastVisit.type,
                            )
                        )
                    },
                )
                Spacer(Modifier.height(24.dp))
            }

            Spacer(Modifier.height(16.dp))

            grades.forEach { entry ->
                GradeCard(
                    entry = entry,
                    onClick = {
                        onNavigateToGrade(
                            CharImageGradeSelection(
                                grade = entry.grade,
                                semester = entry.semester,
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
private fun ContinueCard(
    visit: LastVisit,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("⏩", fontSize = 28.sp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "继续上次学习",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "${gradeTitle(visit)} · ${typeTitle(visit.type)} · 第 ${visit.index + 1} 个",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
                )
            }
            Text("→", style = MaterialTheme.typography.titleMedium)
        }
    }
}

private fun gradeTitle(visit: LastVisit): String = when (visit.grade to visit.semester) {
    "二年级" to "上" -> "二年级上册"
    "二年级" to "下" -> "二年级下册"
    "三年级" to "上" -> "三年级上册"
    else -> "${visit.grade}${visit.semester}"
}

private fun typeTitle(type: String): String = when (type) {
    "认" -> "识字表"
    "写" -> "写字表"
    "词" -> "词语表"
    "英词" -> "英语词汇表"
    "英句" -> "英语句子表"
    else -> type
}

@Composable
private fun GradeCard(
    entry: GradeEntry,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(120.dp),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
        ),
    ) {
        Box(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    entry.label,
                    style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "识字表 · 写字表 · 词语表",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f),
                )
            }
        }
    }
}
