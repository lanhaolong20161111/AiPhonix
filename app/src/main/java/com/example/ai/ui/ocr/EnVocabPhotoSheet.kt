package com.example.ai.ui.ocr

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

// ── 配色（逐条对齐 web `App.css` 的 `.envocab-*`；正文一律纯黑） ──
private val Black = Color(0xFF000000)
private val StageBg = Color(0xFF0F172A)
private val EntryBorder = Color(0xFFC7D2FE)
private val EntryBg = Color(0xFFF5F7FF)
private val EntryTitle = Color(0xFF3730A3)
private val EntryBtnFg = Color(0xFF4338CA)
private val HintGray = Color(0xFF64748B)
private val LightHint = Color(0xFF94A3B8)
private val Indigo = Color(0xFF4F46E5)
private val ChipOnBorder = Color(0xFF4F46E5)
private val ChipOnBg = Color(0xFFEEF2FF)
private val ChipOnText = Color(0xFF3730A3)
private val ChipOffBorder = Color(0xFFE2E8F0)
private val ChipOffBg = Color(0xFFF8FAFC)
private val ChipOffText = Color(0xFF94A3B8)
private val SentOnText = Color(0xFF1E293B)
private val SentOffText = Color(0xFF64748B)
private val SecTitle = Color(0xFF334155)
private val SwitchText = Color(0xFF475569)
private val OkGreen = Color(0xFF16A34A)
private val OkBg = Color(0xFFF0FDF4)
private val WarnAmber = Color(0xFFB45309)
private val WarnBg = Color(0xFFFFFBEB)
private val ErrorRed = Color(0xFFDC2626)

/**
 * 「📷 拍照识词」弹层 —— 逐条对齐 web `web/src/components/EnVocabPhotoSheet.tsx`。
 *
 * 与 [OcrPickSheet]（手动拖框选）的区别：这里**不框选** —— 目标是「把这一页的词句都捞出来」，
 * 而不是精修某几行。打开即整页识别，识别原文可展开编辑（删掉页码/答案等噪声）→ 抽词实时重算。
 *
 * 抽词规则在 `data/envocab/EnVocabExtract.kt`（纯函数、有单测），本组件只负责展示与勾选；
 * 状态机在 [EnVocabPhotoSession]。
 *
 * ⚠️ 与 web 的两处呈现差异（有意，已在项目里成惯例）：
 * - web 是浮层（`.settings-overlay` + `object-fit: contain` 的预览）；Android 用**整屏替代**
 *   （与设置面板一致，避开弹层层级问题）。
 * - web 的单词 chips 用 CSS `flex-wrap`；Android 用 `FlowRow`。
 * - 预览图 web 限高 150px 且 `object-fit: contain`；Android 同样限高 150dp + `Fit`。
 */
@Composable
fun EnVocabPhotoSheet(
    state: EnVocabPhotoState,
    session: EnVocabPhotoSession,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color.White)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        // ── 顶栏 ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("📷 拍照识词", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Black)
            Spacer(Modifier.weight(1f))
            Text(
                "✕",
                fontSize = 18.sp,
                color = if (state.busy) LightHint else Black,
                modifier = Modifier
                    .then(if (state.busy) Modifier else Modifier.clickableNoRipple { session.close() })
                    .padding(4.dp),
            )
        }
        Spacer(Modifier.height(8.dp))

        Column(
            modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
        ) {
            // ── 预览图（转正 + 压缩后的规范图） ──
            val bmp = session.image
            if (bmp != null) {
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = "待识别",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 150.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(StageBg),
                )
                Spacer(Modifier.height(8.dp))
            }

            // ── 识别中（web 用 ParseTimer 显示已耗时） ──
            if (state.busy) {
                var elapsed by remember { mutableIntStateOf(0) }
                LaunchedEffect(state.busy) {
                    elapsed = 0
                    while (true) {
                        delay(1000)
                        elapsed += 1
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("⏱ ${elapsed}s", fontSize = 12.sp, color = HintGray)
                    Spacer(Modifier.width(8.dp))
                    Text(state.stageText, fontSize = 12.sp, color = HintGray)
                }
            }

            // ── 错误 + 重试 ──
            if (state.error.isNotBlank()) {
                Text(state.error, fontSize = 13.sp, color = ErrorRed, modifier = Modifier.padding(top = 6.dp))
                if (!state.busy) {
                    Spacer(Modifier.height(8.dp))
                    OcrSmallButton(text = "🔄 重试", onClick = { session.retry() }, enabled = true)
                }
            }

            // ── 识别结果（非识别中且有抽词结果才显示） ──
            val vocab = state.vocab
            if (!state.busy && vocab != null) {
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "✅ 识别完成：${vocab.words.size} 个单词 · ${vocab.sentences.size} 个句子",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = OkGreen,
                        modifier = Modifier.weight(1f),
                    )
                    OcrSmallButton(text = "🔄 重新识别", onClick = { session.retry() }, enabled = true)
                }

                Spacer(Modifier.height(8.dp))
                OcrEnginePicker(
                    engine = state.engine,
                    onSelect = { session.setEngine(it) },
                    showLabel = false,
                )
                Text(
                    "换模型后点上方「🔄 重新识别」生效。",
                    fontSize = 11.sp,
                    color = LightHint,
                    modifier = Modifier.padding(top = 2.dp),
                )

                // ── 识别原文（可编辑，删掉噪声行会实时重算词句） ──
                Spacer(Modifier.height(6.dp))
                Text(
                    "${if (state.editOpen) "▾" else "▸"} 识别原文（${state.text.length} 字，可编辑后重算）",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Indigo,
                    modifier = Modifier.clickableNoRipple { session.toggleEdit() },
                )
                if (state.editOpen) {
                    Spacer(Modifier.height(4.dp))
                    OutlinedTextField(
                        value = state.text,
                        onValueChange = { session.onTextChange(it) },
                        minLines = 5,
                        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 12.sp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // ── 虚词开关：词表变化 → 清空勾选 ──
                Spacer(Modifier.height(6.dp))
                Row(
                    verticalAlignment = Alignment.Top,
                    modifier = Modifier.clickableNoRipple { session.toggleKeepStop() },
                ) {
                    Checkbox(checked = state.keepStop, onCheckedChange = null)
                    Text(
                        "包含虚词（a / the / is / and …）—— 默认已剔除，觉得漏词就勾上",
                        fontSize = 12.sp,
                        color = SwitchText,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }

                // ── 单词 ──
                VocabSectionTitle(
                    title = "🔤 单词（已选 ${state.selWords.size}/${vocab.words.size}）",
                    truncated = vocab.wordsTruncated,
                )
                if (vocab.words.isEmpty()) {
                    Text("没有抽出单词。", fontSize = 12.sp, color = LightHint)
                } else {
                    WordChips(words = vocab.words, offWords = state.offWords, onToggle = { session.toggleWord(it) })
                }

                // ── 句子 ──
                Spacer(Modifier.height(10.dp))
                VocabSectionTitle(
                    title = "✏️ 句子（已选 ${state.selSentences.size}/${vocab.sentences.size}）",
                    truncated = vocab.sentencesTruncated,
                )
                if (vocab.sentences.isEmpty()) {
                    Text("没有抽出句子（图片里可能只有零散单词）。", fontSize = 12.sp, color = LightHint)
                } else {
                    for (s in vocab.sentences) {
                        SentenceRow(
                            sentence = s,
                            on = s !in state.offSentences,
                            onToggle = { session.toggleSentence(s) },
                        )
                    }
                }

                // ── 底部：提示 + 全选 / 全不选 ──
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        state.footHint,
                        fontSize = 11.sp,
                        color = if (state.canImport) HintGray else WarnAmber,
                        modifier = Modifier.weight(1f),
                    )
                    OcrSmallButton(text = "全选", onClick = { session.selectAll() }, enabled = true)
                    Spacer(Modifier.width(8.dp))
                    OcrSmallButton(text = "全不选", onClick = { session.selectNone() }, enabled = true)
                }
            }
        }

        Spacer(Modifier.height(10.dp))

        // ── 底部按钮 ──
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = { session.close() },
                enabled = !state.busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFFECEFF1),
                    contentColor = Black,
                ),
                modifier = Modifier.weight(1f),
            ) { Text("取消", fontSize = 15.sp) }
            Button(
                onClick = { session.confirm() },
                enabled = state.canImport,
                modifier = Modifier.weight(1f),
            ) { Text("✓ 用这些词句出题", fontSize = 15.sp) }
        }
    }
}

/** 分区标题（web `.envocab-sec-title`：左标题 + 右侧「超出上限已截断」） */
@Composable
private fun VocabSectionTitle(title: String, truncated: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp)) {
        Text(title, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = SecTitle, modifier = Modifier.weight(1f))
        if (truncated) {
            Text("超出上限已截断", fontSize = 12.sp, color = WarnAmber)
        }
    }
}

/** 单词胶囊（web `.envocab-chip` / `.on`：未选中淡下去 + 删除线） */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WordChips(words: List<String>, offWords: Set<String>, onToggle: (String) -> Unit) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        for (w in words) {
            val on = w !in offWords
            Text(
                w,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (on) ChipOnText else ChipOffText,
                textDecoration = if (on) null else TextDecoration.LineThrough,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (on) ChipOnBg else ChipOffBg)
                    .border(1.5.dp, if (on) ChipOnBorder else ChipOffBorder, RoundedCornerShape(999.dp))
                    .clickableNoRipple { onToggle(w) }
                    .padding(horizontal = 10.dp, vertical = 3.dp),
            )
        }
    }
}

/** 句子行（web `.envocab-sent` / `.on`：整行可点，勾选框只是视觉） */
@Composable
private fun SentenceRow(sentence: String, on: Boolean, onToggle: () -> Unit) {
    Row(
        verticalAlignment = Alignment.Top,
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 6.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (on) ChipOnBg else ChipOffBg)
            .border(1.5.dp, if (on) ChipOnBorder else ChipOffBorder, RoundedCornerShape(8.dp))
            .clickableNoRipple(onToggle)
            .padding(horizontal = 8.dp, vertical = 6.dp),
    ) {
        // ⚠️ onCheckedChange = null：点击事件交给整行，避免勾选框与行各触发一次（互相抵消）
        Checkbox(checked = on, onCheckedChange = null)
        Text(
            sentence,
            fontSize = 13.sp,
            color = if (on) SentOnText else SentOffText,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

/**
 * 设置页上的「📷 拍照识词（推荐）」入口卡片（web `.envocab-entry`）。
 *
 * 抽到本文件是因为它属于这条能力的门面，且要用同一组 `.envocab-*` 配色。
 */
@Composable
fun EnVocabEntryCard(
    /** 图片转正/压缩中（防止连点两次） */
    preparing: Boolean,
    /** 识图结果提示（成功绿 / 失败黄），空串不显示 */
    msg: String,
    /** 失败/警告文案用黄底（web `vocabWarn`） */
    warn: Boolean,
    onCamera: () -> Unit,
    onAlbum: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(EntryBg)
            .border(1.5.dp, EntryBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Column {
            Text("📷 拍照识词（推荐）", fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = EntryTitle)
            Spacer(Modifier.height(2.dp))
            Text(
                "拍课本、单词表或练习册，AI 会把这一页的所有单词和句子都认出来，" +
                    "你再勾选要练的，AI 就按这些词句出题跟你对话。",
                fontSize = 11.sp,
                color = HintGray,
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                EntryButton("📷 拍照", preparing, onCamera, Modifier.weight(1f))
                EntryButton("🖼️ 相册", preparing, onAlbum, Modifier.weight(1f))
            }
            if (preparing) {
                Spacer(Modifier.height(8.dp))
                Text("🖼️ 正在处理图片…", fontSize = 11.sp, color = HintGray)
            }
            if (msg.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    msg,
                    fontSize = 12.sp,
                    color = if (warn) WarnAmber else OkGreen,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (warn) WarnBg else OkBg)
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun EntryButton(text: String, enabled: Boolean, onClick: () -> Unit, modifier: Modifier) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.textButtonColors(contentColor = EntryBtnFg),
    ) {
        Text(
            text,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .border(1.5.dp, EntryBorder, RoundedCornerShape(10.dp))
                .background(Color.White)
                .padding(vertical = 9.dp),
        )
    }
}
