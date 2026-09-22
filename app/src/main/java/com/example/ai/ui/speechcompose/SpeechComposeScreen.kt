package com.example.ai.ui.speechcompose

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.tts.BaiduTtsCache
import com.example.ai.data.zhteach.PoemLine
import com.example.ai.data.zhteach.PoemSearchHit

/**
 * AI 对话学语文（对齐 web `pages/SpeechComposePage.tsx`）。
 *
 * 一个页面三种练习，由 [SpeechComposeUiState.mode] 分发：
 * 设置页 → 古诗 / 文章 / 词语句子教学，各自有独立的练习与完成界面。
 *
 * 与 web 的有意差异（非遗漏）：
 *  - web 的设置面板支持**拍照 OCR 自动填入**（每日语文/英语同样依赖），Android 端尚未移植
 *    区域 OCR（与「字幕采集」一并做）。
 *  - web 古诗页有「预取下一句音频」的 warm 优化；Android 的 TTS 缓存没有"只下载不播放"的入口，
 *    故不做预取（只影响首次点击的等待感，不影响正确性）。
 */
@Composable
fun SpeechComposeScreen(
    viewModel: SpeechComposeViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    // 离开页面立即停掉朗读（VM.onCleared 未必马上触发：页面仍在返回栈时 ViewModel 还活着）
    DisposableEffect(Unit) {
        onDispose { BaiduTtsCache.stopAll() }
    }

    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        when (state.mode) {
            ComposeMode.SETUP -> SetupSection(viewModel, state, onBack)

            ComposeMode.POEM ->
                if (state.poemAllDone) PoemDoneSection(viewModel, state, onBack)
                else PoemSection(viewModel, state, onBack)

            ComposeMode.ARTICLE ->
                if (state.artAllDone) ArticleDoneSection(viewModel, state, onBack)
                else ArticleSection(viewModel, state, onBack)

            ComposeMode.TEACH ->
                if (state.teachStage == TeachStage.FINISHED) TeachDoneSection(viewModel, state, onBack)
                else TeachSection(viewModel, state, onBack)
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// 设置页
// ══════════════════════════════════════════════════════════════════

@Composable
private fun SetupSection(
    viewModel: SpeechComposeViewModel,
    state: SpeechComposeUiState,
    onBack: () -> Unit,
) {
    TopBar(title = "🤖 AI 对话学语文", onBack = onBack)
    Spacer(Modifier.height(8.dp))

    TipCard(
        "先告诉 AI 主题和要练的词语/句子，它会出好多道题带你一问一答，把每个词的意思和用法都练到。" +
            "想练背诵？把整篇课文/段落粘贴到下面的「要练的文章」，就会带你一句一句朗读 + 跟读测评，" +
            "还给每句配一个背诵提示。",
    )

    FieldLabel("主题 / 场景（可选，不填 AI 自动决定）")
    OutlinedTextField(
        value = state.topic,
        onValueChange = viewModel::onTopicChange,
        placeholder = { Text("如：春天的公园 / 我的周末") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )

    FieldLabel("要练的词语（逗号或空格分隔）")
    OutlinedTextField(
        value = state.wordsText,
        onValueChange = viewModel::onWordsChange,
        placeholder = { Text("如：快乐、颜色、跑步") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )

    FieldLabel("要练的句子（每行一句，可选）")
    OutlinedTextField(
        value = state.sentencesText,
        onValueChange = viewModel::onSentencesChange,
        placeholder = { Text("如：我喜欢和好朋友一起玩。\n公园里的花真漂亮！") },
        minLines = 2,
        modifier = Modifier.fillMaxWidth(),
    )

    FieldLabel("要练的文章（可选，填了就练文章：按句朗读 + 跟读测评 + 背诵提示）")
    OutlinedTextField(
        value = state.articleText,
        onValueChange = viewModel::onArticleTextChange,
        placeholder = {
            Text("把要背的课文/段落整段粘贴进来，如：\n秋天的雨，是一把钥匙。它带着清凉和温柔……")
        },
        minLines = 3,
        modifier = Modifier.fillMaxWidth(),
    )

    if (state.poemPicked.isNotBlank()) {
        Spacer(Modifier.height(6.dp))
        Text("✅ ${state.poemPicked}，可直接点「开始学」", color = GREEN, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }

    FieldLabel("🔍 搜小学古诗（输入诗题或作者，选一条自动填入）")
    OutlinedTextField(
        value = state.poemQuery,
        onValueChange = viewModel::onPoemQueryChange,
        placeholder = { Text("如：静夜思 / 望庐山瀑布 / 李白") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    if (state.poemSearching) {
        Text("搜索中…", color = GRAY_TEXT, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
    }
    state.poemHits.forEach { hit ->
        PoemHitRow(hit) { viewModel.pickPoem(hit) }
    }

    FieldLabel("要练的古诗（可选，填了就练古诗）")
    OutlinedTextField(
        value = state.poemText,
        onValueChange = viewModel::onPoemTextChange,
        placeholder = { Text("如：床前明月光，疑是地上霜。\n举头望明月，低头思故乡。") },
        minLines = 2,
        modifier = Modifier.fillMaxWidth(),
    )

    if (state.setupError.isNotBlank()) {
        Spacer(Modifier.height(6.dp))
        Text(state.setupError, color = RED, fontSize = 14.sp)
    }

    Spacer(Modifier.height(12.dp))
    Button(
        onClick = viewModel::start,
        enabled = !state.settingUp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            if (state.settingUp) "AI 出题中… ${state.waitSec}s（超过 60 秒会自动用原文先开始）" else "✨ 开始学",
        )
    }
}

@Composable
private fun PoemHitRow(hit: PoemSearchHit, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp).clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = CHIP_BG),
    ) {
        Column(Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("《${hit.title}》", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = BLACK)
                Spacer(Modifier.width(8.dp))
                Text("${hit.dynasty}·${hit.author}", color = GREEN, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            }
            val first = hit.text.lineSequence().firstOrNull().orEmpty()
            if (first.isNotBlank()) {
                Text(first, color = GRAY_TEXT, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// 词语 / 句子教学
// ══════════════════════════════════════════════════════════════════

@Composable
private fun TeachSection(
    viewModel: SpeechComposeViewModel,
    state: SpeechComposeUiState,
    onBack: () -> Unit,
) {
    TopBar(
        title = "🤖 AI 对话学语文",
        onBack = onBack,
        trailing = "${state.teachIdx + 1}/${state.teachTotal} · 覆盖 ${state.coveredCount}/${state.units.size}",
    )
    Spacer(Modifier.height(8.dp))

    // AI 提问气泡（点句中的字可单独听那个字）
    val item = state.currentTeachItem
    if (item != null) {
        Card(colors = CardDefaults.cardColors(containerColor = BUBBLE_BG), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                Text(
                    "🤖 AI · ${state.script?.title.orEmpty().ifBlank { state.topic.ifBlank { "语文对话" } }}",
                    fontSize = 12.sp,
                    color = GRAY_TEXT,
                )
                Spacer(Modifier.height(6.dp))
                // 孩子还不识字：提问文本按字可点，点一下读一个字；整句用下面「再读」
                Text(item.q, fontSize = 18.sp, color = BLACK, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(6.dp))
                OutlinedButton(onClick = { viewModel.replayQuestion() }, enabled = !state.ttsBlocked) {
                    Text("🔊 再读")
                }
            }
        }
    }

    // 自动提示卡（6 秒未作答逐级出现）
    if (state.hintTip.isNotBlank() && state.teachStage == TeachStage.QUESTION && state.judge == null) {
        Spacer(Modifier.height(8.dp))
        Card(colors = CardDefaults.cardColors(containerColor = HINT_BG), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                Text("💡 提示（第 ${state.hintLvl} 级）", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = BLACK)
                Spacer(Modifier.height(4.dp))
                Text(state.hintTip, fontSize = 15.sp, color = BLACK)
            }
        }
    }

    // 文本作答区
    if (state.teachStage == TeachStage.QUESTION && state.judge == null && !state.echoOpen) {
        Spacer(Modifier.height(8.dp))
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                OutlinedTextField(
                    value = state.answer,
                    onValueChange = viewModel::onAnswerChange,
                    placeholder = { Text("在这里输入/用输入法语音说出你的回答…") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = viewModel::submitTeachAnswer,
                    enabled = state.answer.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("✅ 回答好了") }
            }
        }
    }
    if (state.teachStage == TeachStage.JUDGING) {
        Spacer(Modifier.height(8.dp))
        Text("🤔 AI 在看你的回答…", color = GRAY_TEXT, fontSize = 14.sp)
    }

    // 判定反馈
    val judge = state.judge
    if (judge != null && !state.echoOpen) {
        Spacer(Modifier.height(8.dp))
        Card(
            colors = CardDefaults.cardColors(containerColor = if (judge.ok) OK_BG else NO_BG),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp)) {
                Text(
                    (if (judge.ok) "✅ " else "") + judge.praise,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (judge.ok) GREEN else RED,
                )
                if (!judge.ok && judge.correct.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("参考回答：", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = BLACK)
                        Spacer(Modifier.weight(1f))
                        OutlinedButton(
                            onClick = { viewModel.replayCorrect() },
                            enabled = !state.ttsBlocked,
                        ) { Text("🔊 再读") }
                    }
                    Text(judge.correct, fontSize = 17.sp, color = BLACK, modifier = Modifier.padding(top = 4.dp))
                    if (!state.echoDone) {
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = viewModel::openTeachEcho,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("🎤 跟读测评这句（≥70 分过关）") }
                    }
                }
            }
        }
    }

    // 跟读测评（答错后出现）
    if (judge != null && !judge.ok && state.echoOpen) {
        Spacer(Modifier.height(8.dp))
        EchoCard(state, viewModel)
    }

    // 过关后下一题
    if (state.showNext && !state.echoOpen) {
        Spacer(Modifier.height(10.dp))
        Button(onClick = viewModel::gotoNextTeach, modifier = Modifier.fillMaxWidth()) {
            Text(if (state.teachIdx + 1 < state.teachTotal) "下一题 →" else "🎉 完成")
        }
    }
}

@Composable
private fun TeachDoneSection(
    viewModel: SpeechComposeViewModel,
    state: SpeechComposeUiState,
    onBack: () -> Unit,
) {
    TopBar(title = "🎉 学完啦", onBack = viewModel::backToSetup)
    Spacer(Modifier.height(12.dp))
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("全部 ${state.teachTotal} 道题都完成了！", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = GREEN)
            Spacer(Modifier.height(8.dp))
            val done = state.units.filter { it in state.covered }
            Text("已练到的内容：${if (done.isEmpty()) "（无）" else done.joinToString("、")}", fontSize = 14.sp, color = BLACK)
            if (state.missingUnits.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "还没覆盖（可再开一轮专门练）：${state.missingUnits.joinToString("、")}",
                    fontSize = 14.sp,
                    color = GRAY_TEXT,
                )
            }
            Spacer(Modifier.height(12.dp))
            Button(onClick = viewModel::backToSetup, modifier = Modifier.fillMaxWidth()) { Text("🔁 再练一轮") }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// 古诗
// ══════════════════════════════════════════════════════════════════

@Composable
private fun PoemSection(
    viewModel: SpeechComposeViewModel,
    state: SpeechComposeUiState,
    onBack: () -> Unit,
) {
    val poem = state.poem ?: return
    TopBar(
        title = "📜 ${poem.title}",
        onBack = viewModel::backToSetup,
        trailing = "第 ${state.poemIdx + 1}/${state.poemTotal} 句",
    )
    if (state.poemDynasty.isNotBlank() || state.poemAuthor.isNotBlank()) {
        Text(
            "${state.poemDynasty}${if (state.poemDynasty.isNotBlank() && state.poemAuthor.isNotBlank()) "·" else ""}${state.poemAuthor}",
            color = GREEN,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
        )
    }
    Spacer(Modifier.height(6.dp))

    // 右侧小圆圈导航（web `SentenceNavRail` 的简化版）：测评过亮起，点圈跳到那句
    PoemNavRail(
        total = state.poemTotal,
        current = state.poemIdx,
        evaluated = state.poemEvaluated,
        enabled = !state.ttsBlocked,
        onJump = viewModel::enterPoemVerse,
    )
    Spacer(Modifier.height(8.dp))

    // 全文：当前句高亮，其它句变淡（点任意字听读音 + 讲意思）
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            poem.lines.forEachIndexed { li, line ->
                val current = li == state.poemIdx
                val bg = if (current) HILITE_BG else Color.Transparent
                androidx.compose.foundation.layout.FlowRow(
                    modifier = Modifier.fillMaxWidth().background(bg, MaterialTheme.shapes.small).padding(2.dp),
                ) {
                    PoemCharFlow(line) { c, m, p -> viewModel.tapPoemChar(c, m, p) }
                }
            }
            Spacer(Modifier.height(6.dp))
            Text("👆 点任意一个字：听读音 + 讲意思", fontSize = 12.sp, color = GRAY_TEXT)
        }
    }

    Spacer(Modifier.height(8.dp))

    // 解释（白话意思 + 点到的字义）
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("📖 解释", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = BLACK)
            val line = state.poemLine
            val meaning = line?.meaning.orEmpty()
            Spacer(Modifier.height(4.dp))
            if (meaning.isNotBlank()) {
                Text(meaning, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = GREEN)
            } else {
                Text("（这句的白话意思还在生成，先跟 AI 读一遍）", fontSize = 14.sp, color = GRAY_TEXT)
            }
            state.charTip?.let { (c, m) ->
                Spacer(Modifier.height(4.dp))
                Text("「$c」：$m", fontSize = 15.sp, color = ORANGE)
            }
            if (state.ttsBusy) {
                Spacer(Modifier.height(4.dp))
                Text("🔊 朗读中…", fontSize = 13.sp, color = GRAY_TEXT)
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = viewModel::speakCurrentPoemVerse,
                    enabled = !state.ttsBlocked,
                ) { Text("🔊 读原文") }
                OutlinedButton(
                    onClick = viewModel::speakCurrentPoemMeaning,
                    enabled = !state.ttsBlocked && !line?.meaning.isNullOrBlank(),
                ) { Text("🔊 读意思") }
                OutlinedButton(
                    onClick = viewModel::speakPoemSummary,
                    enabled = !state.ttsBlocked && poem.summary.isNotBlank(),
                ) { Text("🔊 全诗概括") }
            }
        }
    }

    // 逐句测评：整篇 + 概括读完（poemIntroDone）且不在朗读中才出现
    if (state.poemIntroDone && !state.ttsBusy && state.echoText.isNotBlank()) {
        Spacer(Modifier.height(8.dp))
        EchoCard(state, viewModel)
    }
}

@Composable
private fun PoemDoneSection(
    viewModel: SpeechComposeViewModel,
    state: SpeechComposeUiState,
    onBack: () -> Unit,
) {
    val poem = state.poem ?: return
    TopBar(title = "🎉 古诗学完啦", onBack = viewModel::backToSetup)
    Spacer(Modifier.height(12.dp))
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("《${poem.title}》全部 ${state.poemTotal} 句都读完啦！", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = GREEN)
            if (poem.summary.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(poem.summary, fontSize = 14.sp, color = BLACK)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = viewModel::speakPoemCompletion,
                enabled = !state.ttsBusy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.ttsBusy) "🔊 朗读中…" else "🔊 再听一遍祝贺") }
            Spacer(Modifier.height(8.dp))
            Button(onClick = viewModel::backToSetup, modifier = Modifier.fillMaxWidth()) { Text("🔁 再练一首") }
        }
    }
}

/** 把一句古诗渲染成一串可点的字（标点不可点）；与 web 的逐字拼音/释义索引方式一致 */
@Composable
private fun PoemCharFlow(line: PoemLine, onTapChar: (String, String, String) -> Unit) {
    val pys = remember(line.pinyin) { line.pinyin.trim().split(Regex("\\s+")).filter { it.isNotEmpty() } }
    val chars = remember(line.verse, line.chars, pys) {
        var cjk = 0
        line.verse.map { ch ->
            if (!CJK.matches(ch.toString())) {
                PoemCharCell(ch.toString(), "", "", false)
            } else {
                val info = line.chars.getOrNull(cjk)
                // 逐字拼音兜底：LLM 逐字释义没到时，也能用整句拼音索引到每个字的读音
                val py = info?.p?.takeIf { it.isNotBlank() } ?: pys.getOrNull(cjk).orEmpty()
                cjk++
                PoemCharCell(ch.toString(), info?.m.orEmpty(), py, true)
            }
        }
    }
    chars.forEach { cell ->
        Text(
            text = cell.c,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = BLACK,
            modifier = Modifier
                .then(
                    if (cell.tappable) Modifier.clickable { onTapChar(cell.c, cell.meaning, cell.pinyin) }
                    else Modifier,
                )
                .padding(horizontal = 1.dp, vertical = 1.dp),
        )
    }
}

private data class PoemCharCell(val c: String, val meaning: String, val pinyin: String, val tappable: Boolean)

@Composable
private fun PoemNavRail(
    total: Int,
    current: Int,
    evaluated: Set<Int>,
    enabled: Boolean,
    onJump: (Int) -> Unit,
) {
    if (total <= 0) return
    androidx.compose.foundation.layout.FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        repeat(total) { i ->
            val done = i in evaluated
            val bg = when {
                done -> GREEN
                i == current -> BLUE
                else -> Color(0xFFE2E8F0)
            }
            Text(
                text = "${i + 1}",
                fontSize = 12.sp,
                color = if (done || i == current) Color.White else BLACK,
                modifier = Modifier
                    .size(26.dp)
                    .background(bg, MaterialTheme.shapes.small)
                    .then(if (enabled) Modifier.clickable { onJump(i) } else Modifier)
                    .padding(top = 5.dp),
            )
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// 文章背诵
// ══════════════════════════════════════════════════════════════════

@Composable
private fun ArticleSection(
    viewModel: SpeechComposeViewModel,
    state: SpeechComposeUiState,
    onBack: () -> Unit,
) {
    val article = state.article ?: return
    TopBar(
        title = "📖 文章背诵",
        onBack = viewModel::backToSetup,
        trailing = "第 ${state.artIdx + 1}/${state.artTotal} 句",
    )
    Spacer(Modifier.height(6.dp))

    PoemNavRail(
        total = state.artTotal,
        current = state.artIdx,
        evaluated = state.artEvaluated,
        enabled = !state.ttsBlocked,
        onJump = viewModel::enterArticleSentence,
    )
    Spacer(Modifier.height(8.dp))

    // 全文逐句：当前句高亮，每句下方是 LLM 缩写（背诵框架），右侧喇叭可单独听
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(
                "📚 全文${if (state.shortsLoading) "（正在生成背诵提示…）" else ""}· 点句子可跳到那句",
                fontSize = 13.sp,
                color = GRAY_TEXT,
            )
            Spacer(Modifier.height(4.dp))
            article.forEachIndexed { i, it ->
                val current = i == state.artIdx
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(if (current) HILITE_BG else Color.Transparent, MaterialTheme.shapes.small)
                        .clickable(enabled = !state.ttsBlocked) { viewModel.enterArticleSentence(i) }
                        .padding(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.Top) {
                        Text(
                            it.text,
                            fontSize = 17.sp,
                            fontWeight = if (current) FontWeight.Bold else FontWeight.Normal,
                            color = BLACK,
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedButton(
                            onClick = { viewModel.speakArticleLine(it.text) },
                            enabled = !state.ttsBlocked,
                        ) { Text("🔊") }
                    }
                    when {
                        it.short.isNotBlank() -> Text(
                            "🧠 ${it.short}",
                            fontSize = 13.sp,
                            color = GREEN,
                            fontWeight = FontWeight.SemiBold,
                        )
                        state.shortsLoading && current -> Text("🧠 背诵提示生成中…", fontSize = 12.sp, color = GRAY_TEXT)
                    }
                }
            }
        }
    }

    Spacer(Modifier.height(8.dp))

    // 当前句
    val cur = state.currentArticle
    if (cur != null) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                Text("🎯 这一句", fontSize = 13.sp, color = GRAY_TEXT)
                Spacer(Modifier.height(4.dp))
                Text(cur.text, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = BLACK)
                if (cur.short.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text("🧠 背诵框架：${cur.short}", fontSize = 14.sp, color = GREEN, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { viewModel.speakArticleLine(cur.text) },
                    enabled = !state.ttsBlocked,
                ) { Text("🔊 读这句") }
                if (state.ttsBusy) {
                    Spacer(Modifier.height(4.dp))
                    Text("🔊 朗读中…", fontSize = 13.sp, color = GRAY_TEXT)
                }
            }
        }
    }

    // 跟读测评：AI 领读完成后出现
    if (state.artReady && !state.ttsBusy && state.echoText.isNotBlank()) {
        Spacer(Modifier.height(8.dp))
        EchoCard(state, viewModel)
    }
}

@Composable
private fun ArticleDoneSection(
    viewModel: SpeechComposeViewModel,
    state: SpeechComposeUiState,
    onBack: () -> Unit,
) {
    TopBar(title = "🎉 文章背完啦", onBack = viewModel::backToSetup)
    Spacer(Modifier.height(12.dp))
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("全部 ${state.artTotal} 句都跟读完成！", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = GREEN)
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = viewModel::speakArticleCompletion,
                enabled = !state.ttsBusy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.ttsBusy) "🔊 朗读中…" else "🔊 再听一遍祝贺") }
            Spacer(Modifier.height(8.dp))
            Button(onClick = viewModel::backToSetup, modifier = Modifier.fillMaxWidth()) { Text("🔁 再练一篇") }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// 跟读测评（三个模式共用）
// ══════════════════════════════════════════════════════════════════

/**
 * 跟读测评卡（web `EchoLadder` 的 Android 等价物，单级整句）：
 * 听 AI 领读 → 录音 → 评分 → ≥70 过关自动进入下一步；未过关自动重读一遍。
 */
@Composable
private fun EchoCard(state: SpeechComposeUiState, viewModel: SpeechComposeViewModel) {
    val score = state.echoScore
    val passed = score != null && score >= SpeechComposeViewModel.PASS_SCORE
    Card(colors = CardDefaults.cardColors(containerColor = EVAL_BG), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("🎤 跟读测评", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = BLACK)
            Spacer(Modifier.height(4.dp))
            Text(state.echoText, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = BLACK)
            Spacer(Modifier.height(10.dp))

            when {
                state.recording -> {
                    Text("🔴 正在录音… 读完后点「停止」", fontSize = 15.sp, color = RED)
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = viewModel::stopRecording,
                        colors = ButtonDefaults.buttonColors(containerColor = RED),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("⏹ 停止并评分") }
                }

                state.evaluating -> {
                    Text("正在评测…", fontSize = 15.sp, color = GRAY_TEXT)
                    Spacer(Modifier.height(8.dp))
                    CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                }

                state.echoError.isNotBlank() -> {
                    Text(state.echoError, fontSize = 14.sp, color = RED)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = viewModel::startRecording, modifier = Modifier.fillMaxWidth()) { Text("🎙️ 重新录音") }
                }

                score != null -> {
                    Text(
                        if (passed) "✅ $score 分，过关！" else "⚠️ $score 分，再试一次",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (passed) GREEN else RED,
                    )
                    if (state.echoFeedback.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(state.echoFeedback, fontSize = 14.sp, color = BLACK)
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = viewModel::startRecording, modifier = Modifier.fillMaxWidth()) { Text("🎙️ 重新录音") }
                }

                else -> {
                    Text("先听一遍 AI 读，再点下面按钮跟读（≥70 分过关）", fontSize = 13.sp, color = GRAY_TEXT)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = viewModel::startRecording, modifier = Modifier.fillMaxWidth()) { Text("🎙️ 跟读录音") }
                }
            }

            Spacer(Modifier.height(6.dp))
            Text(
                "跳过这句",
                fontSize = 14.sp,
                color = GRAY_TEXT,
                modifier = Modifier.align(Alignment.CenterHorizontally).clickable(onClick = viewModel::skipEcho),
            )
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// 小部件
// ══════════════════════════════════════════════════════════════════

@Composable
private fun TopBar(title: String, onBack: () -> Unit, trailing: String = "") {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(
            "←",
            style = MaterialTheme.typography.titleLarge,
            color = BLACK,
            modifier = Modifier.padding(end = 8.dp).clickable(onClick = onBack),
        )
        Text(title, style = MaterialTheme.typography.titleLarge, color = BLACK)
        if (trailing.isNotBlank()) {
            Spacer(Modifier.weight(1f))
            Text(trailing, fontSize = 13.sp, color = GRAY_TEXT)
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Spacer(Modifier.height(10.dp))
    Text(text, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = BLACK)
    Spacer(Modifier.height(4.dp))
}

@Composable
private fun TipCard(text: String) {
    Card(colors = CardDefaults.cardColors(containerColor = HINT_BG), modifier = Modifier.fillMaxWidth()) {
        Text(text, fontSize = 13.sp, color = BLACK, modifier = Modifier.padding(12.dp))
    }
}

// ── 语义色（与项目既有约定一致）──
private val BLACK = Color.Black
private val GREEN = Color(0xFF2E7D32)
private val RED = Color(0xFFB71C1C)
private val BLUE = Color(0xFF90CAF9)
private val ORANGE = Color(0xFFE65100)
private val GRAY_TEXT = Color(0xFF536471)

/** 卡片底色 */
private val CHIP_BG = Color(0xFFEFF6FF)
private val HINT_BG = Color(0xFFF1F5F9)
private val BUBBLE_BG = Color(0xFFF8FAFC)
private val EVAL_BG = Color(0xFFF8FAFC)
private val OK_BG = Color(0xFFE8F5E9)
private val NO_BG = Color(0xFFFFEBEE)

/** 当前句高亮（web `#fff8e1`） */
private val HILITE_BG = Color(0xFFFFF8E1)

/** 汉字判定（与 Service 侧 `CJK` 同范围） */
private val CJK = Regex("[\u4e00-\u9fff]")
