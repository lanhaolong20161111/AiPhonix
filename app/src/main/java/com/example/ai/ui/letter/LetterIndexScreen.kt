package com.example.ai.ui.letter

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ai.AppContainer
import com.example.ai.data.model.Letter

/**
 * 26字母索引网格页。
 * 点击任一字母进入该字母的学习页。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LetterIndexScreen(
    onNavigate: (Any) -> Unit,
    onBack: () -> Unit,
    container: AppContainer,
    modifier: Modifier = Modifier,
    viewModel: LetterIndexViewModel = viewModel { LetterIndexViewModel(container.contentRepository) },
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("26个英文字母") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("← 返回") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        if (state.isLoading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                modifier = modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.letters, key = { it.char }) { letter ->
                    LetterGridItem(
                        letter = letter,
                        onClick = { onNavigate(com.example.ai.Letter(letter.char)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun LetterGridItem(
    letter: Letter,
    onClick: () -> Unit,
) {
    OutlinedCard(
        onClick = onClick,
        modifier = Modifier.height(80.dp),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = letter.uppercase,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = letter.lowercase,
                    fontSize = 16.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
