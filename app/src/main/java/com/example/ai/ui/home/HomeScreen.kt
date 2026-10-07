package com.example.ai.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.ui.graphics.Color
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
import com.example.ai.AiPractice
import com.example.ai.OralWriting
import com.example.ai.Recognition
import com.example.ai.Dictation
import com.example.ai.WordPractice
import com.example.ai.VideoPractice
import com.example.ai.Murmur

/**
 * 首页 — 任务驱动：学生只能看到家长配置的"今日任务"项。
 * 家长通过「家长设置」（PIN 保护）决定页面集合。
 */
@Composable
fun HomeScreen(
    onStartItem: (item: PlanItem, navKey: NavKey) -> Unit,
    onOpenAccount: () -> Unit,
    onOpenParent: () -> Unit,
    onOpenPinyin: () -> Unit = {},
    onOpenPinyinTable: () -> Unit = {},
    onOpenMurmur: () -> Unit = {},
    onOpenWordbook: () -> Unit = {},
    onOpenMemoryJoy: () -> Unit = {},
    onOpenCharMap: () -> Unit = {},
    onOpenDiary: () -> Unit = {},
    onOpenRadicalGame: () -> Unit = {},
    onOpenDailyChinese: () -> Unit = {},
    onOpenDailyEnglish: () -> Unit = {},
    onOpenSpeechCompose: () -> Unit = {},
    onOpenAiEnglishTalk: () -> Unit = {},
    onOpenMathCompoundExpr: () -> Unit = {},
    onOpenEqMove: () -> Unit = {},
    onOpenMathUnits: () -> Unit = {},
    onOpenMathMulOne: () -> Unit = {},
    onOpenMathRelations: () -> Unit = {},
    onOpenSubtitleCapture: () -> Unit = {},
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

        // ── 固定模块入口（学习工具区） ──
        Text(
            "🧰 学习工具",
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        )

        // 拼音练习
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onOpenPinyin() },
            colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD)),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🔤", fontSize = 28.sp)
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("拼音练习", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "看拼音读，SOE 评测 · 总分≥70 进下一关",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text("进入 →", fontSize = 14.sp, color = Color(0xFF1565C0), fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.height(12.dp))

        // ── 固定模块入口：拼音表 ──
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onOpenPinyinTable() },
            colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("📖", fontSize = 28.sp)
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("拼音表", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "声母 · 韵母 · 整体认读音节 · 点读发声",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text("进入 →", fontSize = 14.sp, color = Color(0xFF2E7D32), fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.height(12.dp))

        // ── 固定模块入口：碎碎念 ──
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onOpenMurmur() },
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFCE4EC)),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("💬", fontSize = 28.sp)
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("碎碎念", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "自由表达 → AI 纠错 → 朗读+测评",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text("进入 →", fontSize = 14.sp, color = Color(0xFFC2185B), fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.height(12.dp))

        // 生词本
        ToolCard(
            emoji = "📓",
            title = "生词本",
            subtitle = "到期的词每天复习一遍，认对的间隔更长",
            containerColor = Color(0xFFFFF3E0),
            arrowColor = Color(0xFFE65100),
            onClick = onOpenWordbook,
        )
        Spacer(Modifier.height(12.dp))

        // 记忆快乐本
        ToolCard(
            emoji = "🌟",
            title = "记忆快乐本",
            subtitle = "今日字词编成小故事，按日期收藏",
            containerColor = Color(0xFFFFF8E1),
            arrowColor = Color(0xFFF57F17),
            onClick = onOpenMemoryJoy,
        )
        Spacer(Modifier.height(12.dp))

        // 汉字地图
        ToolCard(
            emoji = "🗺️",
            title = "汉字地图",
            subtitle = "全部字词铺成地图，学会的点亮",
            containerColor = Color(0xFFE0F2F1),
            arrowColor = Color(0xFF00695C),
            onClick = onOpenCharMap,
        )
        Spacer(Modifier.height(12.dp))

        // 成长日记
        ToolCard(
            emoji = "📖",
            title = "成长日记",
            subtitle = "每天一句话，AI 老师帮你润色点评",
            containerColor = Color(0xFFEDE7F6),
            arrowColor = Color(0xFF4527A0),
            onClick = onOpenDiary,
        )
        Spacer(Modifier.height(12.dp))

        // 偏旁魔法屋
        ToolCard(
            emoji = "🔮",
            title = "偏旁魔法屋",
            subtitle = "换偏旁识字：声旁猜读音，形旁猜意思",
            containerColor = Color(0xFFF3E5F5),
            arrowColor = Color(0xFF6A1B9A),
            onClick = onOpenRadicalGame,
        )
        Spacer(Modifier.height(12.dp))

        // 每日语文（家长设今日字词句/作文主题，孩子从 4 个入口练）
        ToolCard(
            emoji = "🏆",
            title = "每日语文",
            subtitle = "家长设今日字词句，孩子逐项练",
            containerColor = Color(0xFFE8F5E9),
            arrowColor = Color(0xFF2E7D32),
            onClick = onOpenDailyChinese,
        )
        Spacer(Modifier.height(12.dp))

        // 每日英语（家长设今日单词/句子，单词卡+句子卡带发音评测）
        ToolCard(
            emoji = "🏆",
            title = "每日英语",
            subtitle = "今日单词与句子，跟读评测",
            containerColor = Color(0xFFE3F2FD),
            arrowColor = Color(0xFF1565C0),
            onClick = onOpenDailyEnglish,
        )
        Spacer(Modifier.height(12.dp))

        // AI 对话学语文（一问一答教学 / 古诗跟读 / 文章背诵，都是 AI 领读 + 跟读测评）
        ToolCard(
            emoji = "🤖",
            title = "AI 对话学语文",
            subtitle = "一问一答学语文，古诗与文章跟读背诵",
            containerColor = Color(0xFFF3E5F5),
            arrowColor = Color(0xFF6A1B9A),
            onClick = onOpenSpeechCompose,
        )
        Spacer(Modifier.height(12.dp))

        // AI 英语对话（AI 给台词与回答 → 逐词跟读阶梯；也可自己说 → 录音识别判定）
        ToolCard(
            emoji = "🗣",
            title = "AI 英语对话",
            subtitle = "AI 陪你说英语，跟读阶梯或自己开口答",
            containerColor = Color(0xFFE0F2F1),
            arrowColor = Color(0xFF00695C),
            onClick = onOpenAiEnglishTalk,
        )
        Spacer(Modifier.height(12.dp))

        // 🧮 动画学数学（对齐 web 首页的「动画学数学」分区）
        Text(
            "🧮 动画学数学",
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        )

        // 三年级上综合算式动画（找→换→查：合并两个分步算式，讲清何时必须加括号）
        ToolCard(
            emoji = "🧮",
            title = "三年级上综合算式动画",
            subtitle = "动画演示「找→换→查」合并两个算式，何时必须加括号",
            containerColor = Color(0xFFE8EAF6),
            arrowColor = Color(0xFF3949AB),
            onClick = onOpenMathCompoundExpr,
        )
        Spacer(Modifier.height(12.dp))

        // 等式变变变（移项变号：幽灵飞越等号线、跨线翻牌，含随机 5 题练习）
        ToolCard(
            emoji = "⚖️",
            title = "等式变变变",
            subtitle = "动画演示移项变号：跨过等号符号才变，同侧换位置不变",
            containerColor = Color(0xFFFFF7ED),
            arrowColor = Color(0xFFEA580C),
            onClick = onOpenEqMove,
        )
        Spacer(Modifier.height(12.dp))

        // 长度与质量单位（切开/拼合动画 + 真实尺寸米尺 + 参照物墙）
        ToolCard(
            emoji = "📏",
            title = "长度与质量单位",
            subtitle = "毫米/厘米/分米/米/千米 · 克/千克/吨 —— 切开拼合看懂方向，参照物建立量感",
            containerColor = Color(0xFFE3F2FD),
            arrowColor = Color(0xFF1565C0),
            onClick = onOpenMathUnits,
        )
        Spacer(Modifier.height(12.dp))

        // 多位数乘一位数（竖式逐位四拍 + 位值点阵）
        ToolCard(
            emoji = "✏️",
            title = "多位数乘一位数",
            subtitle = "竖式逐位四拍：乘 → 加进位 → 写 → 进 · 位值点阵看懂为什么从个位乘起",
            containerColor = Color(0xFFF3E5F5),
            arrowColor = Color(0xFF6A1B9A),
            onClick = onOpenMathMulOne,
        )
        Spacer(Modifier.height(12.dp))

        // 数量关系与交换（颜色标角色：同色能换、异色换了就变）
        ToolCard(
            emoji = "🔁",
            title = "数量关系与交换",
            subtitle = "一共 · 比多少 · 倍数 · 平均分 —— 颜色标角色，一眼看出换位置会不会变",
            containerColor = Color(0xFFE0F2F1),
            arrowColor = Color(0xFF00695C),
            onClick = onOpenMathRelations,
        )
        Spacer(Modifier.height(12.dp))

        // 🎬 视频（对齐 web 首页的「视频」分区；视频跟读在「英语学习」里）
        Text(
            "🎬 视频",
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        )

        // 字幕采集（框选影片字幕区截屏存盘带时间戳，暂停可自动识图+翻译+纠错）
        ToolCard(
            emoji = "🎞️",
            title = "字幕采集",
            subtitle = "框选影片字幕 · 截屏存盘带时间戳",
            containerColor = Color(0xFFECEFF1),
            arrowColor = Color(0xFF37474F),
            onClick = onOpenSubtitleCapture,
        )
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
                        onClick = { onStartItem(item, navKey) },
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
    FeatureId.AI_PRACTICE -> AiPractice
    FeatureId.IMPORT_CENTER -> ImportCenter
    FeatureId.MY_IMPORTS -> MyImports
}

/** 固定工具入口卡片（首页「学习工具」区）：图标 + 标题 + 副标题 + 进入箭头 */
@Composable
private fun ToolCard(
    emoji: String,
    title: String,
    subtitle: String,
    containerColor: Color,
    arrowColor: Color,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = containerColor),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(emoji, fontSize = 28.sp)
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(
                    subtitle,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("进入 →", fontSize = 14.sp, color = arrowColor, fontWeight = FontWeight.Bold)
        }
    }
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
