package com.example.ai.ui.aihomework

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.ai.data.aihomework.QuestionItem

/** 问题列表卡片的主题色（与高亮子图一致） */
private val QBlue = Color(0xFF1976D2)
private val QHintGray = Color(0xFF546E7A)

/**
 * 题目里的问题列表（面向问题倒推）。
 * 点击问题回调 [onSelect]（练习页用于加载该问的解题步骤）；不再与关系图高亮关联。
 */
@Composable
fun QuestionListCard(
    questions: List<QuestionItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,  // -1 = 取消选中
    modifier: Modifier = Modifier,
) {
    if (questions.isEmpty()) return
    Column(modifier) {
        Text(
            "❓ 题目里的问题",
            style = MaterialTheme.typography.titleSmall,
        )
        Spacer(Modifier.height(6.dp))
        questions.forEachIndexed { i, q ->
            Surface(
                onClick = { onSelect(if (i == selectedIndex) -1 else i) },
                shape = RoundedCornerShape(10.dp),
                color = Color(0xFFF8F9FA),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 3.dp),
            ) {
                Column(Modifier.padding(horizontal = 10.dp, vertical = 7.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Q${i + 1}",
                            style = MaterialTheme.typography.labelMedium,
                            color = Color(0xFF1A1A1A),
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            q.text,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    if (q.hint.isNotBlank()) {
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "💡 " + q.hint,
                            style = MaterialTheme.typography.bodySmall,
                            color = QHintGray,
                        )
                    }
                }
            }
        }
    }
}
