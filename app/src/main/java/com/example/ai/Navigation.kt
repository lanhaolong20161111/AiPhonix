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
import com.example.ai.data.aihomework.AiHomeworkRepository
import com.example.ai.ui.aihomework.AiHomeworkPracticeScreen
import com.example.ai.ui.aihomework.AiHomeworkPracticeViewModel
import com.example.ai.ui.aihomework.AiHomeworkCharStatsScreen
import com.example.ai.ui.aihomework.AiHomeworkCharStatsViewModel
import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.ui.aichinese.AiChineseScreen
import com.example.ai.ui.aichinese.AiChineseViewModel
import com.example.ai.ui.pinyin.PinyinScreen
import com.example.ai.ui.pinyin.PinyinViewModel
import com.example.ai.ui.pinyintable.PinyinIndexScreen
import com.example.ai.ui.pinyintable.PinyinDetailScreen
import com.example.ai.ui.aihomework.AiHomeworkScreen
import com.example.ai.ui.aihomework.AiHomeworkViewModel
import com.example.ai.ui.aipractice.AiPracticeChatScreen
import com.example.ai.ui.aipractice.AiPracticeChatViewModel
import com.example.ai.ui.aipractice.AiPracticeScreen
import com.example.ai.ui.aipractice.AiPracticeViewModel
import com.example.ai.ui.murmur.MurmurScreen
import com.example.ai.ui.murmur.MurmurViewModel
import com.example.ai.ui.aienglish.AiEnglishScreen
import com.example.ai.ui.aienglish.AiEnglishViewModel
import com.example.ai.ui.aihistory.AiHistoryScreen
import com.example.ai.ui.aihistory.AiHistoryDetailScreen
import com.example.ai.ui.soehistory.SoeHistoryScreen
import com.example.ai.ui.parentreport.ParentReportScreen
import com.example.ai.ui.wordbook.WordbookScreen
import com.example.ai.ui.memoryjoy.MemoryJoyScreen
import com.example.ai.ui.charmap.CharMapScreen
import com.example.ai.ui.diary.DiaryScreen
import com.example.ai.ui.radical.RadicalGameScreen
import com.example.ai.ui.courseware.CoursewareScreen
import com.example.ai.ui.dailychinese.DailyChineseScreen
import com.example.ai.ui.dailychinese.DailyChineseViewModel
import com.example.ai.ui.dailyenglish.DailyEnglishScreen
import com.example.ai.ui.dailyenglish.DailyEnglishViewModel
import com.example.ai.ui.sentencecompose.SentenceComposeScreen
import com.example.ai.ui.sentencecompose.SentenceComposeViewModel
import com.example.ai.ui.speechcompose.SpeechComposeScreen
import com.example.ai.ui.speechcompose.SpeechComposeViewModel
import com.example.ai.ui.englishtalk.EnglishTalkScreen
import com.example.ai.ui.englishtalk.EnglishTalkViewModel
import com.example.ai.ui.mathcompound.MathCompoundExprScreen
import com.example.ai.ui.subtitlecapture.SubtitleCaptureScreen
import com.example.ai.ui.subtitlecapture.SubtitleCaptureViewModel
import com.example.ai.data.dailyzh.DailyZhRepository
import com.example.ai.data.dailyzh.DailyZhSync
import com.example.ai.data.dailyen.DailyEnRepository
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
            onOpenPinyin = { backStack.add(PinyinExercise) },
            onOpenPinyinTable = { backStack.add(PinyinIndex) },
            onOpenMurmur = { backStack.add(Murmur) },
            onOpenWordbook = { backStack.add(Wordbook) },
            onOpenMemoryJoy = { backStack.add(MemoryJoy) },
            onOpenCharMap = { backStack.add(CharMap) },
            onOpenDiary = { backStack.add(Diary) },
            onOpenRadicalGame = { backStack.add(RadicalGame) },
            onOpenDailyChinese = { backStack.add(DailyChinese) },
            onOpenDailyEnglish = { backStack.add(DailyEnglish) },
            onOpenSpeechCompose = { backStack.add(SpeechCompose) },
            onOpenAiEnglishTalk = { backStack.add(AiEnglishTalk) },
            onOpenMathCompoundExpr = { backStack.add(MathCompoundExpr) },
            onOpenSubtitleCapture = { backStack.add(SubtitleCapture) },
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
            onOpenSoeHistory = { backStack.add(SoeHistory) },
          )
        }
        entry<SoeHistory> {
          SoeHistoryScreen(
            onBack = { backStack.removeLastOrNull() },
            // 家长周报入口在评测历史页（与 web SoeHistoryPage 的「📈 家长周报」按钮一致）
            onOpenParentReport = { backStack.add(ParentReport) },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<ParentReport> {
          // 整页是垂直滚动列表，内边距由 Screen 自己管，这里只给安全区
          ParentReportScreen(
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding(),
          )
        }

        // ── 批次 B：识字与记录类模块 ──
        entry<Wordbook> {
          WordbookScreen(
            onBack = { backStack.removeLastOrNull() },
            container = container,
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<MemoryJoy> {
          MemoryJoyScreen(
            onBack = { backStack.removeLastOrNull() },
            onOpenDaily = { backStack.add(DailyPractice) },
            onOpenRecognition = { backStack.add(Recognition) },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<CharMap> {
          CharMapScreen(
            onBack = { backStack.removeLastOrNull() },
            // char-images 的 type 取值（认/写/词/英词/英句）与 CharImageList.type_ 同词表，直接透传
            onOpenCell = { grade, semester, type, _ ->
              backStack.add(CharImageList(grade = grade, semester = semester, type_ = type))
            },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<Diary> {
          DiaryScreen(
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<RadicalGame> {
          RadicalGameScreen(
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<Courseware> {
          CoursewareScreen(
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<DailyChinese> {
          DailyChineseScreen(
            viewModel = viewModel {
              DailyChineseViewModel(
                store = container.dailyZhStore,
                wordBankRepository = container.wordBankRepository,
                // 拍照 OCR：仓储 + 图片处理 + 识别模型偏好（三者都可空，缺失时 OCR 静默降级）
                ocrRepository = container.aiChineseRepository,
                ocrPlatform = container.ocrPlatform,
                ocrEngineStore = container.ocrEngineStore,
              )
            },
            onBack = { backStack.removeLastOrNull() },
            onOpenRecognition = { backStack.add(Recognition) },
            onOpenWordPractice = { backStack.add(WordPractice) },
            onOpenSentenceCompose = { backStack.add(SentenceCompose) },
            onOpenOralWriting = { backStack.add(OralWriting) },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<DailyEnglish> {
          DailyEnglishScreen(
            viewModel = viewModel {
              DailyEnglishViewModel(
                store = container.dailyEnStore,
                repository = DailyEnRepository(),
                ttsEngine = container.ttsEngine,
                // 拍照 OCR：仓储 + 图片处理 + 识别模型偏好（三者都可空，缺失时 OCR 静默降级）
                ocrRepository = container.aiChineseRepository,
                ocrPlatform = container.ocrPlatform,
                ocrEngineStore = container.ocrEngineStore,
              )
            },
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<SentenceCompose> {
          SentenceComposeScreen(
            viewModel = viewModel {
              SentenceComposeViewModel(dailyZhSync = DailyZhSync(container.dailyZhStore))
            },
            onBack = { backStack.removeLastOrNull() },
            onOpenDailyChinese = { backStack.add(DailyChinese) },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<SpeechCompose> {
          SpeechComposeScreen(
            viewModel = viewModel { SpeechComposeViewModel(ttsCache = container.ttsCache) },
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<AiEnglishTalk> {
          EnglishTalkScreen(
            viewModel = viewModel {
                EnglishTalkViewModel(
                    ttsCache = container.ttsCache,
                    ocrRepository = container.aiChineseRepository,
                    ocrPlatform = container.ocrPlatform,
                    ocrEngineStore = container.ocrEngineStore,
                )
            },
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<MathCompoundExpr> {
          // 页面自身按 item 管 16dp 内边距（整页是单个 LazyColumn），所以这里只给安全区
          MathCompoundExprScreen(
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding(),
          )
        }
        entry<SubtitleCapture> {
          // 同上：整页是单个 LazyColumn，内边距由 contentPadding 管，这里只给安全区
          SubtitleCaptureScreen(
            onBack = { backStack.removeLastOrNull() },
            viewModel = viewModel {
              SubtitleCaptureViewModel(
                repository = container.subtitleCaptureRepository,
                store = container.subtitleCaptureStore,
                speechRepository = container.speechRepository,
                ttsCache = container.ttsCache,
                ttsEngine = container.ttsEngine,
              )
            },
            modifier = Modifier.safeDrawingPadding(),
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
            onOpenCourseware = { backStack.add(Courseware) },
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
            onOpenHomework = { backStack.add(AiHomework) },
            onOpenChinese = { backStack.add(AiChinese) },
            onOpenEnglish = { backStack.add(AiEnglish()) },
          )
        }
        entry<AiChinese> {
          AiChineseScreen(
            viewModel = viewModel {
              AiChineseViewModel(
                repository = AiChineseRepository(),
                historyStore = container.aiHistoryStore,
              )
            },
            onBack = { backStack.removeLastOrNull() },
            onOpenHistory = { backStack.add(AiHistory) },
          )
        }
        entry<AiEnglish> { route ->
          AiEnglishScreen(
            viewModel = viewModel {
              AiEnglishViewModel(
                parseRepository = AiChineseRepository(),
                chatRepository = com.example.ai.data.aichat.AiChatRepository(),
                historyStore = container.aiHistoryStore,
                ttsEngine = container.ttsEngine,
              ).also { if (route.resumeSessionId.isNotBlank()) it.resumeSession(route.resumeSessionId) }
            },
            onBack = { backStack.removeLastOrNull() },
            onOpenHistory = { backStack.add(AiHistory) },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<AiHistory> {
          AiHistoryScreen(
            store = container.aiHistoryStore,
            onBack = { backStack.removeLastOrNull() },
            onOpenItem = { item ->
              if (item.sessionId.isNotBlank()) {
                // 会话型 → 回到对应模块续聊（目前仅英语有会话）
                when (item.module) {
                  "english" -> backStack.add(AiEnglish(resumeSessionId = item.sessionId))
                  "chinese" -> backStack.add(AiChinese)
                  else -> backStack.add(AiHomework)
                }
              } else {
                backStack.add(AiHistoryDetail(module = item.module, id = item.id))
              }
            },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<AiHistoryDetail> { route ->
          AiHistoryDetailScreen(
            module = route.module,
            itemId = route.id,
            container = container,
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<PinyinExercise> {
          PinyinScreen(
            viewModel = viewModel { PinyinViewModel(repository = AiChineseRepository()) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<PinyinIndex> {
          PinyinIndexScreen(
            onOpenDetail = { id -> backStack.add(PinyinDetail(id)) },
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<PinyinDetail> { route ->
          PinyinDetailScreen(
            initialId = route.id,
            onBack = { backStack.removeLastOrNull() },
            modifier = Modifier.safeDrawingPadding().padding(16.dp),
          )
        }
        entry<AiHomework> {
          AiHomeworkScreen(
            viewModel = viewModel {
              AiHomeworkViewModel(
                repository = AiHomeworkRepository(),
                historyStore = container.aiHistoryStore,
              )
            },
            onBack = { backStack.removeLastOrNull() },
            onOpenCharStats = { backStack.add(AiHomeworkCharStats) },
            onOpenHistory = { backStack.add(AiHistory) },
          )
        }
        entry<AiHomeworkCharStats> {
          AiHomeworkCharStatsScreen(
            viewModel = viewModel { AiHomeworkCharStatsViewModel(repository = AiHomeworkRepository()) },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<AiHomeworkPractice> { route ->
          AiHomeworkPracticeScreen(
            viewModel = viewModel {
              AiHomeworkPracticeViewModel(
                question = route.question,
                payloadJson = route.payload,
                repository = AiHomeworkRepository(),
              )
            },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<Murmur> {
          val scope = rememberCoroutineScope()
          MurmurScreen(
            viewModel = viewModel {
              MurmurViewModel(
                ttsEngine = container.ttsEngine,
                speechRepository = container.speechRepository,
              )
            },
            onBack = { backStack.removeLastOrNull() },
          )
        }
        entry<AiPracticeChat> { route ->
          AiPracticeChatScreen(
            viewModel = viewModel {
              AiPracticeChatViewModel(
                repository = AiPracticeRepository(),
                ttsEngine = container.ttsEngine,
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

