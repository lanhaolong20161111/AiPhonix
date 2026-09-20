/** AI 英语对话陪练页 — 跟读为主（两种回答模式）
 *
 * 链路：设置词句 → /llm/en-dialogue-setup 生成剧情(台词+目标句+hint_words) → 每轮：
 *   AI 台词(EnglishWordTap 点读 + 中文翻译 + 🔊整句 TTS) → 回答。
 *
 * ★ 回答模式（2026-09-16）——**默认「🧗 跟读模式」**：
 *   AI **直接给出这一轮该说的回答**（`line.target`，显示 + 中文翻译 + 领读），
 *   孩子不自己组织语言、也不点「录音识别自己的回答」，而是**照着 AI 的回答跟读**，
 *   用 EchoLadder 逐词扩长（第 1 遍读第 1 个词 → 第 2 遍读前 2 个词 → … → 整遍读整句），
 *   每一级 SOE ≥70 才进下一级，整句过关才出现「下一轮 →」。
 *   每轮顺序：AI 问句(领读) → 回答整句(领读) → 第1词(阶梯领读) → 孩子跟读 → 前2词 → …
 *   ⚠️ speak() 是**全局互斥**的（并发调用直接被拒），所以这几段朗读必须**串行 await**；
 *   audioManager.waitFinish() 在 _speaking 复位后才 resolve，故 await 结束即可安全开下一段。
 *
 *   「🎤 自己回答」为可选旧流程：孩子自由说（百度 ASR en 流式）→ 停顿 2s 逐词提示
 *   （提示文本逐行保留、句子＝先英文后中文）→ 点红色「⏹ 结束」→ /llm/en-answer-judge 判定
 *   → ✅ 表扬 / ❌ 显示并朗读正确句 + 跟读阶梯。6s 完全没出过声时自动挂同一套逐词阶梯。
 *
 * 「📷 拍照识词」模块（2026-09-15）：拍课本/单词表/练习册 → 整页识别 → 抽出所有单词与句子
 * → 勾选回填「练习单词 / 练习句子」→ 交给同一个剧情引擎出题对话。
 *
 * 状态：idle（绿·开始）/ recording（红·结束）/ hinting（灰·提示中，自动恢复）/
 *       judging（AI 评分中）。词级评测已移除（评测会分散注意力），只保留整句/阶梯评测。
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { useNavigate } from "react-router-dom"
import { EnglishWordTap } from "../components/EnglishWordTap"
import { PhonicsToggle } from "../components/PhonicsWord"
import { EchoLadder } from "../components/EchoLadder"
import { EnVocabPhotoSheet } from "../components/EnVocabPhotoSheet"
import { useEnglishTurn } from "../hooks/useEnglishTurn"
import { useTts } from "../hooks/useTts"
import { enDialogueSetup, enAnswerJudge, type DialogueLine, type DialogueScript } from "../services/englishTalk"
import { fetchSentenceInfo, fetchWordInfo } from "../services/dailyEn"
import { lookupWordZhSync } from "../services/wordbankEnglish"
import { prepareImageFile } from "../lib/imageCompress"
import { detailFromError } from "../services/auth"

type Phase = "idle" | "recording" | "hinting" | "reading" | "judging"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** chunks 兜底：后端没给意群时按 2~3 词一组（弱词不领句） */
function fallbackChunks(sentence: string): string[] {
  const words = sentence.split(/\s+/).map((w) => w.trim()).filter(Boolean)
  const weak = new Set(["to", "the", "a", "an", "and", "of", "for", "with", "in", "on", "at", "is", "are"])
  const out: string[] = []
  let cur: string[] = []
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i])
    const next = words[i + 1]
    const boundary = cur.length >= 3 || (next !== undefined && !weak.has(next.toLowerCase()) && !weak.has(words[i].toLowerCase()))
    if (boundary && cur.length) {
      out.push(cur.join(" "))
      cur = []
    }
  }
  if (cur.length) out.push(cur.join(" "))
  return out.length ? out : [sentence]
}

/** 只保留英文部分：若文本里混入了中文翻译后缀，裁掉（防 AI 台词"英文+中文翻译"被一起朗读） */
function englishOnly(t: string): string {
  const i = t.search(/[\u4e00-\u9fff]/)
  return i > 0 ? t.slice(0, i).trim() : t.trim()
}

/** 英语单词切分（丢标点）：跟读阶梯的逐词单位 = 第1词 / 前2词 / … / 整句 */
const EN_WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g
function splitWords(s: string): string[] {
  return s.match(EN_WORD_RE) ?? []
}

/** 回答模式：echo=AI 直接给回答并逐词跟读（默认）；free=孩子自己说（旧录音流程） */
type AnswerMode = "echo" | "free"
/** 领读硬超时：底层播放 promise 万一不返回，也不让「先领读 → 再跟读」卡死 */
const READ_TIMEOUT_MS = 15_000
/** 整句中文翻译的等待上限（英文→中文连读用）；到点仍拿不到就只读英文，并打警告留痕 */
const ZH_READ_TIMEOUT_MS = 20_000

export function AiEnglishTalkPage() {
  const navigate = useNavigate()
  const { speak, stop: stopSpeak } = useTts()

  /** 朗读一段文本直到播完（含硬超时）；**被全局锁拒了就等一下重试**（最多 6 次 ≈ 3s）。
   *  返回 true = 读完了（或超时兜底放行）；false = 一直抢不到全局朗读锁、这段被跳过。
   *  speak() 是全局互斥的——并发调用会被**直接拒掉**。同轮还有另一段朗读在飞时
   *  （用户连点切模式、上一段还没播完就进了下一段），若就此罢休会把这段朗读**静默吞掉**：
   *  孩子什么都没听到，而「先领读、再跟读」的承诺就落空了。 */
  const speakRetry = async (text: string): Promise<boolean> => {
    for (let i = 0; i < 6; i++) {
      const r = await Promise.race([
        speak(text).then((ok) => ({ ok, hung: false })),
        new Promise<{ ok: boolean; hung: boolean }>((res) =>
          setTimeout(() => res({ ok: false, hung: true }), READ_TIMEOUT_MS),
        ),
      ])
      if (r.ok) return true
      if (r.hung) {
        // 播放 promise 迟迟不返回 = 全局朗读锁被上一段音频卡住
        // （MSE 流式播放偶发不触发 ended）。不主动释放的话，**之后每一段朗读都会被
        // 静默拒掉**，孩子整轮对话都听不到声音。宁可截断这一段，也不能让后面全哑。
        stopSpeak()
        console.warn("[talk] 朗读超时未结束，已强制释放朗读锁：", text)
        return true
      }
      await sleep(500) // 被拒：等正在播的那段让出全局朗读锁
    }
    console.warn("[talk] 朗读被全局朗读锁连续拒绝，这段跳过：", text)
    return false
  }

  /** 串行领读：await 到播放结束才返回。
   *  所以「AI 问句 → 回答整句 → 阶梯第1级」这几段朗读靠它串起来，不会被并发拒掉。 */
  const speakAwait = async (t: string): Promise<void> => {
    const en = englishOnly(t)
    if (!en) return
    await speakRetry(en)
  }

  // 设置
  const [topic, setTopic] = useState("")
  const [wordsText, setWordsText] = useState("")
  const [sentencesText, setSentencesText] = useState("")
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState("")

  // ── 📷 拍照识词：拍照/相册 → 整页识别 → 勾选单词句子 → 回填上面两个输入框 ──
  const cameraRef = useRef<HTMLInputElement | null>(null)
  const albumRef = useRef<HTMLInputElement | null>(null)
  /** 待识别的图片（已转正压缩）；非空 = 打开识词弹层 */
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  /** 图片转正/压缩中（防止连点两次） */
  const [preparingPhoto, setPreparingPhoto] = useState(false)
  /** 识图结果提示（成功绿 / 失败黄） */
  const [vocabMsg, setVocabMsg] = useState("")
  const [vocabWarn, setVocabWarn] = useState(false)

  /** 选图/拍照 → 转正+压缩（预览图也是正的）→ 打开识词弹层。
   *  识别本身由弹层负责（整页识别，无需手动框选）。 */
  const onPickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = "" // 允许连续选同一张
    if (!f) return
    setPreparingPhoto(true)
    setVocabMsg("")
    try {
      let prepared: File | Blob = f
      try {
        prepared = await prepareImageFile(f, 1600, 0.85)
      } catch {
        prepared = f
      }
      setPhotoFile(prepared instanceof File ? prepared : new File([prepared], "photo.jpg", { type: prepared.type || "image/jpeg" }))
    } catch (err) {
      setVocabWarn(true)
      setVocabMsg(`读取图片失败：${detailFromError(err)}`)
    } finally {
      setPreparingPhoto(false)
    }
  }

  /** 识词弹层点「✓ 用这些词句出题」：回填输入框（用户可再改），不自动开始 */
  const onVocabDone = (words: string[], sentences: string[]) => {
    if (words.length) setWordsText(words.join(", "))
    if (sentences.length) setSentencesText(sentences.join("\n"))
    setPhotoFile(null)
    const empty = !words.length && !sentences.length
    setVocabWarn(empty)
    setVocabMsg(
      empty
        ? "没抽到单词或句子，请换一张更清晰的照片。"
        : `✅ 已填入 ${words.length} 个单词、${sentences.length} 个句子（可修改），点下方「✨ 开始对话」让 AI 出题`,
    )
  }

  // 剧情
  const [script, setScript] = useState<DialogueScript | null>(null)
  const [turn, setTurn] = useState(0) // 当前轮
  /** 每轮 AI 台词自动中文翻译（key=轮次，懒加载） */
  const [lineZh, setLineZh] = useState<Record<number, string>>({})
  const zhFetchRef = useRef<Record<number, boolean>>({})
  /** 正确句的中文翻译（自动） */
  const [correctZh, setCorrectZh] = useState("")

  // 提示词（只读不评）：每停顿提示一个词，提示文本逐行保留，每行自动带中文翻译
  const [hintRows, setHintRows] = useState<{ text: string; full: boolean; zh: string }[]>([])
  const hintCountRef = useRef(0)
  const hintWordsRef = useRef<string[]>([])
  const hintIdxRef = useRef(0)
  const lastHintTextRef = useRef("")
  /** 轮次序号：换轮/重开时 +1，作废上一轮还在飞的中文翻译请求 */
  const turnSeqRef = useRef(0)
  /** 本页会话内 英文→中文 缓存（跨轮复用，避免同句反复调 LLM 翻译） */
  const zhCacheRef = useRef<Map<string, string>>(new Map())
  /** 进行中的翻译请求（同一句并发只发一次） */
  const zhInflightRef = useRef<Map<string, Promise<string>>>(new Map())

  // 阶段
  const [phase, setPhase] = useState<Phase>("idle")
  const phaseRef = useRef<Phase>("idle")
  const setPh = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }
  const hintBusyRef = useRef(false)
  /** 整句提示已给过一次 → 本轮不再周期性提示/打断 ASR（孩子自由说到点结束） */
  const fullHintGivenRef = useRef(false)

  // 判定结果
  const [feedback, setFeedback] = useState<{ ok: boolean; praise: string; correct: string; said: string } | null>(null)
  const [judging, setJudging] = useState(false)
  const [errText, setErrText] = useState("")
  /** 错句区「跟读阶梯」是否展开 */
  const [ladderOpen, setLadderOpen] = useState(false)
  /** 逐词跟读阶梯：跟读模式每轮必挂；自由模式 6s 无话 / 错句修复时挂。
   *  done=true 表示整句已过关（等价于本轮答对）。 */
  const [guided, setGuided] = useState<{ sentence: string; units: string[]; done: boolean } | null>(null)
  /** 回答模式（默认跟读）；ref 版供异步流程读取，避免闭包拿到旧值 */
  const [answerMode, setAnswerMode] = useState<AnswerMode>("echo")
  const answerModeRef = useRef<AnswerMode>("echo")
  /** 「该这样回答」整句的中文翻译 */
  const [answerZh, setAnswerZh] = useState("")

  const line = script?.lines[turn]

  // 当前 AI 台词自动附带中文翻译（去掉翻译按钮）
  useEffect(() => {
    if (!line || lineZh[turn] !== undefined || zhFetchRef.current[turn]) return
    zhFetchRef.current[turn] = true
    let on = true
    // 走 fetchZhFor 而不是直接 fetchSentenceInfo：与「朗读完英文读中文」共用同一份缓存/在飞去重，
    // 同一句翻译全页只请求一次（预取已经发过的，这里直接命中）
    void fetchZhFor(englishOnly(line.ai), true)
      .then((zh) => {
        if (on) setLineZh((m) => ({ ...m, [turn]: zh || "（暂无翻译）" }))
      })
      .catch(() => {
        if (on) setLineZh((m) => ({ ...m, [turn]: "（暂无翻译）" }))
      })
      .finally(() => {
        zhFetchRef.current[turn] = false
      })
    return () => {
      on = false
    }
  }, [script, turn, line, lineZh])

  // ── 录音：onPause（说过话后停顿→逐词提示）与 onInitialSilence（6s 没出过声）经 ref 转发 ──
  const pauseHandlerRef = useRef<(saidSoFar: string) => void>(() => {})
  const initialSilenceRef = useRef<() => void>(() => {})
  const turnHook = useEnglishTurn({
    pauseMs: 2000,
    initialSilenceMs: 6000,
    onPause: (said) => pauseHandlerRef.current(said),
    onInitialSilence: () => initialSilenceRef.current(),
  })

  // ── 整句朗读：表扬/正确句；提示词走快速通道 ──
  const playLines = async (texts: string[]) => {
    for (const t of texts) {
      const en = englishOnly(t)
      if (!en) continue
      await speak(en)
    }
  }
  const speakHint = async (t: string) => {
    void speak(englishOnly(t)) // 快速通道（预生成命中 ~1s；未命中走百度实时合成）
  }

  /** 取英文（词/句）的中文翻译：先查本地课标词库（单词，同步秒出）→ 本页会话缓存 → 服务端缓存。
   *  同一句/词并发只发一次请求（提示行补显与「读中文」共用同一 promise）。 */
  const fetchZhFor = async (text: string, full: boolean): Promise<string> => {
    const ck = `${full ? "s" : "w"}:${text.trim().toLowerCase()}`
    const hitCache = zhCacheRef.current.get(ck)
    if (hitCache) return hitCache
    const inflight = zhInflightRef.current.get(ck)
    if (inflight) return inflight
    const task = (async (): Promise<string> => {
      try {
        if (!full) {
          const local = lookupWordZhSync(text)
          if (local) return local
        }
        const zh = full
          ? (await fetchSentenceInfo(text)).translation ?? ""
          : await fetchWordInfo(text).then((info) => info.translation || info.meaning || "")
        if (zh) zhCacheRef.current.set(ck, zh) // 同句/同词在后续轮次不再重复请求
        return zh
      } catch {
        return ""
      } finally {
        zhInflightRef.current.delete(ck)
      }
    })()
    zhInflightRef.current.set(ck, task)
    return task
  }

  /** 带超时的翻译查询：中文朗读不能因为翻译迟迟不来卡住整轮对话。
   *  ★ 上限给得很足（20s）：整句翻译是 LLM 实时生成（首次 3~8s，服务端排队时会更久），
   *  而这里超时的唯一后果就是**这句英文读完后不读中文了**——正是用户报过的问题。
   *  宁可英文读完后静默一两秒再读中文，也不能把中文静默跳过。
   *  录音此时是暂停的，多等几秒只是「提示中」多停一会，不会漏录。 */
  const fetchZhTimed = (text: string, full: boolean, ms = ZH_READ_TIMEOUT_MS): Promise<string> => {
    const local = full ? "" : lookupWordZhSync(text)
    if (local) return Promise.resolve(local)
    return Promise.race([
      fetchZhFor(text, full),
      new Promise<string>((r) => setTimeout(() => r(""), ms)),
    ])
  }

  /** 中文朗读：await 到播完才返回（含重试与硬超时）。返回 false = 这段没读出来。
   *  中文**不走 englishOnly**（否则纯中文会被裁成空串）；服务端按文本语言自动切中文音色（6221 度云萱）。 */
  const speakZhAwait = async (zh: string): Promise<boolean> => {
    const t = zh.trim()
    if (!t) return false
    return speakRetry(t)
  }

  /**
   * ★ 整句「英文 → 中文」连读（2026-09-16 用户要求：**朗读完英文接着读这句的中文翻译**）。
   * 页面上每一处**整句英文领读**都走它：AI 问句、该说的回答整句、提示整句、判错后的正确句。
   *
   * 两个要点：
   * 1. 翻译与英文朗读**并发**发起——英文本身要读 2~3s，整句翻译是 LLM 实时生成（首次 3~8s），
   *    并发后总等待 ≈ max(英文时长, 翻译时长) + 中文时长，而不是两者相加。
   * 2. 中文等不到（超时/失败）或已换轮 → **只读英文**，绝不卡住后面「领读 → 挂阶梯」的串行链路。
   *
   * ⚠️ speak() 全局互斥，所以必须 await 完英文再读中文；也正因如此不能「先跳过中文、等它到了再插播」，
   *    那样会和 EchoLadder 的第 1 级领读抢独占锁，孩子就听不到第一个词了。
   * @param seq 轮次序号；换轮/重开后作废在飞的中文朗读
   */
  const speakPair = async (t: string, seq?: number): Promise<void> => {
    const en = englishOnly(t)
    if (!en) return
    const zhPromise = fetchZhTimed(en, true) // 与英文朗读并发取
    await speakAwait(en)
    if (seq !== undefined && seq !== turnSeqRef.current) return
    const zh = await zhPromise
    if (seq !== undefined && seq !== turnSeqRef.current) return
    // 跳过中文时**必须留痕**：这条链路以前是静默失败的，用户只能反馈「没接着读中文」而查不出原因。
    if (!zh) {
      console.warn("[talk] 没拿到这句的中文翻译，跳过中文朗读：", en)
      return
    }
    if (!(await speakZhAwait(zh))) console.warn("[talk] 中文朗读失败：", zh)
  }

  /**
   * 朗读提示行：**先读英文，紧接着读中文**（用户要求「读完英语后接着读中文意思」）。
   * 只有整句提示行读中文——逐词提示读单个中文字（如「我」）没教学意义还占时长。
   * 中文等不到（超时/失败）就只读英文，不阻塞录音恢复。
   * @param rowIndex 该行在 hintRows 中的下标；换轮后下标可能被复用，故配合 turnSeq 校验
   */
  const readHintAloud = async (text: string, full: boolean, rowIndex?: number): Promise<void> => {
    const en = englishOnly(text)
    if (!en) return
    const seq = turnSeqRef.current
    const zhPromise = full ? fetchZhTimed(en, true) : Promise.resolve("") // 逐词提示不读中文
    await speakAwait(en)
    if (!full) return
    const zh = await zhPromise
    if (seq !== turnSeqRef.current) return
    if (!zh) {
      console.warn("[talk] 没拿到提示句的中文翻译，跳过中文朗读：", en)
      return
    }
    if (!(await speakZhAwait(zh))) console.warn("[talk] 提示句中文朗读失败：", zh)
    // 翻译是后到的 → 补写回该行，保证「提示句子的中文翻译」一定显示
    if (rowIndex !== undefined) {
      setHintRows((rows) => rows.map((r, i) => (i === rowIndex && !r.zh ? { ...r, zh } : r)))
    }
  }

  /** 追加提示词记录行（逐行保留）+ 自动懒加载中文翻译（整句/单词都补，单词走本地词库秒出） */
  const pushHintRow = (text: string, full: boolean) => {
    const idx = hintCountRef.current
    hintCountRef.current += 1
    const seq = turnSeqRef.current
    const local = full ? "" : lookupWordZhSync(text)
    setHintRows((rows) => [...rows, { text, full, zh: local }])
    if (local) return
    void fetchZhFor(text, full).then((zh) => {
      if (zh && seq === turnSeqRef.current) {
        setHintRows((rows) => rows.map((r, i) => (i === idx ? { ...r, zh } : r)))
      }
    })
  }

  /** 录音中主动点击 TTS 朗读：暂停 ASR（防录到扬声器）+ 冻结停顿计时，
   *  按钮灰置不可点；读完后停 1.2s 自动恢复录音继续计时。非录音中直接朗读。
   *
   *  ★ 多词（整句）走 speakPair：**英文读完接着读中文翻译**——与自动领读口径一致，
   *    否则「点 🔊 再读」只读英文，孩子以为中文连读没生效。
   *    单词点读（点句子里某个词）保持只读英文，追求点读手感。 */
  const playTts = async (t: string) => {
    const en = englishOnly(t)
    if (!en.trim()) return
    const full = /\s/.test(en)
    const wasRecording = phaseRef.current === "recording"
    if (wasRecording) {
      hintBusyRef.current = true
      setPh("reading")
      await turnHook.pause()
    }
    if (full) await speakPair(en)
    else await speak(en)
    if (wasRecording) {
      await sleep(1200)
      hintBusyRef.current = false
      if (phaseRef.current === "reading") {
        const resumed = await turnHook.resume().catch(() => false)
        if (resumed) setPh("recording")
        else {
          setPh("idle")
          setErrText("麦克风恢复失败，请点「开始录音」重试")
        }
      }
    }
  }

  /** 停顿处理：暂停 ASR → 提示下一个词并朗读 → 停 1.5s → 自动恢复录音。
   * 词提示完后给一次整句；整句给过就不再提示（不周期性打断 ASR）。 */
  const pauseHandler = async () => {
    const recNow: Phase = phaseRef.current
    if (recNow !== "recording" || hintBusyRef.current) return
    const target = line?.target ?? ""
    if (!target) return
    const words = hintWordsRef.current
    // 词已提示完 → 整句提示只给一次；之后停顿一律静默，让 ASR 连续工作到孩子点结束
    const isFull = hintIdxRef.current >= words.length
    if (isFull) {
      if (fullHintGivenRef.current) return
      fullHintGivenRef.current = true
    }
    hintBusyRef.current = true
    setPh("hinting")
    await turnHook.pause()

    let text = ""
    if (hintIdxRef.current < words.length) {
      text = words[hintIdxRef.current] // 逐词提示
      hintIdxRef.current += 1
    } else {
      text = target // 词提示完 → 提示一次整句
    }
    if (text && text !== lastHintTextRef.current) {
      lastHintTextRef.current = text
      const rowIdx = hintCountRef.current // pushHintRow 内会 +1，先记下写入下标
      pushHintRow(text, isFull)
      await readHintAloud(text, isFull, rowIdx) // 整句：英文读完接着读中文
    } else if (text) {
      await speakHint(text)
    }

    // 播完提示词停一下让 TA 消化，再自动切回 ASR 继续录
    await sleep(1500)
    hintBusyRef.current = false
    if (phaseRef.current === "hinting") {
      const resumed = await turnHook.resume().catch(() => false)
      if (resumed) setPh("recording")
      else {
        setPh("idle")
        setErrText("麦克风恢复失败，请点「开始录音」重试")
      }
    }
  }
  pauseHandlerRef.current = pauseHandler

  /** 6s 完全没出过声 → 不干等：先把整句显示并朗读，再进入「第1词→前2词→…整句」阶梯测评 */
  const startGuided = async () => {
    const cur: Phase = phaseRef.current
    if (cur !== "recording" || hintBusyRef.current || !line || guided) return
    hintBusyRef.current = true
    await turnHook.stop().catch(() => "")
    hintBusyRef.current = false
    const en = englishOnly(line.target)
    const words = splitWords(en)
    // 显示整句提示行（可重听，中文翻译异步补上），再「英文→中文」朗读，最后挂载单词阶梯
    const rowIdx = hintCountRef.current // pushHintRow 内会 +1，先记下写入下标
    pushHintRow(en, true)
    setPh("idle")
    setFeedback(null)
    await readHintAloud(en, true, rowIdx)
    setGuided({ sentence: en, units: words.length ? words : [en], done: false })
  }
  initialSilenceRef.current = () => {
    void startGuided()
  }

  /** 挂载逐词跟读阶梯：先领读整句回答（第 1 级由 EchoLadder 自己领读），读完再挂。
   *  ⚠️ 必须先 await 完领读再挂梯——阶梯挂载时会立刻领读第 1 级，
   *     若此时全局还在朗读（speak 互斥）会被直接拒掉，孩子就听不到第 1 个词。 */
  const armEcho = async (en: string, seq: number) => {
    if (!en) return
    void fetchZhFor(en, true).then((zh) => {
      if (seq === turnSeqRef.current) setAnswerZh(zh)
    })
    await speakPair(en, seq) // 整句领读：英文读完接着读中文翻译
    if (seq !== turnSeqRef.current) return // 已换轮/重开 → 作废
    const units = splitWords(en)
    setGuided({ sentence: en, units: units.length ? units : [en], done: false })
  }

  /** 进入一轮：跟读模式 = AI 问句领读 → 直接给回答并挂逐词阶梯；自由模式 = 只读 AI 问句 */
  const startTurnFlow = async (ln: DialogueLine | undefined, seq: number) => {
    if (!ln) return
    // 预取本轮两句的中文翻译：与问句朗读并发，避免「英文读完还在等翻译」的静默空档
    void fetchZhFor(englishOnly(ln.ai), true)
    void fetchZhFor(englishOnly(ln.target), true)
    if (answerModeRef.current === "free") {
      void speakPair(ln.ai, seq)
      return
    }
    await speakPair(ln.ai, seq) // AI 问句：英文读完接着读中文翻译
    if (seq !== turnSeqRef.current) return
    await armEcho(englishOnly(ln.target), seq)
  }

  /** 切到「自己回答」（本轮）：收起跟读阶梯，露出录音按钮 */
  const switchToFree = async () => {
    answerModeRef.current = "free"
    setAnswerMode("free")
    // ★ 作废还在飞的上一段领读：否则它读完英文还会接着读中文、再挂一次阶梯，
    //   与新流程抢全局朗读锁（speak 互斥）→ 两边都可能被静默拒掉、孩子听不到朗读。
    turnSeqRef.current += 1
    await turnHook.stop().catch(() => "")
    setGuided(null)
    setFeedback(null)
    setAnswerZh("")
    setErrText("")
    setPh("idle")
  }

  /** 切回「跟读」（本轮）：直接给回答 + 重新领读并挂阶梯 */
  const switchToEcho = async () => {
    answerModeRef.current = "echo"
    setAnswerMode("echo")
    turnSeqRef.current += 1 // 同上：作废在飞的旧领读，本次领读独占
    await turnHook.stop().catch(() => "")
    setGuided(null)
    setFeedback(null)
    setCorrectZh("")
    setErrText("")
    setPh("idle")
    const seq = turnSeqRef.current
    if (line) await armEcho(englishOnly(line.target), seq)
  }

  /** 绿色「开始录音」 */
  const startRecording = async () => {
    if (phaseRef.current !== "idle" || judging) return
    setErrText("")
    const ok = await turnHook.start()
    if (ok) {
      setPh("recording")
    } else if (!turnHook.state.error) {
      setErrText("开始录音失败，请检查麦克风权限")
    }
  }

  /** 红色「结束」→ 取整句 → AI 判定 → 朗读表扬/正确句 */
  const finishRecording = async () => {
    if (phaseRef.current !== "recording" || judging) return
    setJudging(true)
    setPh("judging")
    try {
      const said = await turnHook.stop()
      if (!said) {
        setPh("idle")
        setJudging(false)
        setErrText("没有听到内容，请再试一次")
        return
      }
      if (!line) {
        setPh("idle")
        setJudging(false)
        return
      }
      const res = await enAnswerJudge(line.target, said)
      setFeedback({ ok: res.ok, praise: res.praise, correct: res.correct, said })
      setLadderOpen(false)
      if (!res.ok && res.correct) {
        void fetchZhFor(res.correct, true).then(setCorrectZh) // 正确句自动翻译
      } else {
        setCorrectZh("")
      }
      if (res.ok) {
        await playLines([res.praise]) // ✅ 表扬朗读
      } else {
        await playLines([res.praise]) // ❌ 鼓励 + 正确句
        if (res.correct) await readHintAloud(res.correct, true) // 正确句：英文读完接着读中文
      }
    } catch {
      if (line) {
        setFeedback({ ok: false, praise: "Try again!", correct: line.target, said: "" })
        void fetchZhFor(line.target, true).then(setCorrectZh)
      }
    } finally {
      setJudging(false)
      setPh("idle")
    }
  }

  // ── 开始练习 ──
  const handleSetup = async () => {
    const words = wordsText.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
    const sentences = sentencesText.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    if (!words.length && !sentences.length && !topic.trim()) {
      setSetupError("请输入至少一个练习词 / 句子，或主题")
      return
    }
    setSettingUp(true)
    setSetupError("")
    try {
      const sc = await enDialogueSetup(topic.trim(), words, sentences)
      setScript(sc)
      setTurn(0)
      // 新一轮对话默认回到「跟读模式」（AI 直接给回答是主线），想自己说再当场切
      answerModeRef.current = "echo"
      setAnswerMode("echo")
      setFeedback(null)
      setErrText("")
      hintWordsRef.current = sc.lines[0]?.hint_words ?? []
      hintIdxRef.current = 0
      lastHintTextRef.current = ""
      fullHintGivenRef.current = false
      hintCountRef.current = 0
      turnSeqRef.current += 1
      setHintRows([])
      setLineZh({})
      zhFetchRef.current = {}
      zhCacheRef.current.clear() // 新剧情 → 清空翻译缓存
      zhInflightRef.current.clear()
      setCorrectZh("")
      setLadderOpen(false)
      setGuided(null)
      setAnswerZh("")
      setPh("idle")
      // ★ 后台预热后面几轮的翻译：剧情里每一句都是新句子，中文要走 LLM 实时翻译（3~8s）。
      //   不预热的话，「英文读完 → 接着读中文」中间会有好几秒静默，一轮轮听下来很卡。
      //   每轮的两句并发取、轮与轮之间串行，避免一次性打出去太多翻译请求。
      //   （第 1 轮由 startTurnFlow 立刻取，与 AI 问句的英文朗读并发，所以这边从 lines[1] 开始）
      void (async () => {
        for (const ln of sc.lines.slice(1)) {
          await Promise.all([
            fetchZhFor(englishOnly(ln.ai), true),
            fetchZhFor(englishOnly(ln.target), true),
          ]).catch(() => [])
        }
      })()
      // 首轮：AI 问句领读 →（跟读模式）直接给回答 + 逐词阶梯
      void startTurnFlow(sc.lines[0], turnSeqRef.current)
    } catch (e) {
      setSetupError(`生成失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setSettingUp(false)
    }
  }

  /** 重读当前 AI 台词（录音中会先暂停 ASR） */
  const reReadAi = () => {
    if (line?.ai) void playTts(line.ai)
  }

  // ── 下一轮 / 完成 ──
  const nextTurn = async () => {
    const next = turn + 1
    if (next < (script?.lines.length ?? 0)) {
      await turnHook.stop() // 停掉可能残留的录音
      setTurn(next)
      setFeedback(null)
      setErrText("")
      setCorrectZh("")
      setLadderOpen(false)
      setGuided(null)
      hintWordsRef.current = script!.lines[next].hint_words ?? []
      hintIdxRef.current = 0
      lastHintTextRef.current = ""
      fullHintGivenRef.current = false
      hintCountRef.current = 0
      turnSeqRef.current += 1
      setHintRows([])
      setAnswerZh("")
      setPh("idle")
      // 新一轮：AI 问句领读 →（跟读模式）直接给回答 + 逐词阶梯
      void startTurnFlow(script!.lines[next], turnSeqRef.current)
    } else {
      // 全部完成
      await turnHook.stop()
      setGuided(null)
      setScript(null)
      setTopic("")
      setWordsText("")
      setSentencesText("")
      setVocabMsg("")
    }
  }

  // ── 设置界面 ──
  if (!script) {
    const wordsCount = wordsText.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean).length
    const sentencesCount = sentencesText.split(/\n+/).map((s) => s.trim()).filter(Boolean).length
    return (
      <div className="page aihomework-page">
        <header className="module-header">
          <button className="back-btn" onClick={() => navigate(-1)}>←</button>
          <h1>🗣 AI 英语对话</h1>
        </header>

        {/* 📷 拍照识词：拍课本/单词表 → 整页识别 → 抽出单词与句子 → 回填下面两个输入框 */}
        <div className="card" style={{ padding: 16 }}>
          <div className="envocab-entry">
            <p className="envocab-entry-title">📷 拍照识词（推荐）</p>
            <p className="envocab-entry-hint">
              拍课本、单词表或练习册，AI 会把这一页的<strong>所有单词和句子</strong>都认出来，
              你再勾选要练的，AI 就按这些词句出题跟你对话。
            </p>
            <div className="envocab-entry-btns">
              <button
                className="envocab-entry-btn"
                disabled={preparingPhoto}
                onClick={() => cameraRef.current?.click()}
              >
                📷 拍照
              </button>
              <button
                className="envocab-entry-btn"
                disabled={preparingPhoto}
                onClick={() => albumRef.current?.click()}
              >
                🖼️ 相册
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPickPhoto(e)} />
            <input ref={albumRef} type="file" accept="image/*" hidden onChange={(e) => void onPickPhoto(e)} />
            {preparingPhoto && <p className="envocab-entry-hint" style={{ marginTop: 8, marginBottom: 0 }}>🖼️ 正在处理图片…</p>}
            {vocabMsg && <p className={`envocab-entry-msg${vocabWarn ? " warn" : ""}`}>{vocabMsg}</p>}
          </div>

          <p className="module-hint">也可以直接手写练习词句（场景可不填，AI 会自己挑合适的）。</p>
          <label style={{ fontWeight: 700 }}>主题 / 场景（可选，不填 AI 自动决定）</label>
          <input
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px" }}
            placeholder="如：在公园 / 去动物园 / 我的家人"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>练习单词（逗号或空格分隔）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 56, resize: "vertical" }}
            placeholder="如：apple, park, happy, run"
            value={wordsText}
            onChange={(e) => setWordsText(e.target.value)}
          />
          <label style={{ fontWeight: 700 }}>练习句子（每行一句，可选）</label>
          <textarea
            className="text-input"
            style={{ width: "100%", margin: "6px 0 12px", minHeight: 64, resize: "vertical" }}
            placeholder={"如：I like apples.\nCan I run in the park?"}
            value={sentencesText}
            onChange={(e) => setSentencesText(e.target.value)}
          />
          {setupError && <p className="err">{setupError}</p>}
          <button className="btn-primary" style={{ width: "100%" }} disabled={settingUp} onClick={() => void handleSetup()}>
            {settingUp
              ? "AI 出题中…"
              : wordsCount || sentencesCount
                ? `✨ 用这 ${wordsCount} 个词 / ${sentencesCount} 句开始对话`
                : "✨ 开始对话"}
          </button>
        </div>

        {/* 识词弹层：整页识别 → 勾选单词/句子 */}
        {photoFile && (
          <EnVocabPhotoSheet file={photoFile} onClose={() => setPhotoFile(null)} onDone={onVocabDone} />
        )}
      </div>
    )
  }

  // ── 对话界面 ──
  const recording = turnHook.state.recording
  const canStop = phase === "recording"

  return (
    <div className="page aihomework-page">
      <header className="module-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>🗣 {script.title || "英语对话"}</h1>
        <span style={{ fontSize: 13, color: "#536471" }}>{turn + 1}/{script.lines.length}</span>
        <PhonicsToggle />
      </header>

      {/* AI 台词气泡 */}
      {line && (
        <div className="talk-bubble ai">
          <div className="talk-bubble-label">🤖 AI · {topic || "对话"}</div>
          <div className="talk-bubble-text">
            <EnglishWordTap text={englishOnly(line.ai)} speakOverride={(w) => void playTts(w)} />
          </div>
          <div className="talk-bubble-ops">
            <button className="btn-secondary btn-sm" onClick={reReadAi}>🔊 再读</button>
          </div>
          {lineZh[turn] && <p className="talk-translation">{lineZh[turn]}</p>}
        </div>
      )}

      {/* 回答区（按模式切换内容）
          跟读模式：AI 直接给回答 + 逐词跟读阶梯（无需孩子点录音识别自己的回答）
          自己回答：两态录音（绿=开始/录音中，红=结束）+ AI 判定 */}
      <div className="card" style={{ marginTop: 10 }}>
        {answerMode === "echo" ? (
          <div className="talk-echo">
            <div className="talk-echo-head">
              <span className="talk-echo-title">💬 该这样回答（AI 直接给，你跟着读）</span>
              <button className="btn-secondary btn-sm" onClick={() => void switchToFree()}>🎤 我想自己说</button>
            </div>
            {line && (
              <>
                <div className="talk-echo-text">
                  <EnglishWordTap text={englishOnly(line.target)} speakOverride={(w) => void playTts(w)} />
                </div>
                {answerZh && <p className="talk-translation">{answerZh}</p>}
              </>
            )}
            <p className="module-hint">
              跟着 AI 一句一句读：第 1 遍只读第 1 个单词，第 2 遍读前 2 个单词，第 3 遍读前 3 个……一直读到整句读完。
              每遍读准（≥70 分）就自动进下一遍。
            </p>
            {guided?.done ? (
              <div className="talk-feedback ok" style={{ marginTop: 8 }}>
                <p className="talk-feedback-praise">✅ 整句跟读完成！点下方进入下一轮</p>
              </div>
            ) : guided ? (
              <EchoLadder
                sentence={guided.sentence}
                chunks={[]}
                units={guided.units}
                engine="16k_en"
                source="english_talk_echo"
                onFinished={() => setGuided((g) => (g ? { ...g, done: true } : g))}
                onSkip={() => setGuided((g) => (g ? { ...g, done: true } : g))}
              />
            ) : (
              <p className="talk-status busy" style={{ marginTop: 8 }}>
                <span className="talk-dot" /> 🔊 AI 正在领读整句回答，请先听…
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="module-hint" style={{ marginTop: 0 }}>
              听清 AI 的问题后，点「🎤 开始录音」说出你的回答。说完了点红色「⏹ 结束」，AI 来评分。
              <button className="btn-secondary btn-sm talk-mode-switch" onClick={() => void switchToEcho()}>
                🧗 回到跟读模式
              </button>
            </p>
            <div className="talk-live">
              <span className="speech-said">{turnHook.state.saidText}</span>
              {turnHook.state.interimText && <span className="speech-interim">{turnHook.state.interimText}</span>}
              {!turnHook.state.saidText && !turnHook.state.interimText && !turnHook.state.recording && (
                <span className="speech-placeholder">（还没说）</span>
              )}
            </div>

            {phase === "recording" && (
              <div className="talk-status go"><span className="talk-dot" /> 录音中… 说完了点下方红色结束</div>
            )}
            {phase === "hinting" && (
              <div className="talk-status busy"><span className="talk-dot" /> 🔊 提示中，请听提示词…</div>
            )}
            {phase === "reading" && (
              <div className="talk-status busy"><span className="talk-dot" /> 🔊 朗读中… 录音已暂停</div>
            )}
            {recording && (
              <div className="speech-level"><div className="speech-level-bar" style={{ width: `${Math.max(4, Math.min(100, turnHook.state.level * 100))}%` }} /></div>
            )}
            {errText && <p className="err">{errText}</p>}
            {turnHook.state.error && <p className="err">{turnHook.state.error}</p>}

            <div className="speech-actions">
              {phase === "idle" && !feedback && !judging && !guided ? (
                <button className="btn-lg talk-rec go" onClick={() => void startRecording()}>🎤 开始录音</button>
              ) : canStop ? (
                <button className="btn-lg talk-rec stop" onClick={() => void finishRecording()}>⏹ 结束</button>
              ) : phase === "hinting" ? (
                <button className="btn-lg talk-rec busy" disabled>🔊 提示中…</button>
              ) : phase === "reading" ? (
                <button className="btn-lg talk-rec busy" disabled>🔊 朗读中…</button>
              ) : null}
            </div>

            {/* 判定反馈 */}
            {judging && <p className="speech-completing">🤔 AI 在听你回答…</p>}
            {feedback && (
              <div className={`talk-feedback${feedback.ok ? " ok" : " no"}`}>
                {feedback.said && (
                  <p className="talk-feedback-said">
                    你说：{feedback.said}{/[.!?]$/.test(feedback.said.trim()) ? "" : "."}
                  </p>
                )}
                <p className="talk-feedback-praise">{feedback.ok ? "✅ " : ""}{feedback.praise}</p>
                {!feedback.ok && feedback.correct && (
                  <div className="talk-feedback-correct">
                    <div className="talk-correct-head">
                      <span>正确说法：</span>
                      <button className="btn-secondary btn-sm" onClick={() => void playTts(feedback.correct)}>🔊 再读</button>
                    </div>
                    <EnglishWordTap text={feedback.correct} speakOverride={(w) => void playTts(w)} />
                    {correctZh && <p className="talk-translation">{correctZh}</p>}
                    {/* 跟读阶梯：片段→扩长→整句（错句修复用） */}
                    {ladderOpen ? (
                      <EchoLadder
                        sentence={englishOnly(feedback.correct)}
                        chunks={line?.chunks ?? fallbackChunks(englishOnly(feedback.correct))}
                        engine="16k_en"
                        source="english_talk_ladder"
                        onFinished={() => { /* 完成：鼓励已内置播放 */ }}
                        onSkip={() => setLadderOpen(false)}
                      />
                    ) : (
                      <button
                        className="btn-secondary"
                        style={{ width: "100%", marginTop: 8, padding: "10px 14px" }}
                        onClick={() => setLadderOpen(true)}
                      >
                        🧗 跟读练习（从片段到整句）
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 提示词记录（逐行保留，每行可重听） */}
      {hintRows.length > 0 && (
        <div className="talk-hints card" style={{ marginTop: 8 }}>
          <div className="talk-hints-title">💡 提示记录</div>
          {hintRows.map((h, i) => (
            <div className="talk-hint-row" key={i}>
              <span className="talk-hint-no">{i + 1}</span>
              <span className="talk-hint-main">
                <span className="talk-hint-text">{h.full ? `（整句）${h.text}` : h.text}</span>
                {h.zh && <span className="talk-hint-zh">{h.zh}</span>}
              </span>
              <button className="btn-secondary btn-sm" onClick={() => void playTts(h.text)}>🔊</button>
            </div>
          ))}
        </div>
      )}

      {/* 6s 无话引导：整句单词阶梯测评（仅「自己回答」模式；
          跟读模式的阶梯在上面回答区里，别重复渲染） */}
      {guided && !feedback && answerMode === "free" && (
        <div className="card" style={{ marginTop: 8, padding: 10 }}>
          {guided.done ? (
            <div className="talk-feedback ok" style={{ marginTop: 0 }}>
              <p className="talk-feedback-praise">✅ 整句过关！点下方进入下一轮</p>
            </div>
          ) : (
            <EchoLadder
              sentence={guided.sentence}
              chunks={[]}
              units={guided.units}
              engine="16k_en"
              source="english_talk_guided"
              onFinished={() => setGuided((g) => (g ? { ...g, done: true } : g))}
              onSkip={() => setGuided(null)}
            />
          )}
        </div>
      )}

      {/* 下一轮 */}
      {(feedback || guided?.done) && (
        <button
          className="btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => void nextTurn()}
        >
          {turn + 1 < (script?.lines.length ?? 0) ? "下一轮 →" : "🎉 完成，再来一次"}
        </button>
      )}
    </div>
  )
}
