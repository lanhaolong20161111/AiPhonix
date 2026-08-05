package com.example.ai.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import com.example.ai.AppContainer
import com.example.ai.data.auth.TokenManager
import com.example.ai.CharImageRecognition
import com.example.ai.DailyPractice
import com.example.ai.EnglishLearning
import com.example.ai.data.training.FeatureId
import com.example.ai.data.training.PlanItem
import com.example.ai.data.training.TrainingPlan
import com.example.ai.ImportCenter
import com.example.ai.MyImports
import com.example.ai.MyLearning
import com.example.ai.OralWriting
import com.example.ai.Recognition
import com.example.ai.Dictation
import com.example.ai.WordPractice
import com.example.ai.VideoPractice

/**
 * 首页 — 任务驱动：学生只能看到家长配置的"今日任务"项。
 * 家长通过「家长设置」（PIN 保护）决定页面集合。
 */
@Composable
fun HomeScreen(
    onStartItem: (itemId: String, navKey: NavKey) -> Unit,
    onOpenAccount: () -> Unit,
    onOpenParent: () -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = viewModel<HomeViewModel> { HomeViewModel(container.contentRepository) },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val plan by container.trainingPlanStore.plan.collectAsStateWithLifecycle()

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp)
            .navigationBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(32.dp))

        // 问候行（靠左）：圆圈头像 + 早上好；头像→账户页，🔒→家长设置
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
                    .clickable { onOpenAccount() },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    TokenManager.nickname.ifBlank { TokenManager.username }.take(1),
                    color = MaterialTheme.colorScheme.onPrimary,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.Start, modifier = Modifier.weight(1f)) {
                Text(
                    "🌟 早上好，${TokenManager.nickname.ifBlank { TokenManager.username }}！",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "🔥 连续学习 ${state.streakDays} 天",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // 家长设置快捷入口（PIN 保护）
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                    .clickable { onOpenParent() },
                contentAlignment = Alignment.Center,
            ) {
                Text("🔒", fontSize = 22.sp)
            }
        }
        Spacer(Modifier.height(20.dp))

        // ── 主区域：今日任务 ──
        // 只显示可训练项（导入/我的导入是家长管理功能，不会出现在学生任务里）
        val items = plan?.items.orEmpty().filter { it.featureId?.isTraining == true }
        if (items.isEmpty()) {
            NoPlanCard(onOpenParent = onOpenParent)
        } else {
            Text(
                "🎯 今日任务",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "已完成 ${items.count { it.done }} / ${items.size} · 家长设置可调整",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))
            items.forEach { item ->
                val feature = item.featureId
                val navKey = feature?.toNavKey()
                if (feature != null && navKey != null) {
                    TaskItemCard(
                        item = item,
                        feature = feature,
                        onClick = { onStartItem(item.id, navKey) },
                    )
                    Spacer(Modifier.height(12.dp))
                }
            }
            // 全部完成祝贺
            if (items.isNotEmpty() && items.all { it.done }) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "🎉 全部完成！今天也很棒！",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                )
            }
        }

        // 底部固定留白：保证滚动到底后最后一张卡片完整进入视口，
        // 不依赖 navigationBars insets（部分设备手势导航 insets 为 0）
        Spacer(Modifier.height(80.dp))
    }
}

/** 任务项 → 目标页面（NavKey 映射）。返回 null 表示该功能未映射（防御性）。 */
private fun FeatureId.toNavKey(): NavKey? = when (this) {
    FeatureId.RECOGNITION -> Recognition
    FeatureId.DICTATION -> Dictation
    FeatureId.WORD_PRACTICE -> WordPractice
    FeatureId.ORAL_WRITING -> OralWriting
    FeatureId.CHAR_IMAGE -> CharImageRecognition
    FeatureId.ENGLISH -> EnglishLearning
    FeatureId.VIDEO_PRACTICE -> VideoPractice
    FeatureId.DAILY_PRACTICE -> DailyPractice
    FeatureId.MY_LEARNING -> MyLearning
    FeatureId.IMPORT_CENTER -> ImportCenter
    FeatureId.MY_IMPORTS -> MyImports
}

/** 空态：家长还没配置任务 */
@Composable
private fun NoPlanCard(onOpenParent: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("📭", fontSize = 40.sp)
            Spacer(Modifier.height(10.dp))
            Text("还没有今日任务", fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(
                "请家长点击右上角 🔒 设置训练任务\n学生首页只会显示家长选择的训练",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
            Button(onClick = onOpenParent) { Text("去设置（家长）") }
        }
    }
}

/** 任务项卡片：图标 + 标题 + 目标/状态；已完成置灰并显示 ✓ */
@Composable
private fun TaskItemCard(
    item: PlanItem,
    feature: FeatureId,
    onClick: () -> Unit,
) {
    val done = item.done
    OutlinedCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(96.dp),
        colors = CardDefaults.outlinedCardColors(
            containerColor = if (done) {
                MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.4f)
            } else {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            }
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 图标列：固定宽度，垂直居中 → 所有卡片图标在同一竖线、同一水平线上
            Box(
                modifier = Modifier.width(52.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(feature.emoji, fontSize = 34.sp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(feature.title, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Spacer(Modifier.height(2.dp))
                Text(
                    feature.subtitle,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                if (done) "✓" else "→",
                fontSize = if (done) 22.sp else 18.sp,
                fontWeight = FontWeight.Bold,
                color = if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
