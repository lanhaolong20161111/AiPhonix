package com.example.ai

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import kotlinx.coroutines.launch
import com.example.ai.data.charimage.PendingFeedbackStore
import com.example.ai.ui.chinesepractice.ChinesePracticeScreen
import com.example.ai.ui.chinesepractice.DictationScreen
import com.example.ai.ui.chinesepractice.DictationViewModel
import com.example.ai.ui.chinesepractice.RecognitionScreen
import com.example.ai.ui.chinesepractice.RecognitionViewModel
import com.example.ai.ui.chinesepractice.WordPracticeScreen
import com.example.ai.ui.chinesepractice.WordPracticeViewModel
import com.example.ai.ui.english.EnglishLearningScreen
import com.example.ai.ui.home.HomeScreen
import com.example.ai.ui.account.AccountScreen
import com.example.ai.ui.account.FeedbackListScreen
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
import com.example.ai.ui.oralwriting.OralWritingScreen
import com.example.ai.ui.oralwriting.OralWritingViewModel
import com.example.ai.ui.login.LoginScreen
import com.example.ai.ui.login.LoginViewModel
import com.example.ai.ui.quiz.QuizScreen
import com.example.ai.ui.dailypractice.DailyPracticeScreen
import com.example.ai.ui.userimport.ImportScreen
import com.example.ai.ui.userimport.ImportViewModel
import com.example.ai.ui.mylearning.MyLearningScreen
import com.example.ai.ui.mylearning.MyLearningViewModel
import com.example.ai.ui.myimports.MyImportsScreen
import com.example.ai.ui.myimports.MyImportsViewModel
import com.example.ai.ui.parent.ParentSettingsScreen
import com.example.ai.ui.quizpractice.QuizPracticeScreen
import com.example.ai.ui.quizpractice.QuizPracticeViewModel
import com.example.ai.ui.sentencepractice.SentenceReadingScreen
import com.example.ai.ui.sentencepractice.SentenceReadingViewModel
import com.example.ai.ui.articlereading.ArticleListScreen
import com.example.ai.ui.articlereading.ArticleListViewModel
import com.example.ai.ui.articlereading.ArticleReadingScreen
import com.example.ai.ui.articlereading.ArticleReadingViewModel
import com.example.ai.ui.articlereading.ArticleQuizScreen
import com.example.ai.ui.articlereading.ArticleQuizViewModel
import com.example.ai.Account
import com.example.ai.ui.videopractice.VideoPracticeScreen
import com.example.ai.di.ServiceModule
import com.example.ai.data.auth.TokenManager
import android.widget.Toast

@Composable
fun MainNavigation(container: AppContainer) {
  val context = LocalContext.current
  val backStack = rememberNavBackStack(
    if (TokenManager.isLoggedIn) Home else Login
  )

  // ── 打卡：记录当前正在训练的任务项；栈回到首页（size==1）时自动标记完成 ──
  var activePlanItemId by remember { mutableStateOf<String?>(null) }
  val trainingPlanStore = container.trainingPlanStore
  LaunchedEffect(backStack.size) {
    if (backStack.size == 1) {
      val itemId = activePlanItemId
      if (itemId != null) {
        trainingPlanStore.markDoneAsync(itemId)
        activePlanItemId = null
      }
    }
  }

  NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryProvider =
      entryProvider {
        entry<Home> {
          HomeScreen(
            onStartItem = { itemId, navKey ->
              activePlanItemId = itemId
              backStack.add(navKey)
            },
            onOpenAccount = { backStack.add(Account) },
            onOpenParent = { backStack.add(ParentSettings) },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<Account> {
          AccountScreen(
            onBack = { backStack.removeLastOrNull() },
            onLogout = {
              TokenManager.clear()
              backStack.remove(Home)
              backStack.remove(Account)
              backStack.add(Login)
            },
            onOpenList = { backStack.add(it) },
            onOpenFeedbackList = { status -> backStack.add(FeedbackList(status)) },
            onOpenParent = { backStack.add(ParentSettings) },
          )
        }
        entry<FeedbackList> { route ->
          FeedbackListScreen(
            status = route.status,
            onBack = { backStack.removeLastOrNull() },
            onOpenList = { backStack.add(it) },
          )
        }
        entry<Login> {
          LoginScreen(
            onLoginSuccess = {
              backStack.remove(Login)
              backStack.add(Home)
            },
          )
        }
        entry<ParentSettings> {
          ParentSettingsScreen(
            store = container.trainingPlanStore,
            onBack = { backStack.removeLastOrNull() },
            onOpenImport = { backStack.add(ImportCenter) },
            onOpenMyImports = { backStack.add(MyImports) },
          )
        }
        entry<DailyPractice> {
          DailyPracticeScreen(
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<ImportCenter> {
          ImportScreen(
            viewModel = viewModel { ImportViewModel(store = container.userImportStore, prefs = container.userImportPrefs, contextProvider = { container.appContext }) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<MyImports> {
          MyImportsScreen(
            viewModel = viewModel { MyImportsViewModel(store = container.userImportStore) },
            onBack = { backStack.removeLastOrNull() },
            onNavigateImport = { backStack.add(ImportCenter) },
          )
        }
        entry<MyLearning> {
          MyLearningScreen(
            viewModel = viewModel { MyLearningViewModel(store = container.userImportStore) },
            onBack = { backStack.removeLastOrNull() },
            onOpenQuizPractice = { backStack.add(QuizPractice) },
            onOpenSentencePractice = { backStack.add(SentenceReading) },
            onOpenArticleList = { backStack.add(ArticleList) },
          )
        }
        entry<QuizPractice> {
          QuizPracticeScreen(
            viewModel = viewModel { QuizPracticeViewModel(store = container.userImportStore) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<SentenceReading> {
          SentenceReadingScreen(
            viewModel = viewModel { SentenceReadingViewModel(store = container.userImportStore) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<ArticleList> {
          ArticleListScreen(
            viewModel = viewModel { ArticleListViewModel(store = container.userImportStore) },
            onBack = { backStack.removeLastOrNull() },
            onOpenArticle = { key, title -> backStack.add(ArticleReading(key, title)) },
          )
        }
        entry<ArticleReading> { route ->
          ArticleReadingScreen(
            articleKey = route.articleKey,
            articleTitle = route.title,
            viewModel = viewModel {
              ArticleReadingViewModel(
                store = container.userImportStore,
                readingStore = container.articleReadingStore,
                ttsEngine = container.ttsEngine,
              )
            },
            onBack = { backStack.removeLastOrNull() },
            onFinish = { key, title -> backStack.add(ArticleQuiz(key, title)) },
          )
        }
        entry<ArticleQuiz> { route ->
          ArticleQuizScreen(
            articleKey = route.articleKey,
            articleTitle = route.title,
            viewModel = viewModel {
              ArticleQuizViewModel(
                store = container.userImportStore,
                readingStore = container.articleReadingStore,
                llmRepository = ServiceModule.llmRepository,
              )
            },
            onBack = { backStack.removeLastOrNull() },
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
            onNavigateToOralWriting = { backStack.add(OralWriting) },
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
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
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
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
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
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
            onBack = { backStack.removeLastOrNull() }
          )
        }
        entry<CharImageRecognition> {
          CharImageRecognitionScreen(
            onNavigateToGrade = { backStack.add(it) },
            onContinue = { backStack.add(it) },
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
          val context = LocalContext.current
          val vm = remember { CharImageViewModel(serverBase = ServiceModule.serverBase, pendingStore = PendingFeedbackStore(context)) }
          LaunchedEffect(route) { vm.load(route.grade, route.semester, route.type_) }
          LaunchedEffect(Unit) { vm.setSpeechRepository(container.speechRepository) }
          val scope = rememberCoroutineScope()
          CharImageScreen(
            viewModel = vm,
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<VocabularyPractice> {
          val context = LocalContext.current
          val vm = remember { CharImageViewModel(serverBase = ServiceModule.serverBase, pendingStore = PendingFeedbackStore(context)) }
          LaunchedEffect(Unit) { vm.load("", "", "英词") }
          LaunchedEffect(Unit) { vm.setSpeechRepository(container.speechRepository) }
          val scope = rememberCoroutineScope()
          CharImageScreen(
            viewModel = vm,
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<SentencePractice> {
          val context = LocalContext.current
          val vm = remember { CharImageViewModel(serverBase = ServiceModule.serverBase, pendingStore = PendingFeedbackStore(context)) }
          LaunchedEffect(Unit) { vm.load("", "", "英句") }
          LaunchedEffect(Unit) { vm.setSpeechRepository(container.speechRepository) }
          val scope = rememberCoroutineScope()
          CharImageScreen(
            viewModel = vm,
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<OralWriting> {
          OralWritingScreen(
            viewModel = viewModel { OralWritingViewModel(serverBase = ServiceModule.serverBase) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
      },
  )
}

