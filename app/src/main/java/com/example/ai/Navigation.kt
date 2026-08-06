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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.example.ai.data.charimage.PendingFeedbackStore
import com.example.ai.data.training.ActiveTrainingSession
import com.example.ai.data.training.PlanItem
import com.example.ai.data.training.PlanResult
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
import com.example.ai.ui.dailypractice.DailyPracticeViewModel
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
import com.example.ai.data.aipractice.AiPracticeRepository
import com.example.ai.ui.aipractice.AiPracticeChatScreen
import com.example.ai.ui.aipractice.AiPracticeChatViewModel
import com.example.ai.ui.aipractice.AiPracticeScreen
import com.example.ai.ui.aipractice.AiPracticeViewModel
import android.widget.Toast

@Composable
fun MainNavigation(container: AppContainer) {
  val context = LocalContext.current
  val backStack = rememberNavBackStack(
    if (TokenManager.isLoggedIn) Home else Login
  )

  // ── 打卡（V2）：记录当前正在训练的任务项；栈回到首页（size==1）时，
  // 仅当页面回传了真实结果才标记完成并上报服务端；无结果则不标记（下次重新练）。
  var activePlanItemId by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  // TTS 全局朗读状态：朗读期间所有页面朗读按钮禁用置灰（TtsEngine 单例）
  val ttsSpeaking by container.ttsEngine.isSpeaking.collectAsStateWithLifecycle()
  val trainingPlanStore = container.trainingPlanStore
  val sessionResultStore = container.sessionResultStore
  val trainingPlanSync = container.trainingPlanSync
  LaunchedEffect(backStack.size) {
    if (backStack.size == 1) {
      val itemId = activePlanItemId
      if (itemId != null) {
        val result = sessionResultStore.consume(itemId)
        if (result != null) {
          val plan = trainingPlanStore.plan.value
          val item = plan?.items?.find { it.id == itemId }
          if (item != null) {
            trainingPlanStore.markDoneWithResult(itemId, result)
            scope.launch {
              try {
                withContext(Dispatchers.IO) { trainingPlanSync.reportProgress(item, result) }
                withContext(Dispatchers.IO) { trainingPlanSync.pushPlan(plan) }
              } catch (_: Exception) { /* 网络容错：本地打卡已落盘，下次启动会再拉取 */ }
            }
          }
        }
        // 无 result → 未达完成标准，done 保持 false，学生下次进入重新练
        ActiveTrainingSession.clear()
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
            onStartItem = { item, navKey ->
              activePlanItemId = item.id
              ActiveTrainingSession.start(item.id, item.featureId)
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
          val vm = remember { DailyPracticeViewModel(container.wordBankRepository, container.sessionResultStore) }
          LaunchedEffect(Unit) { vm.setTaskItemId(ActiveTrainingSession.itemId) }
          DailyPracticeScreen(
            viewModel = vm,
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
            onOpenAiPractice = { backStack.add(AiPractice) },
          )
        }
        entry<AiPractice> {
          AiPracticeScreen(
            viewModel = viewModel { AiPracticeViewModel(repository = AiPracticeRepository()) },
            onBack = { backStack.removeLastOrNull() },
            onOpenChat = { sessionId, content -> backStack.add(AiPracticeChat(sessionId, content)) },
          )
        }
        entry<AiPracticeChat> { route ->
          AiPracticeChatScreen(
            viewModel = viewModel {
              AiPracticeChatViewModel(
                repository = AiPracticeRepository(),
                ttsEngine = container.ttsEngine,
                appContext = container.appContext,
              ).also { it.initSession(route.sessionId, route.content) }
            },
            ttsEngine = container.ttsEngine,
            onBack = { backStack.removeLastOrNull() },
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
            onNavigate = {
              ActiveTrainingSession.itemId?.let { sessionResultStore.record(it, PlanResult(count = 1)) }
              backStack.add(it as NavKey)
            },

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
            onNavigateToRecognition = {
              ActiveTrainingSession.itemId?.let { sessionResultStore.record(it, PlanResult(count = 1)) }
              backStack.add(Recognition)
            },
            onNavigateToDictation = {
              ActiveTrainingSession.itemId?.let { sessionResultStore.record(it, PlanResult(count = 1)) }
              backStack.add(Dictation)
            },
            onNavigateToWordPractice = {
              ActiveTrainingSession.itemId?.let { sessionResultStore.record(it, PlanResult(count = 1)) }
              backStack.add(WordPractice)
            },
            onNavigateToOralWriting = {
              ActiveTrainingSession.itemId?.let { sessionResultStore.record(it, PlanResult(count = 1)) }
              backStack.add(OralWriting)
            },
            onBack = { backStack.removeLastOrNull() }
          )

        }
        entry<Recognition> {
          val scope = rememberCoroutineScope()
          val recognitionVm = viewModel {
            RecognitionViewModel(
              wordBankRepo = container.wordBankRepository,
              wordInfoRepo = container.wordInfoRepository,
              speechRepository = container.speechRepository,
              sessionResultStore = container.sessionResultStore
            )

          }
          RecognitionScreen(
            viewModel = recognitionVm,
            speaking = ttsSpeaking,
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
                wordInfoRepo = container.wordInfoRepository,
                sessionResultStore = container.sessionResultStore
              )

            },
            speaking = ttsSpeaking,
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
                wordInfoRepo = container.wordInfoRepository,
                sessionResultStore = container.sessionResultStore
              )

            },
            speaking = ttsSpeaking,
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
          val vm = remember { CharImageViewModel(serverBase = ServiceModule.serverBase, pendingStore = PendingFeedbackStore(context), sessionResultStore = container.sessionResultStore, contentRepository = container.contentRepository) }
          LaunchedEffect(route) { vm.load(route.grade, route.semester, route.type_) }
          LaunchedEffect(Unit) { vm.setSpeechRepository(container.speechRepository) }
          val scope = rememberCoroutineScope()
          CharImageScreen(
            viewModel = vm,
            speaking = ttsSpeaking,
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<VocabularyPractice> {
          val context = LocalContext.current
          val vm = remember { CharImageViewModel(serverBase = ServiceModule.serverBase, pendingStore = PendingFeedbackStore(context), sessionResultStore = container.sessionResultStore, contentRepository = container.contentRepository) }
          LaunchedEffect(Unit) { vm.load("", "", "英词") }
          LaunchedEffect(Unit) { vm.setSpeechRepository(container.speechRepository) }
          val scope = rememberCoroutineScope()
          CharImageScreen(
            viewModel = vm,
            speaking = ttsSpeaking,
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<SentencePractice> {
          val context = LocalContext.current
          val vm = remember { CharImageViewModel(serverBase = ServiceModule.serverBase, pendingStore = PendingFeedbackStore(context), sessionResultStore = container.sessionResultStore, contentRepository = container.contentRepository) }
          LaunchedEffect(Unit) { vm.load("", "", "英句") }
          LaunchedEffect(Unit) { vm.setSpeechRepository(container.speechRepository) }
          val scope = rememberCoroutineScope()
          CharImageScreen(
            viewModel = vm,
            speaking = ttsSpeaking,
            onPlayTts = { text -> scope.launch { if (!container.ttsEngine.speak(text)) Toast.makeText(context, "朗读失败，请检查网络", Toast.LENGTH_SHORT).show() } },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<OralWriting> {
          OralWritingScreen(
            viewModel = viewModel { OralWritingViewModel(serverBase = ServiceModule.serverBase, sessionResultStore = container.sessionResultStore) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
      },
  )
}

