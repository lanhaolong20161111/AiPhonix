/** 偏旁魔法屋 — 换偏旁识字游戏
 *
 * 口诀：声旁猜读音，形旁猜意思。
 * 题型：
 * - 选字填空：给词语空位 + 偏旁提示，从同族字里选对的（同族字互为干扰项，正是易混点）
 * - 选偏旁：给一个字，选出它的偏旁
 * 每题答完显示讲解（形旁含义 + 读音例外标注），全部字可点读。
 */

import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTts } from "../../hooks/useTts"
import { getRadicalRiddles, getRadicalSong } from "./radical"
import { RADICAL_FAMILIES, type RadicalItem } from "./radicalFamilies"

interface Question {
  kind: "pickChar" | "pickRadical" | "riddle"
  /** 题干：选字填空=挖空的词语；选偏旁=目标字 */
  stem: string
  /** 选字填空的完整词语（讲解用） */
  word: string
  item: RadicalItem
  options: string[]
  answer: string
}

type Phase = "select" | "song" | "quiz" | "done"

/** 小豆陪玩反应池（按对错与连击抽取，零实时 LLM 调用） */
const XIAODOU = {
  streak: ["小豆：老师你太厉害啦！教教我！", "小豆：哇，连都对！我要拜师！", "小豆：这也太简单了吧（崇拜脸）"],
  correct: ["小豆：恭喜恭喜！我也要加油！", "小豆：学会啦学会啦！", "小豆：嘿嘿，我也记住了"],
  wrong: ["小豆：没关系，我以前也老写错这个字！", "小豆：这个字确实容易混，再来一次！", "小豆：错错更健康，记住就对啦"],
}

const RADICAL_MEANING = (r: string, name: string) => `${r}（${name}）`

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 字谜模式：谜面为题干，选项为全族字 */
function buildRiddleQuiz(family: (typeof RADICAL_FAMILIES)[number], riddles: Array<{ riddle: string; answer: string }>): Question[] {
  return riddles.map((r) => ({
    kind: "riddle" as const,
    stem: r.riddle,
    word: r.answer,
    item: family.items.find((x) => x.char === r.answer) ?? { ...family.items[0], char: r.answer },
    options: shuffle(family.items.map((x) => x.char)),
    answer: r.answer,
  }))
}

/** 生成 8 道混合题 */
function buildQuiz(): Question[] {
  const questions: Question[] = []
  const allItems = RADICAL_FAMILIES.flatMap((f) => f.items.map((it) => ({ ...it, base: f.base })))

  // 题型 A ×5：选字填空（同族字做干扰项）
  const pickFamilies = shuffle(RADICAL_FAMILIES).slice(0, 5)
  for (const fam of pickFamilies) {
    const it = fam.items[Math.floor(Math.random() * fam.items.length)]
    const distractors = fam.items.filter((x) => x.char !== it.char).map((x) => x.char).slice(0, 3)
    if (distractors.length < 3) continue
    const blanked = it.word.includes(it.char) ? it.word.replace(it.char, "（　）") : `（　）${it.word}`
    questions.push({
      kind: "pickChar",
      stem: blanked,
      word: it.word,
      item: it,
      options: shuffle([it.char, ...distractors]),
      answer: it.char,
    })
  }

  // 题型 B ×3：选偏旁
  const radTargets = shuffle(allItems).slice(0, 3)
  const radicalPool = [...new Set(allItems.map((x) => x.radical))]
  for (const it of radTargets) {
    const distractors = radicalPool.filter((r) => r !== it.radical)
    questions.push({
      kind: "pickRadical",
      stem: it.char,
      word: it.word,
      item: it,
      options: shuffle([it.radical, ...shuffle(distractors).slice(0, 3)]),
      answer: it.radical,
    })
  }

  return questions
}

export function RadicalGamePage() {
  const navigate = useNavigate()
  const { speaking, speak } = useTts()
  const [phase, setPhase] = useState<Phase>("select")
  const [familyIdx, setFamilyIdx] = useState<number | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [qIdx, setQIdx] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [score, setScore] = useState(0)
  const [songText, setSongText] = useState<string | null>(null)
  const [songLoading, setSongLoading] = useState(false)
  const [riddleLoading, setRiddleLoading] = useState(false)
  const [, setStreak] = useState(0)
  const [xiaodou, setXiaodou] = useState<string | null>(null)

  const q = questions[qIdx]

  const startFamily = (idx: number | null) => {
    setFamilyIdx(idx)
    setQuestions(buildQuiz())
    setQIdx(0)
    setPicked(null)
    setScore(0)
    setPhase("quiz")
  }

  // AI 儿歌：进入儿歌视图（服务端按字族缓存，首次生成稍慢；失败带冷却期，不反复烧 LLM）
  const openSong = (idx: number) => {
    const fam = RADICAL_FAMILIES[idx]
    setFamilyIdx(idx)
    setSongText(null)
    setSongLoading(true)
    setPhase("song")
    void getRadicalSong(fam.base, fam.base, fam.items.map((x) => x.char))
      .then(({ song, failed }) => {
        setSongText(
          song || (failed ? "儿歌还在赶工，等一会儿再来看看" : "AI 老师走神了，再点一次试试")
        )
      })
      .catch(() => setSongText("网络不太好，再点一次试试"))
      .finally(() => setSongLoading(false))
  }

  // 字谜挑战模式：谜面为题干，选项为全族字
  const startRiddles = (idx: number) => {
    const fam = RADICAL_FAMILIES[idx]
    setFamilyIdx(idx)
    setRiddleLoading(true)
    setQIdx(0)
    setPicked(null)
    setScore(0)
    setPhase("quiz")
    void getRadicalRiddles(fam.base, fam.items.map((x) => x.char), 4)
      .then((riddles) => {
        if (riddles.length === 0) {
          setQuestions(buildQuiz()) // 没拿到谜面退回普通题
        } else {
          setQuestions(buildRiddleQuiz(fam, riddles))
        }
        setRiddleLoading(false)
      })
      .catch(() => {
        setQuestions(buildQuiz())
        setRiddleLoading(false)
      })
  }

  const pick = (opt: string) => {
    if (picked || !q) return
    setPicked(opt)
    if (opt === q.answer) {
      setScore((s) => s + 1)
      setStreak((n) => {
        const next = n + 1
        const pool = next >= 3 ? XIAODOU.streak : XIAODOU.correct
        setXiaodou(pool[Math.floor(Math.random() * pool.length)])
        return next
      })
    } else {
      setStreak(0)
      setXiaodou(XIAODOU.wrong[Math.floor(Math.random() * XIAODOU.wrong.length)])
    }
    // pickChar 读整词（无拼音）；其余读单字（有拼音，可注音锁定多音字）
    const isPickChar = q.kind === "pickChar"
    void speak(isPickChar ? q.word : q.item.char, isPickChar ? undefined : { pinyin: q.item.pinyin })
  }

  const next = useCallback(() => {
    if (qIdx + 1 >= questions.length) {
      setPhase("done")
    } else {
      setQIdx((i) => i + 1)
      setPicked(null)
      setXiaodou(null)
    }
  }, [qIdx, questions.length])

  const correct = picked === q?.answer
  const fam = familyIdx != null ? RADICAL_FAMILIES[familyIdx] : null

  return (
    <div className="page wordbook-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🔮 偏旁魔法屋</h1>
      </header>

      {phase === "select" && (
        <>
          <div className="card radical-motto">
            <p className="radical-motto-main">声旁猜读音，形旁猜意思</p>
            <p className="radical-motto-sub">同一个字加不同偏旁，就变成新字：抱、饱、泡、炮都读 bao，偏旁告诉你它和什么有关</p>
          </div>
          <button className="card radical-family-card" style={{ width: "100%" }} onClick={() => startFamily(null)}>
            <span className="radical-family-base">🎲</span>
            <span className="radical-family-info">
              <b>混合挑战</b>
              <small>全部字族随机 8 题，敢来吗？</small>
            </span>
          </button>
          {RADICAL_FAMILIES.map((f, i) => (
            <div key={f.base} className="card radical-family-card" style={{ width: "100%" }}>
              <button className="radical-family-main" onClick={() => startFamily(i)}>
                <span className="radical-family-base">{f.base}</span>
                <span className="radical-family-info">
                  <b>{f.items.map((x) => x.char).join(" ")}</b>
                  <small>读 {f.pinyin} · {f.items.length} 个字</small>
                </span>
                <span className="radical-family-arrow">→</span>
              </button>
              <div className="radical-family-mini">
                <button
                  className="radical-mini-btn"
                  disabled={songLoading}
                  onClick={() => openSong(i)}
                  title="AI 编儿歌（读给你听）"
                >
                  🎵 儿歌
                </button>
                <button
                  className="radical-mini-btn"
                  disabled={riddleLoading}
                  onClick={() => startRiddles(i)}
                  title="AI 字谜挑战"
                >
                  🧩 字谜
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {phase === "song" && (
        <div className="card radical-songcard">
          <p className="radical-qtitle">
            🎵 AI 老师为「{familyIdx != null ? RADICAL_FAMILIES[familyIdx].base : ""}」编的儿歌
          </p>
          {songLoading ? (
            <p className="empty">AI 老师正在编儿歌…（第一次会慢一点）</p>
          ) : (
            <>
              <p className="radical-song">
                {(songText ?? "").split("\n").map((line, i) => (
                  <span key={i} className="radical-song-line">
                    {line}
                  </span>
                ))}
              </p>
              <div className="ai-chat-actions">
                <button className="ai-chat-speak" disabled={speaking} onClick={() => void speak(songText ?? "", { speaker: "3" })}>
                  🧙 听爷爷读
                </button>
                <button className="ai-chat-speak" disabled={speaking} onClick={() => void speak(songText ?? "", { speaker: "0" })}>
                  🧑‍🏫 听老师读
                </button>
                <button className="btn-primary btn-sm" style={{ width: "auto" }} onClick={() => startFamily(familyIdx)}>
                  开始答题 →
                </button>
              </div>
              <p className="radical-motto-sub">儿歌里藏着这一族所有的字，读的时候找找看！</p>
            </>
          )}
        </div>
      )}

      {phase === "quiz" && q && (
        <>
          <div className="radical-progress">
            第 {qIdx + 1} / {questions.length} 题 · ⭐ {score}
          </div>

          {q.kind === "riddle" ? (
            <div className="card radical-qcard">
              <p className="radical-qtitle">🧩 字谜：猜猜是哪个字？</p>
              <p className="radical-riddle">{q.stem}</p>
            </div>
          ) : q.kind === "pickChar" ? (
            <div className="card radical-qcard">
              <p className="radical-qtitle">选出正确的字：</p>
              <p className="radical-word">{q.stem}</p>
              <div className="radical-hint">
                偏旁 {RADICAL_MEANING(q.item.radical, q.item.radicalName)} · {q.item.radicalMeaning}
              </div>
            </div>
          ) : (
            <div className="card radical-qcard">
              <p className="radical-qtitle">「{q.stem}」的偏旁是什么？</p>
              <button className="radical-bigchar" disabled={speaking} onClick={() => void speak(q.stem)}>
                {q.stem}
              </button>
            </div>
          )}

          <div className="radical-options">
            {q.options.map((opt) => {
              const isAnswer = opt === q.answer
              const isPicked = picked === opt
              const cls = picked
                ? isAnswer
                  ? "radical-opt correct"
                  : isPicked
                    ? "radical-opt wrong"
                    : "radical-opt dim"
                : "radical-opt"
              return (
                <button key={opt} className={cls} disabled={!!picked} onClick={() => pick(opt)}>
                  {opt}
                </button>
              )
            })}
          </div>

          {picked && (
            <div className={`card radical-feedback ${correct ? "ok" : "bad"}`}>
              <p className="radical-feedback-title">
                {correct ? "🎉 答对了！" : `❌ 正确答案是「${q.answer}」`}
              </p>
              <p className="radical-feedback-body">
                <b>{q.item.char}</b> 读 {q.item.pinyin}，{q.item.radical}（{q.item.radicalName}）{q.item.radicalMeaning}
                ，如「{q.item.word}」
                {q.item.exception ? `。⚠️ ${q.item.exception}` : "。读音和声旁很接近"}
              </p>
              {xiaodou && <p className="xiaodou-react">🧒 {xiaodou}</p>}
              <div className="ai-chat-actions">
                <button
                  className="ai-chat-speak"
                  disabled={speaking}
                  onClick={() => void speak(q.item.char, { pinyin: q.item.pinyin })}
                >
                  🔊 读 {q.item.char}
                </button>
                <button className="ai-chat-speak" disabled={speaking} onClick={() => void speak(q.item.word)}>
                  🔊 读 {q.item.word}
                </button>
                <button className="btn-primary btn-sm" style={{ width: "auto" }} onClick={next}>
                  {qIdx + 1 >= questions.length ? "看结果 →" : "下一题 →"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {phase === "done" && (
        <div className="card radical-done">
          <div style={{ fontSize: 44 }}>
            {score === questions.length ? "🏆" : score >= questions.length * 0.7 ? "🎉" : "💪"}
          </div>
          <p className="radical-done-score">
            {score} / {questions.length}
          </p>
          <p className="radical-done-text">
            {score === questions.length
              ? "全对！你就是偏旁小魔法师！"
              : score >= questions.length * 0.7
                ? "很棒！记住口诀：声旁猜读音，形旁猜意思"
                : "多练几遍就熟啦，偏旁是识字的魔法钥匙"}
          </p>
          <div className="wordbook-btns">
            <button className="btn-primary" onClick={() => startFamily(familyIdx)}>再来一轮</button>
            <button className="btn-secondary" onClick={() => setPhase("select")}>选别的字族</button>
          </div>
        </div>
      )}

      {phase === "select" && fam && (
        <p className="module-hint">当前字族：{fam.base}（{fam.pinyin}）</p>
      )}
    </div>
  )
}
