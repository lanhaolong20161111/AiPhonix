package com.example.ai.ui.parentreport

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.parentreport.DayStat
import com.example.ai.data.parentreport.WeakWord
import com.example.ai.util.jsNumber

/**
 * 家长周报（对齐 web `ParentReportPage` / `/module/parent_report`）：
 * 近 7 天评测趋势 + 识字状态 + 需多练的词，供家长查看。
 *
 * ⚠️ 本页**不是** `ui/report/ReportScreen`（那个读 `/api/v1/practice/stats`，是本 App 自己的
 * 「学习报告」），两者数据源与内容完全不同，别混。
 */
@Composable
fun ParentReportScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ParentReportViewModel = viewModel { ParentReportViewModel() },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        // ── 顶栏 ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("📈 家长周报", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "近 7 天学习数据一览（数据来自本账号的评测与学习记录）。",
            fontSize = 13.sp,
            color = Black,
        )
        Spacer(Modifier.height(12.dp))

        when {
            state.loading -> {
                Text("统计中…", fontSize = 14.sp, color = LabelGray)
            }

            state.failed -> {
                // 与 web 的差异（有意）：web 断网时三路都 catch 成空值，页面显示一片 0；
                // 这里给一句明确提示，避免家长误以为「孩子这周没练」。
                Text(
                    "⚠️ 统计数据加载失败（断网），请检查网络后重试",
                    fontSize = 14.sp,
                    color = StatRed,
                )
            }

            else -> {
                StatCards(state)
                Spacer(Modifier.height(10.dp))
                DailyBars(state.days, state.maxCount)
                Spacer(Modifier.height(10.dp))
                LiteracyCard(state.stats.correct, state.stats.unsure, state.stats.wrong)
                if (state.weakWords.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    WeakWordsCard(state.weakWords)
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    "生成时间 ${state.generatedAt} · AiPhonix",
                    fontSize = 11.sp,
                    color = FooterGray,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

// ───────────────────────── 四张统计卡（web 是 2 列 grid）─────────────────────────

@Composable
private fun StatCards(state: ParentReportUiState) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatCard("${state.weekCount}", "本周发音评测", Modifier.weight(1f))
            StatCard(state.weekAvgText, "本周平均分", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatCard("${state.stats.correct}", "已点亮字词", Modifier.weight(1f))
            StatCard("${state.wordCount}", "生词本收藏", Modifier.weight(1f))
        }
    }
}

@Composable
private fun StatCard(number: String, label: String, modifier: Modifier = Modifier) {
    SectionCard(modifier) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(number, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = NumBlue)
            Spacer(Modifier.height(2.dp))
            Text(label, fontSize = 12.sp, color = LabelGray)
        }
    }
}

// ───────────────────────── 每日评测次数柱状图 ─────────────────────────

@Composable
private fun DailyBars(days: List<DayStat>, maxCount: Int) {
    SectionCard {
        Column(modifier = Modifier.padding(14.dp)) {
            SectionTitle("📅 每日评测次数")
            Row(
                modifier = Modifier.fillMaxWidth().height(96.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                days.forEach { d ->
                    Column(
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Bottom,
                    ) {
                        Text(
                            if (d.count > 0) "${d.count}" else "",
                            fontSize = 11.sp,
                            color = LabelGray,
                        )
                        // 空轨道 + 渐变填充（web 的 `.report-bar` / `.report-bar-fill`；
                        // web 是 `max-width: 34px`，这里取 28dp 以保证 320dp 窄屏 7 列不溢出）
                        Box(
                            modifier = Modifier
                                .height(BAR_TRACK_HEIGHT)
                                .width(28.dp)
                                .clip(RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp))
                                .background(TrackBg),
                            contentAlignment = Alignment.BottomCenter,
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    // web 有 `min-height: 2px` ⇒ 0 次也留一截可见的细条
                                    .height(maxOf(2f, 60f * d.count / maxCount).dp)
                                    .background(BarFillBrush),
                            )
                        }
                        Spacer(Modifier.height(2.dp))
                        // web 是 `d.date.slice(8)` ⇒ 只取「日」
                        Text("${d.date.takeLast(2)}日", fontSize = 11.sp, color = DayGray)
                    }
                }
            }
        }
    }
}

// ───────────────────────── 识字状态 ─────────────────────────

@Composable
private fun LiteracyCard(correct: Int, unsure: Int, wrong: Int) {
    SectionCard {
        Column(modifier = Modifier.padding(14.dp)) {
            SectionTitle("📖 识字状态")
            Text(
                buildAnnotatedString {
                    append("认识 ")
                    withStyle(SpanStyle(color = StatGreen, fontWeight = FontWeight.Bold)) { append("$correct") }
                    append(" 个 · 不确定 ")
                    withStyle(SpanStyle(color = StatAmber, fontWeight = FontWeight.Bold)) { append("$unsure") }
                    append(" 个 · 还不会 ")
                    withStyle(SpanStyle(color = StatRed, fontWeight = FontWeight.Bold)) { append("$wrong") }
                    append(" 个")
                },
                fontSize = 14.sp,
                color = LineGray,
            )
        }
    }
}

// ───────────────────────── 需要多练的词 ─────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WeakWordsCard(words: List<WeakWord>) {
    SectionCard {
        Column(modifier = Modifier.padding(14.dp)) {
            SectionTitle("🎯 需要多练的词（近 30 天最低分）")
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                words.forEach { w ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(WeakBg)
                            .border(BorderStroke(1.dp, WeakBorder), RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    ) {
                        Text(
                            buildAnnotatedString {
                                append("${w.key} ")
                                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                                    append("${jsNumber(w.score)}分")
                                }
                            },
                            fontSize = 13.sp,
                            color = WeakText,
                        )
                    }
                }
            }
        }
    }
}

// ───────────────────────── 公共小件 ─────────────────────────

@Composable
private fun SectionCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, CardBorder),
    ) { content() }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = TitleSlate)
    Spacer(Modifier.height(8.dp))
}

// ───────────────────────── 配色（取自 web App.css 的 .report-* 规则，逐条对齐）─────────────────────────

private val Black = Color(0xFF000000)
private val CardBorder = Color(0xFFE5E7EB)
private val NumBlue = Color(0xFF2563EB)
private val LabelGray = Color(0xFF6B7280)
private val DayGray = Color(0xFF94A3B8)
private val TitleSlate = Color(0xFF334155)
private val LineGray = Color(0xFF374151)
private val FooterGray = Color(0xFFCBD5E1)
private val TrackBg = Color(0xFFF8FAFC)
private val WeakBg = Color(0xFFFEF2F2)
private val WeakBorder = Color(0xFFFECACA)
private val WeakText = Color(0xFFB91C1C)
private val StatGreen = Color(0xFF16A34A)
private val StatAmber = Color(0xFFD97706)
private val StatRed = Color(0xFFDC2626)
private val BarFillBrush = Brush.verticalGradient(listOf(Color(0xFF60A5FA), Color(0xFF2563EB)))

private val BAR_TRACK_HEIGHT = 60.dp
