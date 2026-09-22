package com.example.ai.ui.radical

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.data.radical.RadicalFamilies
import com.example.ai.data.radical.RadicalItem
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.data.tts.charAudioUrl
import com.example.ai.data.tts.ttsAuthHeaders
import kotlinx.coroutines.launch

private val Black = Color(0xFF000000)
private val GoodText = Color(0xFF2E7D32)
private val GoodBg = Color(0xFFE8F5E9)
private val BadText = Color(0xFFB71C1C)
private val BadBg = Color(0xFFFFEBEE)
private val Purple = Color(0xFF7C3AED)
private val PurpleBg = Color(0xFFF3E8FF)
private val LabelGray = Color(0xFF334155)
private val HintGray = Color(0xFF94A3B8)
private val YellowBg = Color(0xFFFFF7ED)

/** 偏旁含义展示：「氵（三点水）」 */
private fun radicalMeaning(r: String, name: String): String = "$r（$name）"

/**
 * 偏旁魔法屋（对齐 web RadicalGamePage）：换偏旁识字游戏。
 * 口诀「声旁猜读音，形旁猜意思」；题型＝选字填空 / 选偏旁 / AI 字谜，另有 AI 儿歌。
 */
@Composable
fun RadicalGameScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: RadicalViewModel = viewModel { RadicalViewModel() },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ttsCache = remember { BaiduTtsCache(context.applicationContext) }

    DisposableEffect(Unit) {
        onDispose { BaiduTtsCache.stopAll() }
    }

    /** 朗读文本（中文）：speaker "0"=老师、"3"=爷爷 */
    val speakText: (String, String) -> Unit = { text, speaker ->
        if (text.isNotBlank()) {
            BaiduTtsCache.stopAll()
            scope.launch { ttsCache.play(text, speaker) }
        }
    }

    /** 朗读单字：走服务端单字音频库，带拼音锁读音（避免多音字读错） */
    val speakChar: (String, String) -> Unit = { ch, pinyin ->
        BaiduTtsCache.stopAll()
        ttsCache.playRemote(charAudioUrl(ch, pinyin), ttsAuthHeaders())
    }

    /** 点选项后朗读：选字填空读整词（无拼音）；其余读单字（有拼音） */
    val speakForQuestion: (RadicalQuestion) -> Unit = { q ->
        if (q.kind == RadicalKind.PICK_CHAR) {
            speakText(q.word, "0")
        } else {
            speakChar(q.item.char, q.item.pinyin)
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        // 顶栏
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←",
                style = MaterialTheme.typography.titleLarge,
                color = Black,
                modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
            )
            Text("🔮 偏旁魔法屋", style = MaterialTheme.typography.titleLarge, color = Black)
        }
        Spacer(Modifier.height(10.dp))

        when (state.phase) {
            RadicalPhase.SELECT -> SelectPane(
                onQuiz = { viewModel.startFamily(it) },
                onSong = { viewModel.openSong(it) },
                onRiddles = { viewModel.startRiddles(it) },
            )

            RadicalPhase.SONG -> SongPane(
                state = state,
                onSpeak = speakText,
                onStartQuiz = { viewModel.startFamily(state.familyIdx) },
            )

            RadicalPhase.QUIZ -> QuizPane(
                state = state,
                onPick = { opt ->
                    val q = state.current
                    viewModel.pick(opt)
                    if (q != null) speakForQuestion(q)
                },
                onNext = { viewModel.next() },
                onSpeakText = speakText,
                onSpeakChar = speakChar,
            )

            RadicalPhase.DONE -> DonePane(
                state = state,
                onRetry = { viewModel.startFamily(state.familyIdx) },
                onSelect = { viewModel.backToSelect() },
            )
        }
    }
}

// ─────────────────────────── 选字族 ───────────────────────────

@Composable
private fun SelectPane(
    onQuiz: (Int?) -> Unit,
    onSong: (Int) -> Unit,
    onRiddles: (Int) -> Unit,
) {
    Column {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = PurpleBg),
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text("声旁猜读音，形旁猜意思", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Purple)
                Spacer(Modifier.height(4.dp))
                Text(
                    "同一个字加不同偏旁，就变成新字：抱、饱、泡、炮都读 bao，偏旁告诉你它和什么有关",
                    fontSize = 13.sp,
                    color = LabelGray,
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        // 混合挑战
        Card(
            modifier = Modifier.fillMaxWidth().clickable { onQuiz(null) },
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🎲", fontSize = 30.sp)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("混合挑战", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Black)
                    Text("全部字族随机 8 题，敢来吗？", fontSize = 12.sp, color = HintGray)
                }
                Text("→", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = HintGray)
            }
        }
        Spacer(Modifier.height(10.dp))

        RadicalFamilies.ALL.forEachIndexed { idx, f ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Column {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onQuiz(idx) }
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(PurpleBg),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(f.base, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Purple)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                f.items.joinToString(" ") { it.char },
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = Black,
                            )
                            Text(
                                "读 ${f.pinyin} · ${f.items.size} 个字",
                                fontSize = 12.sp,
                                color = HintGray,
                            )
                        }
                        Text("→", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = HintGray)
                    }
                    Row(
                        modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = { onSong(idx) },
                            modifier = Modifier.semantics { contentDescription = "AI 编儿歌（读给你听）" },
                        ) {
                            Text("🎵 儿歌", fontSize = 13.sp, color = Black)
                        }
                        OutlinedButton(
                            onClick = { onRiddles(idx) },
                            modifier = Modifier.semantics { contentDescription = "AI 字谜挑战" },
                        ) {
                            Text("🧩 字谜", fontSize = 13.sp, color = Black)
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        Spacer(Modifier.height(24.dp))
    }
}

// ─────────────────────────── 儿歌 ───────────────────────────

@Composable
private fun SongPane(
    state: RadicalUiState,
    onSpeak: (String, String) -> Unit,
    onStartQuiz: () -> Unit,
) {
    val base = state.family?.base.orEmpty()
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                "🎵 AI 老师为「$base」编的儿歌",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = Black,
            )
            Spacer(Modifier.height(10.dp))

            if (state.songLoading) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("AI 老师正在编儿歌…（第一次会慢一点）", fontSize = 13.sp, color = Black)
                }
            } else {
                Text(
                    state.songText.orEmpty(),
                    fontSize = 16.sp,
                    color = LabelGray,
                    lineHeight = 30.sp,
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { onSpeak(state.songText.orEmpty(), "3") },
                        modifier = Modifier.semantics { contentDescription = "听爷爷读" },
                    ) {
                        Text("🧙 听爷爷读", fontSize = 13.sp, color = Black)
                    }
                    OutlinedButton(
                        onClick = { onSpeak(state.songText.orEmpty(), "0") },
                        modifier = Modifier.semantics { contentDescription = "听老师读" },
                    ) {
                        Text("🧑‍🏫 听老师读", fontSize = 13.sp, color = Black)
                    }
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = onStartQuiz,
                    colors = ButtonDefaults.buttonColors(containerColor = Purple),
                ) {
                    Text("开始答题 →", fontSize = 14.sp, color = Color.White)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "儿歌里藏着这一族所有的字，读的时候找找看！",
                    fontSize = 12.sp,
                    color = HintGray,
                )
            }
        }
    }
}

// ─────────────────────────── 答题 ───────────────────────────

@Composable
private fun QuizPane(
    state: RadicalUiState,
    onPick: (String) -> Unit,
    onNext: () -> Unit,
    onSpeakText: (String, String) -> Unit,
    onSpeakChar: (String, String) -> Unit,
) {
    val q = state.current
    if (state.riddleLoading) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text("AI 老师正在出字谜…", fontSize = 13.sp, color = Black)
        }
        return
    }
    if (q == null) {
        Text("题目加载失败，请返回重试", fontSize = 13.sp, color = BadText)
        return
    }

    Column {
        Text(
            "第 ${state.qIdx + 1} / ${state.questions.size} 题 · ⭐ ${state.score}",
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = LabelGray,
        )
        Spacer(Modifier.height(10.dp))

        // 题干卡
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                when (q.kind) {
                    RadicalKind.RIDDLE -> {
                        Text("🧩 字谜：猜猜是哪个字？", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Purple)
                        Spacer(Modifier.height(8.dp))
                        Text(q.stem, fontSize = 17.sp, color = Black, lineHeight = 28.sp)
                    }
                    RadicalKind.PICK_CHAR -> {
                        Text("选出正确的字：", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = LabelGray)
                        Spacer(Modifier.height(8.dp))
                        Text(q.stem, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Black)
                        Spacer(Modifier.height(8.dp))
                        Surface(shape = RoundedCornerShape(8.dp), color = YellowBg) {
                            Text(
                                "偏旁 ${radicalMeaning(q.item.radical, q.item.radicalName)} · ${q.item.radicalMeaning}",
                                fontSize = 13.sp,
                                color = LabelGray,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            )
                        }
                    }
                    RadicalKind.PICK_RADICAL -> {
                        Text("「${q.stem}」的偏旁是什么？", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = LabelGray)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            q.stem,
                            fontSize = 40.sp,
                            fontWeight = FontWeight.Bold,
                            color = Black,
                            modifier = Modifier
                                .clickable { onSpeakChar(q.stem, "") }
                                .semantics { contentDescription = "朗读 ${q.stem}" },
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))

        // 选项（每行 2 个）
        q.options.chunked(2).forEach { rowOpts ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                rowOpts.forEach { opt ->
                    OptionButton(
                        opt = opt,
                        picked = state.picked,
                        answer = q.answer,
                        modifier = Modifier.weight(1f),
                        onClick = { onPick(opt) },
                    )
                }
                repeat(2 - rowOpts.size) { Spacer(Modifier.weight(1f)) }
            }
            Spacer(Modifier.height(10.dp))
        }

        // 讲解
        if (state.picked != null) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (state.correct) GoodBg else BadBg,
                ),
                border = BorderStroke(1.dp, (if (state.correct) GoodText else BadText).copy(alpha = 0.35f)),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        if (state.correct) "🎉 答对了！" else "❌ 正确答案是「${q.answer}」",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (state.correct) GoodText else BadText,
                    )
                    Spacer(Modifier.height(6.dp))
                    val item: RadicalItem = q.item
                    Text(
                        "${item.char} 读 ${item.pinyin}，${item.radical}（${item.radicalName}）${item.radicalMeaning}，如「${item.word}」" +
                            if (item.exception.isNotBlank()) "。⚠️ ${item.exception}" else "。读音和声旁很接近",
                        fontSize = 14.sp,
                        color = Black,
                        lineHeight = 24.sp,
                    )
                    state.xiaodou?.let {
                        Spacer(Modifier.height(6.dp))
                        Text("🧒 $it", fontSize = 13.sp, color = LabelGray)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { onSpeakChar(item.char, item.pinyin) },
                            modifier = Modifier.semantics { contentDescription = "读 ${item.char}" },
                        ) {
                            Text("🔊 读 ${item.char}", fontSize = 13.sp, color = Black)
                        }
                        OutlinedButton(
                            onClick = { onSpeakText(item.word, "0") },
                            modifier = Modifier.semantics { contentDescription = "读 ${item.word}" },
                        ) {
                            Text("🔊 读 ${item.word}", fontSize = 13.sp, color = Black)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = onNext,
                        colors = ButtonDefaults.buttonColors(containerColor = GoodText),
                    ) {
                        Text(
                            if (state.qIdx + 1 >= state.questions.size) "看结果 →" else "下一题 →",
                            fontSize = 14.sp,
                            color = Color.White,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun OptionButton(
    opt: String,
    picked: String?,
    answer: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val isAnswer = opt == answer
    val isPicked = picked == opt
    val bg = when {
        picked == null -> Color(0xFFF1F5F9)
        isAnswer -> GoodBg
        isPicked -> BadBg
        else -> Color(0xFFF8FAFC)
    }
    val fg = when {
        picked == null -> Black
        isAnswer -> GoodText
        isPicked -> BadText
        else -> HintGray
    }
    Button(
        onClick = onClick,
        enabled = picked == null,
        modifier = modifier
            .height(56.dp)
            .semantics { contentDescription = "选项 $opt" },
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = bg,
            disabledContainerColor = bg,
        ),
    ) {
        Text(opt, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = fg)
    }
}

// ─────────────────────────── 结算 ───────────────────────────

@Composable
private fun DonePane(
    state: RadicalUiState,
    onRetry: () -> Unit,
    onSelect: () -> Unit,
) {
    val total = state.questions.size
    val score = state.score
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                when {
                    total > 0 && score == total -> "🏆"
                    total > 0 && score >= total * 0.7 -> "🎉"
                    else -> "💪"
                },
                fontSize = 44.sp,
            )
            Spacer(Modifier.height(8.dp))
            Text("$score / $total", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Black)
            Spacer(Modifier.height(6.dp))
            Text(
                when {
                    total > 0 && score == total -> "全对！你就是偏旁小魔法师！"
                    total > 0 && score >= total * 0.7 -> "很棒！记住口诀：声旁猜读音，形旁猜意思"
                    else -> "多练几遍就熟啦，偏旁是识字的魔法钥匙"
                },
                fontSize = 14.sp,
                color = LabelGray,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = onRetry,
                colors = ButtonDefaults.buttonColors(containerColor = Purple),
            ) {
                Text("再来一轮", fontSize = 14.sp, color = Color.White)
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onSelect) {
                Text("选别的字族", fontSize = 14.sp, color = Black)
            }
        }
    }
}
