package com.example.ai.ui.sentencedoctor

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ai.data.sentencedoctor.SD_PUNCT_KEYS
import com.example.ai.data.sentencedoctor.SD_SLOT_HINT
import com.example.ai.data.sentencedoctor.SdFixCase
import com.example.ai.data.sentencedoctor.SdFixSpot
import com.example.ai.data.sentencedoctor.SdMarkBox
import com.example.ai.data.sentencedoctor.SdMarkRole
import com.example.ai.data.sentencedoctor.SdPunctItem
import com.example.ai.data.sentencedoctor.SdSlotState
import com.example.ai.data.sentencedoctor.SdSpotMark
import com.example.ai.data.sentencedoctor.SdTagPos
import com.example.ai.data.sentencedoctor.SdTool
import com.example.ai.data.sentencedoctor.sdComposeSentence
import com.example.ai.data.sentencedoctor.sdDescribeMark
import com.example.ai.data.sentencedoctor.sdSentencePieces
import com.example.ai.data.sentencedoctor.sdSlotStateOf
import com.example.ai.data.sentencedoctor.sdSpotSolved
import com.example.ai.data.sentencedoctor.sdStripBold
import com.example.ai.data.sentencedoctor.sdTagPartIndexOf
import com.example.ai.data.sentencedoctor.sdTagPositionOf
import com.example.ai.data.tts.BaiduTtsCache

/**
 * 句子小医生 —— 提示语标点 + 修改病句，两册练习合一页（移植自 web `modules/sentence_doctor`）
 *
 * ── 这一页要练的两件事，其实是同一件事 ─────────────────────────────
 * 标点（说话句）和病句（修改符号）在课本里分属两个语文园地，但孩子犯的错是同一个：
 * **把句子当成一串字，而不是一个「有部件、有停顿」的结构**。
 * 所以两册共用同一套动作：**先定位（点出来）→ 再决定（选标点 / 选手术刀）→ 最后讲理由**。
 *
 * ── 三个按钮的分工（刻意不重叠）──────────────────────────────────
 *   🔊 读一读 —— 读**孩子当前填的样子**。标点没填全就会读成一口气憋到底，
 *               「听着别扭」本身就是最直接的反馈；听完再填，比先看答案有用。
 *   ✨ 提  示 —— 只给通关口诀和「该往哪儿看」，不给答案。
 *   👀 看答案 —— 把每空的标点和理由摊开。
 *
 * ── 两个「看得见」的辅助（都要孩子自己点，不自动给）──────────────
 *   🔆 提示语在哪儿 —— 把提示语那一段高亮。「找出谁在说」本来就是这一册要练的那件事，
 *      一直亮着等于把题做了。
 *   ✏️ 画  笔 —— 打开后可以在「订正栏」上随手画。修改符号本来就该手画。
 */
@Composable
internal fun SentenceDoctorScreen(
    viewModel: SentenceDoctorViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // 离开页面时把正在读的中文音掐掉（与其它朗读页一致）
    DisposableEffect(Unit) { onDispose { BaiduTtsCache.stopAll() } }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item("head") { SdHead(state, onBack) }

        item("tabs") { SdTabs(state.mode) { viewModel.selectMode(it) } }

        item("pen") {
            SdPenBar(
                penOn = state.penOn,
                hasStrokes = state.levelHasStrokes,
                onToggle = { viewModel.togglePen() },
                onClear = { viewModel.clearLevelStrokes() },
            )
        }

        item("levels") {
            SdLevelBar(state.levels, state.levelIndex) { viewModel.selectLevel(it) }
        }

        item("rule") {
            SdRuleCard(text = if (state.mode == SdMode.PUNCT) state.punctLevel.rule else sdStripBold(state.fixLevel.intro))
        }

        if (state.mode == SdMode.FIX) {
            item("signs") {
                SdSignsCard(state.signPick) { viewModel.toggleSignPick(it) }
            }
        }

        if (state.mode == SdMode.PUNCT) {
            items(state.punctLevel.items.size, key = { "${state.punctLevel.key}#$it" }) { i ->
                SdPunctCard(
                    item = state.punctLevel.items[i],
                    cardKey = state.cardKey(i),
                    itemState = state.pState(state.cardKey(i), state.punctLevel.items[i].slots.size),
                    done = state.solved.contains(state.cardKey(i)),
                    active = state.active,
                    speaking = state.speaking,
                    penOn = state.penOn,
                    strokes = state.strokesOf(state.cardKey(i)),
                    onSlotClick = { slot -> viewModel.toggleSlot(state.cardKey(i), slot) },
                    onPunct = { ch -> viewModel.appendPunct(state.cardKey(i), state.punctLevel.items[i].slots.size, ch) },
                    onBackspace = { viewModel.backspacePunct(state.cardKey(i), state.punctLevel.items[i].slots.size) },
                    onClearSlot = { viewModel.clearSlotPunct(state.cardKey(i), state.punctLevel.items[i].slots.size) },
                    onClosePalette = { viewModel.closePalette() },
                    onToggleHint = { viewModel.toggleHintPunct(state.cardKey(i), state.punctLevel.items[i].slots.size) },
                    onReveal = { viewModel.revealPunct(state.cardKey(i), state.punctLevel.items[i].slots.size) },
                    onToggleTag = { viewModel.toggleTagOn(state.cardKey(i), state.punctLevel.items[i].slots.size) },
                    onReset = { viewModel.resetPunct(state.cardKey(i), state.punctLevel.items[i].slots.size) },
                    onStrokes = { viewModel.setStrokes(state.cardKey(i), it) },
                    onSpeak = { viewModel.speak(it) },
                )
            }
        } else {
            items(state.fixLevel.items.size, key = { "${state.fixLevel.key}#$it" }) { i ->
                SdFixCard(
                    item = state.fixLevel.items[i],
                    cardKey = state.cardKey(i),
                    levelIntro = sdStripBold(state.fixLevel.intro),
                    itemState = state.fState(state.cardKey(i), state.fixLevel.items[i].spots.size),
                    done = state.solved.contains(state.cardKey(i)),
                    speaking = state.speaking,
                    penOn = state.penOn,
                    strokes = state.strokesOf(state.cardKey(i)),
                    onTool = { si, t -> viewModel.setTool(state.cardKey(i), state.fixLevel.items[i].spots.size, si, t) },
                    onPick = { si, o -> viewModel.setPick(state.cardKey(i), state.fixLevel.items[i].spots.size, si, o) },
                    onToggleHint = { viewModel.toggleHintFix(state.cardKey(i), state.fixLevel.items[i].spots.size) },
                    onReveal = { viewModel.revealFix(state.cardKey(i), state.fixLevel.items[i].spots.size) },
                    onReset = { viewModel.resetFix(state.cardKey(i), state.fixLevel.items[i].spots.size) },
                    onStrokes = { viewModel.setStrokes(state.cardKey(i), it) },
                    onSpeak = { viewModel.speak(it) },
                )
            }
        }

        item("foot") {
            SdFoot(
                allDone = state.allLevelDone,
                levelTotal = state.levelTotal,
                onResetLevel = { viewModel.resetLevel() },
            )
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  色板 / 字号（逐条对齐 web App.css 的 sentence_doctor 段）
// ══════════════════════════════════════════════════════════════════════

private val InkColor = Color(0xFF0F172A)
private val Grey = Color(0xFF64748B)
private val Faint = Color(0xFF94A3B8)
private val MdColor = Color(0xFF2563EB)
private val LevelOn = Color(0xFF1D4ED8)
private val BorderColor = Color(0xFFCBD5E1)
private val CardBorder = Color(0xFFEEF2F7)
private val RedPen = Color(0xFFDC2626)
private val Amber = Color(0xFFF59E0B)

private val SdCardShape = RoundedCornerShape(14.dp)
private val SdPill = RoundedCornerShape(999.dp)
private val SdBoxShape = RoundedCornerShape(3.dp)

private val RuleBg = Color(0xFFFFF7E6)
private val RuleBorder = Color(0xFFF5D79A)
private val RuleText = Color(0xFF7C4A03)
private val DoneBg = Color(0xFFF8FFFB)
private val DoneBorder = Color(0xFF86EFAC)
private val NoBg = Color(0xFFEEF2FF)
private val NoText = Color(0xFF3730A3)
private val BadgeBg = Color(0xFFDCFCE7)
private val BadgeText = Color(0xFF15803D)
private val BadgeTagBg = Color(0xFFFEF3C7)
private val BadgeTagText = Color(0xFF92400E)
private val SlotBg = Color(0xFFF8FAFC)
private val SlotTypingBg = Color(0xFFFFFBEB)
private val SlotTypingText = Color(0xFFB45309)
private val SlotOkBg = Color(0xFFF0FDF4)
private val SlotOkText = Color(0xFF15803D)
private val SlotWrongBg = Color(0xFFFEF2F2)
private val SlotWrongText = Color(0xFFB91C1C)
private val ActBg = Color(0xFFF1F5F9)
private val ActBorder = Color(0xFFDBE3EE)
private val ActOnBg = Color(0xFFFEF3C7)
private val ActOnBorder = Color(0xFFF0D68A)
private val PopBg = Color(0xFFEEF2FF)
private val PopBorder = Color(0xFFC7D2FE)
private val PopTagBg = Color(0xFF4F46E5)
private val PopMainText = Color(0xFF312E81)
private val PopListText = Color(0xFF3730A3)
private val PanelBg = Color(0xFFF8FAFC)
private val AnswerBg = Color(0xFFFBFDFF)
private val AnswerBorder = Color(0xFFE2E8F0)
private val WhyAText = Color(0xFF3730A3)
private val WhyABg = Color(0xFFE0E7FF)
private val CaseBg = Color(0xFFFFFBFB)
private val SpotBorder = Color(0xFFE8EEF6)
private val SpotOkBorder = Color(0xFF86EFAC)
private val SpotOkBg = Color(0xFFF6FEF9)
private val ToolOnBg = Color(0xFFEEF2FF)
private val ToolOnText = Color(0xFF1D4ED8)
private val BadBorder = Color(0xFFEF4444)
private val BadBg = Color(0xFFFEF2F2)
private val BadText = Color(0xFFB91C1C)
private val FixedText = Color(0xFF14532D)
private val TagPartBg = Color(0xFFFEF9C3)

// ══════════════════════════════════════════════════════════════════════
//  顶部 / 切换 / 关卡条 / 口诀
// ══════════════════════════════════════════════════════════════════════

@Composable
private fun SdHead(state: SentenceDoctorUiState, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .width(40.dp)
                .clickableNoRipple(onClick = onBack),
        ) {
            Text("←", fontSize = 20.sp, color = InkColor)
        }
        Text("句子小医生", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = InkColor)
        Spacer(Modifier.width(8.dp))
        Text(
            "${state.levelDone}/${state.levelTotal}",
            fontSize = 13.sp,
            color = Grey,
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.End,
        )
    }
    Text(
        "标点和病句练的是同一件事：先找出句子的部件，再下笔。",
        fontSize = 12.5.sp,
        color = Grey,
        modifier = Modifier.padding(top = 4.dp),
    )
}

@Composable
private fun SdTabs(mode: SdMode, onPick: (SdMode) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SdTab("🎩 标点的幻术", mode == SdMode.PUNCT, Modifier.weight(1f)) { onPick(SdMode.PUNCT) }
        SdTab("🩺 病句门诊", mode == SdMode.FIX, Modifier.weight(1f)) { onPick(SdMode.FIX) }
    }
}

@Composable
private fun SdTab(text: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Text(
        text = text,
        fontSize = 14.sp,
        fontWeight = FontWeight.Bold,
        color = if (on) Color.White else Color(0xFF334155),
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (on) MdColor else Color(0xFFE2E8F0))
            .border(1.dp, if (on) MdColor else BorderColor, RoundedCornerShape(12.dp))
            .clickableNoRipple(onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 8.dp),
    )
}

@Composable
private fun SdPenBar(penOn: Boolean, hasStrokes: Boolean, onToggle: () -> Unit, onClear: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = if (penOn) "✏️ 画笔：开" else "✏️ 画笔",
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = if (penOn) Color.White else Color(0xFF334155),
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(if (penOn) RedPen else Color(0xFFE2E8F0))
                .border(1.dp, if (penOn) RedPen else BorderColor, RoundedCornerShape(10.dp))
                .clickableNoRipple(onClick = onToggle)
                .padding(vertical = 7.dp, horizontal = 12.dp),
        )
        if (penOn && hasStrokes) {
            SdMini("🧽 清空笔迹", onClear)
        }
        Text(
            text = if (penOn) "在「订正栏」上随手画；标点牌先点不动 —— 再按一下关掉" else "想自己动手画修改符号？打开画笔",
            fontSize = 11.5.sp,
            color = Faint,
            modifier = Modifier.weight(1f),
        )
    }
}

/** 关卡条：**窄屏折行**，每一关都看得见（web 2026-10-14 的同一处修正） */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SdLevelBar(levels: List<Pair<String, String>>, current: Int, onPick: (Int) -> Unit) {
    FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        levels.forEachIndexed { i, (_, name) ->
            val on = i == current
            Text(
                text = name,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = if (on) Color.White else Color(0xFF475569),
                maxLines = 1,
                modifier = Modifier
                    .clip(SdPill)
                    .background(if (on) LevelOn else Color.White)
                    .border(1.dp, if (on) LevelOn else Color(0xFFD7DEE8), SdPill)
                    .clickableNoRipple { onPick(i) }
                    .padding(vertical = 7.dp, horizontal = 12.dp),
            )
        }
    }
}

@Composable
private fun SdRuleCard(text: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(RuleBg)
            .border(1.dp, RuleBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            "通关口诀",
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White,
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(Amber)
                .padding(horizontal = 7.dp, vertical = 1.dp),
        )
        Text(text, fontSize = 13.sp, color = RuleText, lineHeight = 21.sp)
    }
}

/** 病句门诊顶部：五个修改符号（课本一共就教这五个） */
@Composable
private fun SdSignsCard(picked: SdTool?, onPick: (SdTool) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PanelBg)
            .border(1.dp, AnswerBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "五个修改符号",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(Amber)
                    .padding(horizontal = 7.dp, vertical = 1.dp),
            )
            Text("课本一共就教这五个，点一下看怎么用", fontSize = 12.sp, color = Grey)
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SdTool.entries.forEach { t ->
                val on = picked == t
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (on) BadBg else Color.White)
                        .border(1.dp, if (on) RedPen else AnswerBorder, RoundedCornerShape(10.dp))
                        .clickableNoRipple { onPick(t) }
                        .padding(vertical = 4.dp, horizontal = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    SdSignCanvas(t)
                    Text("${t.label}号", fontSize = 11.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFF475569))
                }
            }
        }
        if (picked != null) {
            Spacer(Modifier.height(8.dp))
            Row {
                Text("${picked.label}号", fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = RedPen)
                Text("　${picked.whenTo} 时用它。", fontSize = 12.5.sp, color = Color(0xFF334155))
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  标点册的题卡
// ══════════════════════════════════════════════════════════════════════

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SdPunctCard(
    item: SdPunctItem,
    cardKey: String,
    itemState: SdPunctItemState,
    done: Boolean,
    active: Pair<String, Int>?,
    speaking: Boolean,
    penOn: Boolean,
    strokes: List<SdStroke>,
    onSlotClick: (Int) -> Unit,
    onPunct: (String) -> Unit,
    onBackspace: () -> Unit,
    onClearSlot: () -> Unit,
    onClosePalette: () -> Unit,
    onToggleHint: () -> Unit,
    onReveal: () -> Unit,
    onToggleTag: () -> Unit,
    onReset: () -> Unit,
    onStrokes: (List<SdStroke>) -> Unit,
    onSpeak: (String) -> Unit,
) {
    val tagIdx = remember(item) { sdTagPartIndexOf(item) }
    val tagPos: SdTagPos? = remember(item) { sdTagPositionOf(item) }
    val paletteOpen = active?.first == cardKey

    SdCard(done = done) {
        SdCardHead(
            no = itemIndexLabel(cardKey),
            badges = buildList {
                if (done) add("✓ 全对" to false)
                if (itemState.tagOn && tagPos != null) add(tagPos.label to true)
            },
        ) {
            SdTagButton(on = itemState.tagOn, onClick = onToggleTag)
        }

        SdPaper(penOn = penOn, strokes = strokes, onStrokes = onStrokes) {
            FlowRow(
                Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                item.slots.forEachIndexed { si, slot ->
                    if (slot != null) {
                        val st = sdSlotStateOf(itemState.vals.getOrElse(si) { "" }, slot)
                        SdSlotBox(
                            state = st,
                            text = itemState.vals.getOrElse(si) { "" }.ifEmpty { "?" },
                            active = active?.first == cardKey && active.second == si,
                            onClick = { onSlotClick(si) },
                        )
                    }
                    if (si < item.parts.size) {
                        if (itemState.tagOn && si == tagIdx) {
                            SdTagPart(item.parts[si])
                        } else {
                            Text(item.parts[si], fontSize = 17.sp, color = Color(0xFF111827))
                        }
                    }
                }
            }
        }

        SdActionRow(
            speaking = speaking,
            hintOn = itemState.hint,
            onRead = { onSpeak(sdComposeSentence(item, itemState.vals)) },
            onHint = onToggleHint,
            onReveal = onReveal,
            onReset = onReset,
        )

        if (itemState.hint) {
            SdPop {
                Text("看这儿", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(PopTagBg).padding(horizontal = 8.dp, vertical = 1.dp))
                Spacer(Modifier.height(6.dp))
                Text(item.tip, fontSize = 13.5.sp, color = PopMainText, lineHeight = 23.sp)
                Spacer(Modifier.height(8.dp))
                item.slots.forEachIndexed { si, s ->
                    if (s != null) {
                        Text(
                            "• 第 ${si + 1} 空：${SD_SLOT_HINT[s.kind].orEmpty()}",
                            fontSize = 13.sp,
                            color = PopListText,
                            lineHeight = 23.sp,
                        )
                    }
                }
            }
        }

        if (paletteOpen) {
            SdPalette(
                onPunct = onPunct,
                onBackspace = onBackspace,
                onClearSlot = onClearSlot,
                onClose = onClosePalette,
            )
        }

        if (itemState.revealed) {
            SdAnswer(
                title = if (done) "答案对了，理由再顺一遍" else "对照一下",
                actionText = "🔊 读标准答案",
                actionEnabled = !speaking,
                onAction = { onSpeak(sdComposeSentence(item, item.slots.map { it?.a ?: "" })) },
            ) {
                item.slots.forEachIndexed { si, s ->
                    if (s != null) {
                        Row(Modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.Top) {
                            Text(
                                s.a,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = WhyAText,
                                textAlign = TextAlign.Center,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(WhyABg)
                                    .padding(horizontal = 6.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(s.why, fontSize = 13.sp, color = Color(0xFF334155), lineHeight = 22.sp)
                        }
                    }
                }
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  病句册的题卡
// ══════════════════════════════════════════════════════════════════════

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SdFixCard(
    item: SdFixCase,
    cardKey: String,
    /** 本关说明（去掉 markdown 粗体标记）—— ✨ 提示里「这一段要用的刀」那一行 */
    levelIntro: String,
    itemState: SdFixItemState,
    done: Boolean,
    speaking: Boolean,
    penOn: Boolean,
    strokes: List<SdStroke>,
    onTool: (Int, SdTool) -> Unit,
    onPick: (Int, Int) -> Unit,
    onToggleHint: () -> Unit,
    onReveal: () -> Unit,
    onReset: () -> Unit,
    onStrokes: (List<SdStroke>) -> Unit,
    onSpeak: (String) -> Unit,
) {
    // 只有「诊断对了」或「已看答案」的病灶才画到原句上
    val marked = item.spots.filterIndexed { si, spot ->
        sdSpotSolved(spot, itemState.tools.getOrNull(si), itemState.picks.getOrElse(si) { -1 }) || itemState.revealed
    }
    val marks: List<Pair<SdTool, SdSpotMark>> = remember(marked) { marked.map { it.tool to it.mark } }

    SdCard(done = done) {
        SdCardHead(
            no = itemIndexLabel(cardKey),
            badges = buildList {
                if (done) add("✓ 全都治好了" to false)
                if (!done && marked.isNotEmpty()) add("已标出 ${marked.size}/${item.spots.size} 处" to true)
            },
        )

        SdPaper(wide = true, penOn = penOn, strokes = strokes, onStrokes = onStrokes) {
            Text(
                "订正栏",
                fontSize = 11.sp,
                color = Color(0xFFF0A5A5),
                modifier = Modifier.align(Alignment.TopEnd),
            )
            SdMarkedSentence(item.text, marks)
        }

        SdActionRow(
            speaking = speaking,
            hintOn = itemState.hint,
            onRead = { onSpeak(item.text) },
            onHint = onToggleHint,
            onReveal = onReveal,
            onReset = onReset,
        )

        if (itemState.hint) {
            SdPop {
                Text("看这儿", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(PopTagBg).padding(horizontal = 8.dp, vertical = 1.dp))
                Spacer(Modifier.height(6.dp))
                Text(
                    "小声读两遍，读不通的地方就是病处。再问自己三句话：" +
                        "① 这个词跟旁边的话搭得上吗？② 谁、做了什么、对谁做，齐了吗？③ 有没有说了两遍或前后打架？",
                    fontSize = 13.5.sp,
                    color = PopMainText,
                    lineHeight = 23.sp,
                )
                Spacer(Modifier.height(8.dp))
                Text("• 这一段要用的刀：$levelIntro", fontSize = 13.sp, color = PopListText, lineHeight = 23.sp)
                if (item.spots.size > 1) {
                    Text("• 这句有 ${item.spots.size} 处病，一处一处来。", fontSize = 13.sp, color = PopListText, lineHeight = 23.sp)
                }
                Text("• 改完再把整句读一遍——顺了才算治好。", fontSize = 13.sp, color = PopListText, lineHeight = 23.sp)
            }
        }

        item.spots.forEachIndexed { si, spot ->
            val tool = itemState.tools.getOrNull(si)
            val pick = itemState.picks.getOrElse(si) { -1 }
            val ok = sdSpotSolved(spot, tool, pick)
            SdSpot(
                spot = spot,
                index = si,
                spotCount = item.spots.size,
                tool = tool,
                pick = pick,
                ok = ok,
                showWhy = ok || itemState.revealed,
                onTool = { onTool(si, it) },
                onPick = { onPick(si, it) },
            )
        }

        if (done || itemState.revealed) {
            SdAnswer(
                title = "订正后（参考答案）",
                actionText = "🔊 读一读",
                actionEnabled = !speaking,
                onAction = { onSpeak(item.fixed) },
            ) {
                Text(item.fixed, fontSize = 15.sp, color = FixedText, lineHeight = 28.sp)
            }
        }
    }
}

/** 提示里那句「这一段要用的刀」——本关的 intro 由卡片参数传入 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SdSpot(
    spot: SdFixSpot,
    index: Int,
    spotCount: Int,
    tool: SdTool?,
    pick: Int,
    ok: Boolean,
    showWhy: Boolean,
    onTool: (SdTool) -> Unit,
    onPick: (Int) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 12.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (ok) SpotOkBg else AnswerBg)
            .border(1.dp, if (ok) SpotOkBorder else SpotBorder, RoundedCornerShape(12.dp))
            .padding(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (spotCount > 1) "第 ${index + 1} 处" else "选刀，再找出病处",
                fontSize = 12.5.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color(0xFF475569),
            )
            if (ok) {
                Text(
                    "✓ 治好 · 已画到原句上",
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = BadgeText,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.End,
                )
            }
        }
        Spacer(Modifier.height(8.dp))

        // 五把手术刀：上下排（符号在上、名字在下），一行放不下时宁可折行
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            maxItemsInEachRow = 5,
        ) {
            SdTool.entries.forEach { t ->
                val picked = tool == t
                val bad = picked && t != spot.tool
                Column(
                    modifier = Modifier
                        .weight(1f, fill = true)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (bad) BadBg else if (picked) ToolOnBg else Color.White)
                        .border(
                            1.dp,
                            if (bad) BadBorder else if (picked) MdColor else ActBorder,
                            RoundedCornerShape(10.dp),
                        )
                        .clickableNoRipple { onTool(t) }
                        .padding(vertical = 5.dp, horizontal = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    SdSignCanvas(t)
                    Text(
                        "${t.label}刀",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (bad) BadText else if (picked) ToolOnText else Color(0xFF334155),
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        spot.options.forEachIndexed { oi, option ->
            val picked = pick == oi
            val right = picked && oi == spot.answer
            Text(
                text = option,
                fontSize = 13.5.sp,
                fontWeight = if (right || (picked && !right)) FontWeight.Bold else FontWeight.Normal,
                color = when {
                    right -> ToolOnText
                    picked -> Color(0xFF991B1B)
                    else -> Color(0xFF1F2937)
                },
                lineHeight = 22.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (right) ToolOnBg else if (picked) BadBg else Color.White)
                    .border(
                        1.dp,
                        if (right) MdColor else if (picked) BadBorder else ActBorder,
                        RoundedCornerShape(10.dp),
                    )
                    .clickableNoRipple { onPick(oi) }
                    .padding(horizontal = 11.dp, vertical = 9.dp),
            )
        }

        if (showWhy) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(PopBg)
                    .border(1.dp, PopBorder, RoundedCornerShape(10.dp))
                    .padding(horizontal = 11.dp, vertical = 9.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("正确操作", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = PopMainText)
                    Text(
                        "${spot.tool.label}手术刀",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(PopTagBg).padding(horizontal = 8.dp, vertical = 1.dp),
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(spot.options[spot.answer], fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1E1B4B), lineHeight = 22.sp)
                Text(
                    "✍️ ${sdDescribeMark(spot)}",
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = BadText,
                    lineHeight = 22.sp,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
                Text(spot.why, fontSize = 13.sp, color = Color(0xFF475569), lineHeight = 22.sp)
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  卡片外壳 / 操作行 / 提示 / 标点牌 / 答案
// ══════════════════════════════════════════════════════════════════════

private fun itemIndexLabel(cardKey: String): String = (cardKey.substringAfterLast(':').toIntOrNull()?.plus(1) ?: 1).toString()

@Composable
private fun SdCard(done: Boolean, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(SdCardShape)
            .background(if (done) DoneBg else Color.White)
            .border(1.dp, if (done) DoneBorder else CardBorder, SdCardShape)
            .padding(14.dp),
        content = content,
    )
}

@Composable
private fun SdCardHead(
    no: String,
    badges: List<Pair<String, Boolean>>,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(24.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(NoBg),
            contentAlignment = Alignment.Center,
        ) {
            Text(no, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = NoText)
        }
        Row(
            Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            badges.forEach { (text, isTag) ->
                Text(
                    text,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (isTag) BadgeTagText else BadgeText,
                    modifier = Modifier
                        .clip(SdPill)
                        .background(if (isTag) BadgeTagBg else BadgeBg)
                        .padding(horizontal = 10.dp, vertical = 2.dp),
                )
            }
            trailing?.invoke()
        }
    }
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun SdTagButton(on: Boolean, onClick: () -> Unit) {
    Text(
        "🔆 提示语在哪儿",
        fontSize = 12.sp,
        fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
        color = if (on) BadgeTagText else Grey,
        maxLines = 1,
        modifier = Modifier
            .clip(SdPill)
            .background(if (on) BadgeTagBg else Color.White)
            .then(if (on) Modifier.border(1.dp, Amber, SdPill) else Modifier.dashedBorder(BorderColor, 1.dp, 999.dp))
            .clickableNoRipple(onClick = onClick)
            .padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

@Composable
private fun SdActionRow(
    speaking: Boolean,
    hintOn: Boolean,
    onRead: () -> Unit,
    onHint: () -> Unit,
    onReveal: () -> Unit,
    onReset: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        SdAct("🔊 读一读", Modifier.weight(1f), enabled = !speaking, onClick = onRead)
        SdAct("✨ 提示", Modifier.weight(1f), on = hintOn, onClick = onHint)
        SdAct("👀 看答案", Modifier.weight(1f), onClick = onReveal)
        SdAct("↺ 重来", Modifier.weight(1f), ghost = true, onClick = onReset)
    }
}

@Composable
private fun SdAct(
    text: String,
    modifier: Modifier = Modifier,
    on: Boolean = false,
    ghost: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (!enabled) Faint else if (ghost) Grey else Color(0xFF1F2937),
        textAlign = TextAlign.Center,
        maxLines = 1,
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (on) ActOnBg else if (ghost) Color.White else ActBg)
            .border(1.dp, if (on) ActOnBorder else ActBorder, RoundedCornerShape(10.dp))
            .clickableNoRipple(enabled = enabled, onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 4.dp),
    )
}

@Composable
private fun SdPop(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(PopBg)
            .border(1.dp, PopBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        content = content,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SdPalette(
    onPunct: (String) -> Unit,
    onBackspace: () -> Unit,
    onClearSlot: () -> Unit,
    onClose: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(PanelBg)
            .border(1.dp, ActBorder, RoundedCornerShape(12.dp))
            .padding(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "选标点 —— 可以连点两个（比如冒号 + 前引号）",
                fontSize = 12.5.sp,
                color = Color(0xFF475569),
                modifier = Modifier.weight(1f),
            )
            SdMini("收起", onClose)
        }
        Spacer(Modifier.height(8.dp))
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SD_PUNCT_KEYS.forEach { k ->
                Column(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color.White)
                        .border(1.dp, BorderColor, RoundedCornerShape(10.dp))
                        .clickableNoRipple { onPunct(k.c) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(k.c, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = InkColor)
                    Text(k.label, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, color = Grey)
                }
            }
            Column(
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFEEF2F7))
                    .border(1.dp, BorderColor, RoundedCornerShape(10.dp))
                    .clickableNoRipple(onClick = onBackspace)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("⌫", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = InkColor)
                Text("退一格", fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, color = Grey)
            }
            Column(
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFEEF2F7))
                    .border(1.dp, BorderColor, RoundedCornerShape(10.dp))
                    .clickableNoRipple(onClick = onClearSlot)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("␡", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = InkColor)
                Text("清空这空", fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, color = Grey)
            }
        }
    }
}

@Composable
private fun SdMini(text: String, onClick: () -> Unit) {
    Text(
        text,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.Bold,
        color = Color(0xFF334155),
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFFD1D5DB), RoundedCornerShape(8.dp))
            .clickableNoRipple(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun SdAnswer(
    title: String,
    actionText: String,
    actionEnabled: Boolean,
    onAction: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(AnswerBg)
            .border(1.dp, AnswerBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFF334155), modifier = Modifier.weight(1f))
            SdMiniAct(actionText, actionEnabled, onAction)
        }
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
private fun SdMiniAct(text: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        text,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.Bold,
        color = if (enabled) Color(0xFF334155) else Faint,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFFD1D5DB), RoundedCornerShape(8.dp))
            .clickableNoRipple(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun SdFoot(allDone: Boolean, levelTotal: Int, onResetLevel: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        SdAct("↺ 这一关重做", Modifier.fillMaxWidth(), onClick = onResetLevel)
        if (allDone && levelTotal > 0) {
            Text(
                "这一关全做完了，试试下一关 👆",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = MdColor,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            )
        }
        Text(
            "标点题有标准答案；病句题的改法不止一种，这里判的是「有没有找到那一处」，" +
                "订正句仅供参考，以老师讲评为准。红笔标记画的是参考改法，" +
                "自己用画笔画的算数——两种画法对得上，才算真会了。",
            fontSize = 12.5.sp,
            color = Grey,
            lineHeight = 22.sp,
            modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            "内容整理自廖敏老师自制练习册《提示语及修改病句专项练习》",
            fontSize = 12.sp,
            color = Faint,
            modifier = Modifier.padding(top = 6.dp, bottom = 24.dp),
        )
    }
}

// ══════════════════════════════════════════════════════════════════════
//  订正栏：原句 + 红笔标记 + 画笔层
// ══════════════════════════════════════════════════════════════════════

/**
 * 订正栏。
 *
 * 三样东西叠在同一个 Box 上：① 原句（折行正常排）② 红笔标记（贴在被框的字上，往上「长」引线/方框）
 * ③ 画笔层（铺满整个订正栏，关着时不挡答题）。
 *
 * ★ 上方**固定留白**：修改符号本来就写在字上面／旁边的空白里，不留白就只能压在字上。
 *   病句那边留得更多（要放订正的字），行距也更大 —— 不然第 2 行上的框会盖住第 1 行的字。
 */
@Composable
private fun SdPaper(
    penOn: Boolean,
    strokes: List<SdStroke>,
    onStrokes: (List<SdStroke>) -> Unit,
    wide: Boolean = false,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(top = if (wide) 34.dp else 24.dp, bottom = 10.dp)
            .drawBehind {
                drawRect(color = Color(0xFFFCA5A5), size = Size(3.dp.toPx(), size.height))
                drawRect(color = CaseBg, topLeft = Offset(3.dp.toPx(), 0f), size = Size(size.width - 3.dp.toPx(), size.height))
            }
            .padding(horizontal = 10.dp),
    ) {
        content()
        SdPenOverlay(penOn = penOn, strokes = strokes, onStrokes = onStrokes)
    }
}

/**
 * 画笔层。坐标**按容器尺寸归一化**存，所以横竖屏切换、字号变化都不会让笔迹跑偏。
 *
 * ★ 关着时**不装** pointerInput（而不是装一个 `enabled=false` 的）—— 装了就会把手指事件吃掉，
 *   孩子没法滚页面（web 侧对应 `.sd-pen { pointer-events: none }`）。
 */
@Composable
private fun BoxScope.SdPenOverlay(penOn: Boolean, strokes: List<SdStroke>, onStrokes: (List<SdStroke>) -> Unit) {
    var live by remember { mutableStateOf<List<Pair<Float, Float>>>(emptyList()) }
    val latestStrokes by rememberUpdatedState(strokes)
    val latestCommit by rememberUpdatedState(onStrokes)

    val handler = if (!penOn) {
        Modifier
    } else {
        // ★ key 用固定字符串：绝不能带「每帧变化的值」，否则拖一下就重启手势检测器（表现为「拖不动」）
        Modifier.pointerInput("sd-pen") {
            detectDragGestures(
                onDragStart = { off ->
                    live = listOf(off.x / size.width.coerceAtLeast(1) to off.y / size.height.coerceAtLeast(1))
                },
                onDrag = { change, _ ->
                    val st = live
                    live = st + (change.position.x / size.width.coerceAtLeast(1) to change.position.y / size.height.coerceAtLeast(1))
                },
                onDragEnd = {
                    val pts = live
                    live = emptyList()
                    if (pts.size > 1) latestCommit(latestStrokes + SdStroke(pts))
                },
                onDragCancel = { live = emptyList() },
            )
        }
    }

    Canvas(Modifier.matchParentSize().then(handler)) {
        val all = if (live.isEmpty()) strokes else strokes + SdStroke(live)
        for (stroke in all) {
            if (stroke.points.size < 2) continue
            val path = Path()
            stroke.points.forEachIndexed { i, (x, y) ->
                val px = x * size.width
                val py = y * size.height
                if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
            }
            drawPath(
                path = path,
                color = RedPen,
                style = Stroke(width = 2.4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  原句上的红笔标记
// ══════════════════════════════════════════════════════════════════════

/** 装饰区高度：够放「方框 + 引线 + 订正的字」那一摞 */
private val MarkDecoHeight = 46.dp

/**
 * 把原句按病灶切成「红笔标记 + 普通文字」交错的一串。
 *
 * 每处标记都紧贴在**它框住的那几个字**上（上面留出的装饰区就是引线/方框/藤的位置），
 * 所以句子折行也不会画歪。代价与 web 一样：**跨行的长引线画不出来**
 * ⇒「对调」「移动」用 ① ② 编号配对，而不是硬拉一条穿过好几行的线。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SdMarkedSentence(text: String, marks: List<Pair<SdTool, SdSpotMark>>) {
    val pieces = remember(text, marks) { sdSentencePieces(text, marks) }
    FlowRow(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        pieces.forEach { piece ->
            val box = piece.box
            if (box == null) {
                Text(piece.text, fontSize = 15.5.sp, color = Color(0xFF1F2937), lineHeight = 26.sp)
            } else {
                SdMarkedToken(piece.text, box)
            }
        }
    }
}

@Composable
private fun SdMarkedToken(inner: String, box: SdMarkBox) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.height(MarkDecoHeight), contentAlignment = Alignment.BottomCenter) {
            when {
                // 改正 / 增补（框住 + 引线牵到订正栏写字）
                (box.tool == SdTool.CORRECT || box.tool == SdTool.ADD) && box.role == SdMarkRole.CUT -> {
                    Row(verticalAlignment = Alignment.Bottom) {
                        SdLeadLine()
                        SdPutBox(box.put.orEmpty(), alignLeft = false)
                    }
                }
                // 删除：右上一条藤，藤上两个小环
                box.tool == SdTool.DELETE && box.role == SdMarkRole.CUT -> SdVineLine()
                // 增补（纯插入）：方框挂在分叉上方，分叉的尖落在插入点上
                box.tool == SdTool.ADD && box.role == SdMarkRole.AT -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        SdPutBox(box.put.orEmpty(), alignLeft = true)
                        SdForkLine()
                    }
                }
                // 对调：架在两个紧挨的框中间的那条折线（骑在交界处）
                box.tool == SdTool.SWAP && box.role == SdMarkRole.CUT -> {
                    Box(Modifier.height(MarkDecoHeight), contentAlignment = Alignment.BottomEnd) { SdCrenelLine() }
                }
                // 移动：源处挂 ①
                box.tool == SdTool.MOVE && box.role == SdMarkRole.CUT -> SdChip("①")
                // 移动：目标处「人」形分叉 + ②
                box.tool == SdTool.MOVE && box.role == SdMarkRole.WITH -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        SdChip("②")
                        SdForkLine()
                    }
                }
                else -> Unit
            }
        }
        if (inner.isEmpty()) {
            // 零宽插入点：只留一个很窄的占位，让分叉正好落在两个字之间
            Box(Modifier.width(2.dp).height(20.dp))
        } else {
            Text(
                text = inner,
                fontSize = 15.5.sp,
                color = Color(0xFF1F2937),
                lineHeight = 26.sp,
                modifier = if (box.boxed) {
                    Modifier
                        .padding(horizontal = 1.dp)
                        .clip(SdBoxShape)
                        .border(1.5.dp, RedPen, SdBoxShape)
                        .padding(horizontal = 2.dp)
                } else {
                    Modifier
                },
            )
        }
    }
}

@Composable
private fun SdPutBox(text: String, alignLeft: Boolean) {
    if (text.isEmpty()) return
    Text(
        text,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.Bold,
        color = BadText,
        maxLines = 1,
        modifier = Modifier
            .clip(SdBoxShape)
            .background(Color.White)
            .border(1.5.dp, RedPen, SdBoxShape)
            .padding(horizontal = 5.dp, vertical = 1.dp)
            .then(if (alignLeft) Modifier else Modifier.padding(start = 16.dp)),
    )
}

@Composable
private fun SdChip(text: String) {
    Text(
        text,
        fontSize = 10.sp,
        color = Color.White,
        modifier = Modifier
            .clip(SdPill)
            .background(RedPen)
            .padding(horizontal = 5.dp),
    )
}

/** 改正的引线：从左下到右上 */
@Composable
private fun SdLeadLine() = Canvas(Modifier.size(width = 24.dp, height = 13.dp)) {
    drawLine(RedPen, Offset(1f, size.height - 1f), Offset(size.width - 1f, 1f), 1.4.dp.toPx(), StrokeCap.Round)
}

/** 删除的藤：一段上凸弧 + 两个小环 */
@Composable
private fun SdVineLine() = Canvas(Modifier.size(width = 30.dp, height = 13.dp)) {
    val path = Path()
    path.moveTo(1f, size.height - 1f)
    path.quadraticTo(size.width * 0.47f, 1f, size.width - 1f, 1f)
    drawPath(path, RedPen, style = Stroke(1.4.dp.toPx(), cap = StrokeCap.Round))
    drawCircle(RedPen, 2.dp.toPx(), Offset(size.width * 0.43f, size.height * 0.45f), style = Stroke(1.4.dp.toPx()))
    drawCircle(RedPen, 2.dp.toPx(), Offset(size.width * 0.72f, size.height * 0.24f), style = Stroke(1.4.dp.toPx()))
}

/** 插入点的「人」形分叉：竖线 + 尖朝下的分叉，尖落在插入点上 */
@Composable
private fun SdForkLine() = Canvas(Modifier.size(width = 14.dp, height = 19.dp)) {
    drawLine(RedPen, Offset(size.width / 2f, 0f), Offset(size.width / 2f, size.height * 0.64f), 1.4.dp.toPx(), StrokeCap.Round)
    val path = Path()
    path.moveTo(1f, size.height - 1f)
    path.lineTo(size.width / 2f, size.height * 0.64f)
    path.lineTo(size.width - 1f, size.height - 1f)
    drawPath(path, RedPen, style = Stroke(1.4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
}

/** 对调的折线：两节城垛（下—右—上—右—下） */
@Composable
private fun SdCrenelLine() = Canvas(Modifier.size(width = 30.dp, height = 22.dp)) {
    val kx = size.width / 30f
    val ky = size.height / 22f
    val path = Path()
    path.moveTo(2f * kx, 2f * ky)
    path.lineTo(2f * kx, 19f * ky)
    path.lineTo(14f * kx, 19f * ky)
    path.lineTo(14f * kx, 2f * ky)
    path.lineTo(26f * kx, 2f * ky)
    path.lineTo(26f * kx, 19f * ky)
    drawPath(path, RedPen, style = Stroke(1.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
}

// ══════════════════════════════════════════════════════════════════════
//  五个修改符号的图标（方框 + 引线，按课本范例，不是网上流传的「圆圈版」）
// ══════════════════════════════════════════════════════════════════════

@Composable
private fun SdSignCanvas(tool: SdTool, modifier: Modifier = Modifier.size(width = 40.dp, height = 27.dp)) {
    Canvas(modifier) {
        val kx = size.width / 44f
        val ky = size.height / 30f
        val w = 1.6f * minOf(kx, ky)
        val stroke = Stroke(width = w, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun o(x: Float, y: Float) = Offset(x * kx, y * ky)
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) =
            drawLine(RedPen, o(x1, y1), o(x2, y2), w, StrokeCap.Round)

        fun rect(x: Float, y: Float, ww: Float, hh: Float) = drawRoundRect(
            color = RedPen,
            topLeft = o(x, y),
            size = Size(ww * kx, hh * ky),
            cornerRadius = CornerRadius(2f * kx, 2f * ky),
            style = stroke,
        )

        fun poly(vararg pts: Float) {
            val path = Path()
            path.moveTo(pts[0] * kx, pts[1] * ky)
            var i = 2
            while (i + 1 < pts.size) {
                path.lineTo(pts[i] * kx, pts[i + 1] * ky)
                i += 2
            }
            drawPath(path, RedPen, style = stroke)
        }

        when (tool) {
            // 改正 = 左下小方框（错的）+ 引线 + 右上方框（对的）
            SdTool.CORRECT -> {
                rect(1.5f, 16.5f, 16f, 11f)
                rect(26.5f, 3.5f, 16f, 12f)
                line(17.5f, 17.5f, 26.5f, 10f)
            }
            // 增补 = 方框（要补的字）+ 横平线 → 竖下 → 末端「人」形小分叉（插入点）
            SdTool.ADD -> {
                rect(27.5f, 1.5f, 15f, 10f)
                poly(27.5f, 6.5f, 12f, 6.5f, 12f, 17f)
                poly(8f, 22.5f, 12f, 17f, 16f, 21.5f)
            }
            // 删除 = 方框（要删的）+ 右上一条藤，藤上两个小环
            SdTool.DELETE -> {
                rect(1.5f, 14.5f, 18f, 12f)
                val path = Path()
                path.moveTo(19.5f * kx, 14.5f * ky)
                path.quadraticTo(29f * kx, 5f * ky, 40f * kx, 4f * ky)
                drawPath(path, RedPen, style = stroke)
                drawCircle(RedPen, 2.4f * kx, o(26.5f, 10.8f), style = stroke)
                drawCircle(RedPen, 2.4f * kx, o(32f, 7.6f), style = stroke)
            }
            // 对调 = 一条折线，形如两节城垛，直连紧挨的两处
            SdTool.SWAP -> poly(6f, 4f, 6f, 22f, 16f, 22f, 16f, 5f, 30f, 5f, 30f, 24f)
            // 移动 = 方框（要移的）+ 横线向右 → 上折 → 顶端「Y」形分叉（目标位）
            SdTool.MOVE -> {
                rect(1.5f, 13.5f, 17f, 11f)
                poly(18.5f, 19f, 36f, 19f, 36f, 9f)
                poly(30f, 2.5f, 36f, 9f, 42f, 3.5f)
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  标点空位 / 提示语高亮 / 通用小件
// ══════════════════════════════════════════════════════════════════════

@Composable
private fun SdSlotBox(state: SdSlotState, text: String, active: Boolean, onClick: () -> Unit) {
    val borderColor = when (state) {
        SdSlotState.EMPTY -> if (active) MdColor else Color(0xFF94A3B8)
        SdSlotState.TYPING -> Amber
        SdSlotState.OK -> Color(0xFF22C55E)
        SdSlotState.WRONG -> Color(0xFFEF4444)
    }
    val bg = when (state) {
        SdSlotState.EMPTY -> SlotBg
        SdSlotState.TYPING -> SlotTypingBg
        SdSlotState.OK -> SlotOkBg
        SdSlotState.WRONG -> SlotWrongBg
    }
    val fg = when (state) {
        SdSlotState.EMPTY -> InkColor
        SdSlotState.TYPING -> SlotTypingText
        SdSlotState.OK -> SlotOkText
        SdSlotState.WRONG -> SlotWrongText
    }
    val shape = RoundedCornerShape(8.dp)
    Box(
        modifier = Modifier
            .padding(horizontal = 2.dp)
            .height(30.dp)
            .widthIn(min = 28.dp)
            .clip(shape)
            .background(bg)
            .then(
                if (state == SdSlotState.EMPTY && !active) Modifier.dashedBorder(borderColor, 1.dp, 8.dp)
                else Modifier.border(if (active) 2.dp else 1.dp, borderColor, shape),
            )
            .clickableNoRipple(onClick = onClick)
            .padding(horizontal = 5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = fg,
            maxLines = 1,
            textAlign = TextAlign.Center,
        )
    }
}

/** 提示语那一段：底部橙线 + 淡黄底 + 上方「提示语」标签 */
@Composable
private fun SdTagPart(text: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "提示语",
            fontSize = 10.5.sp,
            color = Color.White,
            modifier = Modifier
                .clip(SdPill)
                .background(Amber)
                .padding(horizontal = 6.dp),
        )
        Text(
            text,
            fontSize = 17.sp,
            color = Color(0xFF111827),
            modifier = Modifier
                .clip(RoundedCornerShape(3.dp))
                .background(TagPartBg)
                .drawBehind {
                    drawRect(color = Amber, topLeft = Offset(0f, size.height - 2.dp.toPx()), size = Size(size.width, 2.dp.toPx()))
                }
                .padding(horizontal = 1.dp),
        )
    }
}

/** 可点击、disabled 时不吃点击；无涟漪（对齐 web 扁平的 `button` 默认样式） */
@Composable
private fun Modifier.clickableNoRipple(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val interaction = remember { MutableInteractionSource() }
    return this.then(
        if (enabled) {
            Modifier.clickable(interactionSource = interaction, indication = null, onClick = onClick)
        } else {
            Modifier
        },
    )
}

/** 虚线边框（空位与「提示语在哪儿」按钮用；web 用 `border-style: dashed`） */
@Composable
private fun Modifier.dashedBorder(color: Color, width: Dp, radiusDp: Dp): Modifier = this.drawBehind {
    val stroke = Stroke(
        width = width.toPx(),
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f), 0f),
    )
    drawRoundRect(color = color, size = size, cornerRadius = CornerRadius(radiusDp.toPx()), style = stroke)
}
