package com.example.ai

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import kotlinx.coroutines.launch
import com.example.ai.ui.chinesepractice.ChinesePracticeScreen
import com.example.ai.ui.chinesepractice.DictationScreen
import com.example.ai.ui.chinesepractice.DictationViewModel
import com.example.ai.ui.chinesepractice.RecognitionScreen
import com.example.ai.ui.chinesepractice.RecognitionViewModel
import com.example.ai.ui.chinesepractice.WordPracticeScreen
import com.example.ai.ui.chinesepractice.WordPracticeViewModel
import com.example.ai.ui.english.EnglishLearningScreen
import com.example.ai.ui.home.HomeScreen
import com.example.ai.ui.letter.LetterIndexScreen
import com.example.ai.ui.letter.LetterScreen
import com.example.ai.ui.phonics.PhonicsScreen
import com.example.ai.ui.phonemeindex.PhonemeIndexScreen
import com.example.ai.ui.pronunciation.PronunciationScreen
import com.example.ai.ui.pronunciation.PronunciationViewModel
import com.example.ai.ui.report.ReportScreen
import com.example.ai.ui.charimage.CharImageRecognitionScreen
import com.example.ai.ui.charimage.CharImageGradeSelectionScreen
import com.example.ai.ui.charimage.CharImageScreen
import com.example.ai.ui.charimage.CharImageViewModel
import com.example.ai.ui.quiz.QuizScreen
import com.example.ai.ui.videopractice.VideoPracticeScreen
import com.example.ai.di.ServiceModule

@Composable
fun MainNavigation(container: AppContainer) {
  val backStack = rememberNavBackStack(Home)

  NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryProvider =
      entryProvider {
        entry<Home> {
          HomeScreen(
            onNavigate = { backStack.add(it) },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<EnglishLearning> {
          EnglishLearningScreen(
            onNavigate = { backStack.add(it as NavKey) },
            onBack = { backStack.removeLastOrNull() },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<LetterIndex> {
          LetterIndexScreen(
            onNavigate = { backStack.add(it as NavKey) },
            onBack = { backStack.removeLastOrNull() },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<Letter> { route ->
          LetterScreen(
            char = route.char,
            onNavigate = { backStack.add(it as NavKey) },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<Phonics> { route ->
          PhonicsScreen(
            initialPhonemeIndex = route.phonemeIndex,
            onNavigate = { backStack.add(it as NavKey) },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<PhonemeIndex> {
          PhonemeIndexScreen(
            onNavigate = { backStack.add(it as NavKey) },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<Practice> { route ->
          PronunciationScreen(
            wordText = route.wordId,
            onBack = { backStack.removeLastOrNull() },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<Result> {
          // Phase 1: 评测结果内嵌在 PronunciationScreen 中
        }
        entry<Report> {
          ReportScreen(
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<VideoPractice> {
          VideoPracticeScreen(
            onBack = { backStack.removeLastOrNull() },
            onNavigate = { backStack.add(it as NavKey) },
            container = container,
          )
        }
        entry<Quiz> { route ->
          QuizScreen(
            videoName = route.videoName,
            srtPath = route.srtPath,
            onBack = { backStack.removeLastOrNull() },
            container = container,
          )
        }
        // 语文练习
        entry<ChinesePractice> {
          ChinesePracticeScreen(
            onNavigateToRecognition = { backStack.add(Recognition) },
            onNavigateToDictation = { backStack.add(Dictation) },
            onNavigateToWordPractice = { backStack.add(WordPractice) },
            onBack = { backStack.removeLastOrNull() }
          )
        }
        entry<Recognition> {
          val scope = rememberCoroutineScope()
          val recognitionVm = viewModel {
            RecognitionViewModel(
              wordBankRepo = container.wordBankRepository,
              wordInfoRepo = container.wordInfoRepository,
              speechRepository = container.speechRepository
            )
          }
          RecognitionScreen(
            viewModel = recognitionVm,
            onPlayTts = { text -> scope.launch { container.ttsEngine.speak(text) } },
            onStartRecording = { refText ->
              recognitionVm.startVoiceEvaluation()
            },
            onStopRecording = {
              recognitionVm.stopVoiceEvaluation()
            },
            onBack = { backStack.removeLastOrNull() }
          )
        }
        entry<Dictation> {
          val scope = rememberCoroutineScope()
          DictationScreen(
            viewModel = viewModel {
              DictationViewModel(
                wordBankRepo = container.wordBankRepository,
                wordInfoRepo = container.wordInfoRepository
              )
            },
            onPlayTts = { text -> scope.launch { container.ttsEngine.speak(text) } },
            onBack = { backStack.removeLastOrNull() }
          )
        }
        entry<WordPractice> {
          val scope = rememberCoroutineScope()
          WordPracticeScreen(
            viewModel = viewModel {
              WordPracticeViewModel(
                wordBankRepo = container.wordBankRepository,
                wordInfoRepo = container.wordInfoRepository
              )
            },
            onPlayTts = { text -> scope.launch { container.ttsEngine.speak(text) } },
            onBack = { backStack.removeLastOrNull() }
          )
        }
        entry<CharImageRecognition> {
          CharImageRecognitionScreen(
            onNavigateToGrade = { backStack.add(it) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<CharImageGradeSelection> { route ->
          CharImageGradeSelectionScreen(
            grade = route.grade,
            semester = route.semester,
            onNavigateToList = { backStack.add(it) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<CharImageList> { route ->
          val vm = remember { CharImageViewModel(serverBase = ServiceModule.serverBase) }
          LaunchedEffect(route) { vm.load(route.grade, route.semester, route.type_) }
          LaunchedEffect(Unit) { vm.setSpeechRepository(container.speechRepository) }
          val scope = rememberCoroutineScope()
          CharImageScreen(
            viewModel = vm,
            onPlayTts = { text -> scope.launch { container.ttsEngine.speak(text) } },
            onBack = { backStack.removeLastOrNull() },
          )
        }
      },
  )
}
