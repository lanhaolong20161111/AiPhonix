/** 看图识字词句入口页 — 选择学习模式 */

import { Link } from "react-router-dom"

export function CharImageEntryPage() {
  return (
    <div className="page english-home">
      <header className="module-header">
        <Link to="/home" className="back-btn">←</Link>
        <h1>看图识字词句</h1>
      </header>
      <p className="module-hint">📖 选择学习模式</p>

      <Link to="/module/char_image/practice?type=%E5%AD%97" className="english-mode-card">
        <span className="english-mode-icon">🔤</span>
        <span className="english-mode-body">
          <b>看图识字</b>
          <span>单字图片 · 拼音点读 · 录音评测</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>

      <Link to="/module/char_image/practice?type=%E8%AF%8D" className="english-mode-card">
        <span className="english-mode-icon">📝</span>
        <span className="english-mode-body">
          <b>看图识词</b>
          <span>词语图片 · 拼音点读 · 录音评测</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>

      <Link to="/module/char_image/practice?type=%E5%8F%A5" className="english-mode-card">
        <span className="english-mode-icon">💬</span>
        <span className="english-mode-body">
          <b>看图识句</b>
          <span>句子图片 · 拼音点读 · 录音评测</span>
        </span>
        <span className="english-mode-arrow">›</span>
      </Link>
    </div>
  )
}
