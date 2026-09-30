/** 应用路由表 — 页面级懒加载（React.lazy + Suspense），首屏只拉当前页代码 */

import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppLayout } from "./layouts/AppLayout"
import { RequireAuth, GuestOnly } from "./components/Guards"

// 页面均为命名导出 → 统一转 default 供 React.lazy 使用
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import("./pages/RegisterPage").then((m) => ({ default: m.RegisterPage })))
const HomePage = lazy(() => import("./pages/HomePage").then((m) => ({ default: m.HomePage })))
const PlaceholderPage = lazy(() => import("./pages/PlaceholderPage").then((m) => ({ default: m.PlaceholderPage })))
const PinyinPracticePage = lazy(() => import("./pages/PinyinPracticePage").then((m) => ({ default: m.PinyinPracticePage })))
const RecognitionPage = lazy(() => import("./pages/RecognitionPage").then((m) => ({ default: m.RecognitionPage })))
const DictationPage = lazy(() => import("./pages/DictationPage").then((m) => ({ default: m.DictationPage })))
const WordPracticePage = lazy(() => import("./pages/WordPracticePage").then((m) => ({ default: m.WordPracticePage })))
const SpeechComposePage = lazy(() => import("./pages/SpeechComposePage").then((m) => ({ default: m.SpeechComposePage })))
const AiEnglishTalkPage = lazy(() => import("./pages/AiEnglishTalkPage").then((m) => ({ default: m.AiEnglishTalkPage })))
const EnglishLearningPage = lazy(() => import("./pages/EnglishLearningPage").then((m) => ({ default: m.EnglishLearningPage })))
const LetterIndexPage = lazy(() => import("./pages/LetterIndexPage").then((m) => ({ default: m.LetterIndexPage })))
const LetterDetailPage = lazy(() => import("./pages/LetterDetailPage").then((m) => ({ default: m.LetterDetailPage })))
const PhonemeIndexPage = lazy(() => import("./pages/PhonemeIndexPage").then((m) => ({ default: m.PhonemeIndexPage })))
const PhonemeDetailPage = lazy(() => import("./pages/PhonemeDetailPage").then((m) => ({ default: m.PhonemeDetailPage })))
const PinyinIndexPage = lazy(() => import("./pages/PinyinIndexPage").then((m) => ({ default: m.PinyinIndexPage })))
const PinyinDetailPage = lazy(() => import("./pages/PinyinDetailPage").then((m) => ({ default: m.PinyinDetailPage })))
const PronunciationPage = lazy(() => import("./pages/PronunciationPage").then((m) => ({ default: m.PronunciationPage })))
const CharImagePage = lazy(() => import("./pages/CharImagePage").then((m) => ({ default: m.CharImagePage })))
const CharImageEntryPage = lazy(() => import("./pages/CharImageEntryPage").then((m) => ({ default: m.CharImageEntryPage })))
const SoeHistoryPage = lazy(() => import("./pages/SoeHistoryPage").then((m) => ({ default: m.SoeHistoryPage })))
const OralWritingPage = lazy(() => import("./pages/OralWritingPage").then((m) => ({ default: m.OralWritingPage })))
const AiPracticePage = lazy(() => import("./pages/AiPracticePage").then((m) => ({ default: m.AiPracticePage })))
const AiPracticeChatPage = lazy(() => import("./pages/AiPracticeChatPage").then((m) => ({ default: m.AiPracticeChatPage })))
const QuizPracticePage = lazy(() => import("./pages/QuizPracticePage").then((m) => ({ default: m.QuizPracticePage })))
const AiHomeworkPage = lazy(() => import("./pages/AiHomeworkPage").then((m) => ({ default: m.AiHomeworkPage })))
const AiChinesePage = lazy(() => import("./pages/AiChinesePage").then((m) => ({ default: m.AiChinesePage })))
const AiEnglishPage = lazy(() => import("./pages/AiEnglishPage").then((m) => ({ default: m.AiEnglishPage })))
const AiParseResultPage = lazy(() => import("./pages/AiParseResultPage").then((m) => ({ default: m.AiParseResultPage })))
const AiHistoryPage = lazy(() => import("./pages/AiHistoryPage").then((m) => ({ default: m.AiHistoryPage })))
const CoursewareManagerPage = lazy(() => import("./pages/CoursewareManagerPage").then((m) => ({ default: m.CoursewareManagerPage })))
const VideoPracticePage = lazy(() => import("./pages/VideoPracticePage").then((m) => ({ default: m.VideoPracticePage })))
const SubtitleCapturePage = lazy(() => import("./pages/SubtitleCapturePage").then((m) => ({ default: m.SubtitleCapturePage })))
const SoeDemoPage = lazy(() => import("./pages/SoeDemoPage").then((m) => ({ default: m.SoeDemoPage })))
const WordbookPage = lazy(() => import("./pages/WordbookPage").then((m) => ({ default: m.WordbookPage })))
const SentencePracticePage = lazy(() => import("./pages/SentencePracticePage").then((m) => ({ default: m.SentencePracticePage })))
const CharMapPage = lazy(() => import("./pages/CharMapPage").then((m) => ({ default: m.CharMapPage })))
const ParentReportPage = lazy(() => import("./pages/ParentReportPage").then((m) => ({ default: m.ParentReportPage })))
const DiaryPage = lazy(() => import("./pages/DiaryPage").then((m) => ({ default: m.DiaryPage })))
const RadicalGamePage = lazy(() => import("./pages/RadicalGamePage").then((m) => ({ default: m.RadicalGamePage })))
const DailyPracticePage = lazy(() => import("./pages/DailyPracticePage").then((m) => ({ default: m.DailyPracticePage })))
const DailyChinesePage = lazy(() => import("./pages/DailyChinesePage").then((m) => ({ default: m.DailyChinesePage })))
const DailyEnglishPage = lazy(() => import("./pages/DailyEnglishPage").then((m) => ({ default: m.DailyEnglishPage })))
const MurmurPage = lazy(() => import("./pages/MurmurPage").then((m) => ({ default: m.MurmurPage })))
const MemoryJoyPage = lazy(() => import("./pages/MemoryJoyPage").then((m) => ({ default: m.MemoryJoyPage })))
const MathCompoundExprPage = lazy(() => import("./pages/MathCompoundExprPage").then((m) => ({ default: m.MathCompoundExprPage })))
const EquationMovePage = lazy(() => import("./pages/EquationMovePage").then((m) => ({ default: m.EquationMovePage })))
const MathUnitsPage = lazy(() => import("./pages/MathUnitsPage").then((m) => ({ default: m.MathUnitsPage })))

/** 懒加载分片加载中的占位（居中轻量提示，避免白屏闪烁） */
function PageFallback() {
  return (
    <div className="page center-card">
      <p className="empty">加载中…</p>
    </div>
  )
}

export const router = createBrowserRouter(
  [
    {
      path: "/login",
      element: (
        <GuestOnly>
          <Suspense fallback={<PageFallback />}>
            <LoginPage />
          </Suspense>
        </GuestOnly>
      ),
    },
    {
      path: "/register",
      element: (
        <GuestOnly>
          <Suspense fallback={<PageFallback />}>
            <RegisterPage />
          </Suspense>
        </GuestOnly>
      ),
    },
    {
      path: "/",
      element: (
        <RequireAuth>
          {/* Suspense 包住 AppLayout：其 Outlet 渲染的懒加载子页共用此 fallback */}
          <Suspense fallback={<PageFallback />}>
            <AppLayout />
          </Suspense>
        </RequireAuth>
      ),
      children: [
        { index: true, element: <Navigate to="/home" replace /> },
        { path: "home", element: <HomePage /> },
        { path: "module/recognition", element: <RecognitionPage /> },
        { path: "module/dictation", element: <DictationPage /> },
        { path: "module/word_practice", element: <WordPracticePage /> },
        { path: "module/speech_compose", element: <SpeechComposePage /> },
        { path: "module/ai_english_talk", element: <AiEnglishTalkPage /> },
        { path: "module/english_learning", element: <EnglishLearningPage /> },
        { path: "module/letters", element: <LetterIndexPage /> },
        { path: "module/letter/:char", element: <LetterDetailPage /> },
        { path: "module/phoneme-index", element: <PhonemeIndexPage /> },
        { path: "module/phoneme/:symbol", element: <PhonemeDetailPage /> },
        { path: "module/pinyin-index", element: <PinyinIndexPage /> },
        { path: "module/pinyin/:id", element: <PinyinDetailPage /> },
        { path: "module/pronounce/:wordId", element: <PronunciationPage /> },
        { path: "module/char_image", element: <CharImageEntryPage /> },
        { path: "module/char_image/practice", element: <CharImagePage /> },
        { path: "module/soe_history", element: <SoeHistoryPage /> },
        { path: "module/wordbook", element: <WordbookPage /> },
        { path: "module/memory_joy", element: <MemoryJoyPage /> },
        { path: "module/math_compound_expr", element: <MathCompoundExprPage /> },
        { path: "module/math_equation_move", element: <EquationMovePage /> },
        { path: "module/math_units", element: <MathUnitsPage /> },
        { path: "module/sentence_practice", element: <SentencePracticePage /> },
        { path: "module/char_map", element: <CharMapPage /> },
        { path: "module/parent_report", element: <ParentReportPage /> },
        { path: "module/diary", element: <DiaryPage /> },
        { path: "module/radical_game", element: <RadicalGamePage /> },
        { path: "module/oral_writing", element: <OralWritingPage /> },
        { path: "module/ai_practice", element: <AiPracticePage /> },
        { path: "module/ai-practice-chat/:sessionId", element: <AiPracticeChatPage /> },
        { path: "module/ai_homework", element: <AiHomeworkPage /> },
        { path: "module/ai_chinese", element: <AiChinesePage /> },
        { path: "module/ai_english", element: <AiEnglishPage /> },
        { path: "module/ai_parse_result", element: <AiParseResultPage /> },
        { path: "module/ai_history", element: <AiHistoryPage /> },
        { path: "module/courseware_manager", element: <CoursewareManagerPage /> },
        { path: "module/video_practice", element: <VideoPracticePage /> },
        { path: "module/subtitle_capture", element: <SubtitleCapturePage /> },
        { path: "module/quiz_practice", element: <QuizPracticePage /> },
        { path: "module/daily_practice", element: <DailyPracticePage /> },
        { path: "module/daily_chinese", element: <DailyChinesePage /> },
        { path: "module/daily_english", element: <DailyEnglishPage /> },
        { path: "module/murmur", element: <MurmurPage /> },
        { path: "module/:featureId", element: <PlaceholderPage /> },
        { path: "pinyin", element: <PinyinPracticePage /> },
        { path: "soe-demo", element: <SoeDemoPage /> },
      ],
    },
    { path: "*", element: <Navigate to="/" replace /> },
  ],
  { basename: "/web" },
)
