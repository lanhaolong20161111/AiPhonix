/** AI 陪我练主页 — 数学/语文入口 */

import { useNavigate } from "react-router-dom"

export function AiPracticePage() {
  const navigate = useNavigate()

  return (
    <div className="page aipractice-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🤖 AI 陪我练</h1>
      </header>
      <p className="module-hint">
        导入一段学习主题，AI 一步步引导你练习（认读 → 理解 → 运用），回答正确有表扬，错误会纠正。
      </p>

      <button className="english-mode-card" onClick={() => navigate("/module/ai_homework")}>
        <span className="english-mode-icon">🧮</span>
        <span className="english-mode-body">
          <b>数学</b>
          <span>拍照或输入题目，AI 拆关键条件；说出思路，AI 帮你批改</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </button>

      <button className="english-mode-card" onClick={() => navigate("/module/ai_chinese")}>
        <span className="english-mode-icon">📖</span>
        <span className="english-mode-body">
          <b>语文</b>
          <span>输入课文/题目，AI 拆关键句；说说理解，AI 帮你评判</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </button>

      <button className="english-mode-card" onClick={() => navigate("/module/ai_english")}>
        <span className="english-mode-icon">📚</span>
        <span className="english-mode-body">
          <b>英语</b>
          <span>拍照识别英语课文，可逐字点读、整段朗读（暂用语文识别通道，后续精修）</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </button>
    </div>
  )
}
