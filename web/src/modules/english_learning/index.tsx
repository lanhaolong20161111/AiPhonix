/** 英语学习入口页 — 选择学习模式 */

import { Link } from "react-router-dom"

export function EnglishLearningPage() {
  return (
    <div className="page english-home">
      <header className="module-header">
        <Link to="/home" className="back-btn">←</Link>
        <h1>英语学习</h1>
      </header>
      <p className="module-hint">🇬🇧 选择学习模式</p>

      <Link to="/module/letters" className="english-mode-card">
        <span className="english-mode-icon">🔤</span>
        <span className="english-mode-body">
          <b>26个英文字母</b>
          <span>学习字母的发音和书写</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>

      <Link to="/module/phoneme-index" className="english-mode-card">
        <span className="english-mode-icon">📖</span>
        <span className="english-mode-body">
          <b>自然拼读 / 音素</b>
          <span>通过拼读规则学习发音</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>

      <Link to="/module/char_image/practice?type=%E8%8B%B1%E8%AF%8D" className="english-mode-card">
        <span className="english-mode-icon">🗣️</span>
        <span className="english-mode-body">
          <b>词汇练习</b>
          <span>英语单词 + 图片记忆</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>

      <Link to="/module/char_image/practice?type=%E8%8B%B1%E5%8F%A5" className="english-mode-card">
        <span className="english-mode-icon">💬</span>
        <span className="english-mode-body">
          <b>英句跟读</b>
          <span>英语句子图片跟读</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>

      <Link to="/module/video_practice" className="english-mode-card">
        <span className="english-mode-icon">🎬</span>
        <span className="english-mode-body">
          <b>视频跟读</b>
          <span>看 Big Muzzy 动画模仿跟读</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>
    </div>
  )
}
