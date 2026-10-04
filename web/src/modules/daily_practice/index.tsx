/** 每日一练 — 语文 / 数学 / 英语 三个入口（家长训练计划里的「每日一练」） */

import { useNavigate } from "react-router-dom"

export function DailyPracticePage() {
  const navigate = useNavigate()

  return (
    <div className="page aipractice-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🏆 每日一练</h1>
      </header>
      <p className="module-hint">
        每天练一练：语文、数学、英语各自选一个入口，坚持就会有进步！
      </p>

      <button className="english-mode-card" onClick={() => navigate("/module/daily_chinese")}>
        <span className="english-mode-icon">📖</span>
        <span className="english-mode-body">
          <b>语文</b>
          <span>练字 · 练词 · 练句 · 主题作文，每天一练</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </button>

      <button className="english-mode-card" onClick={() => navigate("/module/ai_homework")}>
        <span className="english-mode-icon">🧮</span>
        <span className="english-mode-body">
          <b>数学</b>
          <span>拍照/输入题目，AI 讲解思路，口述批改</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </button>

      <button className="english-mode-card" onClick={() => navigate("/module/daily_english")}>
        <span className="english-mode-icon">🇬🇧</span>
        <span className="english-mode-body">
          <b>英语</b>
          <span>单词 · 句子 · 发音评测，每日英语练习</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </button>
    </div>
  )
}