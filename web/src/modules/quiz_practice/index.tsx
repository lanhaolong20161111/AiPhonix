/** Quiz 练习页 — 导入题目的选择题练习 */

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { fetchImports, type UserImportItem } from "../../services/userImports"

interface QuizQuestion {
  id: number
  stem: string
  options: string[]
  answer: string
  explanation: string
  type: string
}

function parseQuiz(item: UserImportItem): QuizQuestion | null {
  const stem = item.text.trim()
  if (!stem) return null
  let options: string[] = []
  let answer = ""
  let explanation = ""
  let type = ""
  if (item.payload) {
    try {
      const p = JSON.parse(item.payload)
      if (Array.isArray(p.options)) options = p.options.map(String)
      answer = String(p.answer ?? "")
      explanation = String(p.explanation ?? "")
      type = String(p.type ?? "")
    } catch {
      /* 忽略 */
    }
  }
  if (options.length < 2) return null
  return { id: item.id, stem, options, answer, explanation, type }
}

export function QuizPracticePage() {
  const navigate = useNavigate()
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [correct, setCorrect] = useState(0)
  const [checked, setChecked] = useState(false)
  const [finished, setFinished] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const data = await fetchImports("quiz")
        const qs = data.map(parseQuiz).filter((x): x is QuizQuestion => x !== null)
        setQuestions(qs)
      } catch {
        /* 忽略 */
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="page center-page"><p className="empty">加载题目…</p></div>
  if (questions.length === 0) return <div className="page center-card"><p className="empty">还没有选择题，先去「导入中心」添加</p><button className="btn-secondary" onClick={() => navigate(-1)}>返回</button></div>

  const q = questions[index]

  const check = () => {
    setChecked(true)
    if (selected === q.answer) setCorrect((c) => c + 1)
  }

  const next = () => {
    if (index + 1 >= questions.length) {
      setFinished(true)
      return
    }
    setIndex((i) => i + 1)
    setSelected(null)
    setChecked(false)
  }

  if (finished) {
    return (
      <div className="page center-card">
        <div style={{ fontSize: 44 }}>🏆</div>
        <h1 style={{ fontSize: 22, color: "#000" }}>完成！</h1>
        <p className="module-hint">答对 {correct} / {questions.length}</p>
        <button className="btn-primary" onClick={() => navigate(-1)}>返回</button>
      </div>
    )
  }

  return (
    <div className="page quiz-practice-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>题目练习</h1>
        <span className="module-level">{index + 1}/{questions.length}</span>
      </header>

      <div className="quiz-question card">
        <div className="quiz-stem">{q.stem}</div>
        <div className="quiz-options">
          {q.options.map((opt) => {
            const isAnswer = opt === q.answer
            const isSel = opt === selected
            let cls = "quiz-option"
            if (checked) {
              if (isAnswer) cls += " correct"
              else if (isSel) cls += " wrong"
            } else if (isSel) cls += " selected"
            return (
              <button
                key={opt}
                className={cls}
                disabled={checked}
                onClick={() => setSelected(opt)}
              >
                {opt}
              </button>
            )
          })}
        </div>
        {checked && (
          <>
            <p className={`quiz-result${selected === q.answer ? " good" : " bad"}`}>
              {selected === q.answer ? "✅ 回答正确！" : `❌ 正确答案：${q.answer}`}
            </p>
            {q.explanation && <p className="quiz-explanation">💡 {q.explanation}</p>}
          </>
        )}
        <div className="quiz-actions">
          {!checked ? (
            <button className="btn-primary" onClick={check} disabled={!selected}>
              提交答案
            </button>
          ) : (
            <button className="btn-primary" onClick={next}>
              {index + 1 >= questions.length ? "完成 ✓" : "下一题 →"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
