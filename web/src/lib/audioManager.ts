/** 全局音频管理器 — 同一时刻只允许一个音频播放；页面切换/卸载时自动中断
 *
 * 覆盖两类音频：
 * - 服务端 TTS（/tts/synthesize 返回的 MP3 blob → objectURL）
 * - 拼音部件音频（/pinyin-audio 静态 mp3）
 *
 * 规则：
 * 1. 播放中再次调用 playUrl → 返回 false（一次只能点一个）
 * 2. 页面卸载/路由切换 → 组件 cleanup 调 stop() 中断
 * 3. 播放自然结束/出错 → 自动复位
 *
 * 朗读卡拉OK：playUrl 传入朗读文本时，按字符类型加权估算时间线，
 * 随播放进度广播「当前正在读的字符」，UI 订阅后做逐字高亮。
 */

type Listener = (speaking: boolean) => void

/** 朗读进度状态：text=正在朗读的全文；charIndex=当前字符下标；char=当前字符 */
export interface ReadingState {
  text: string
  charIndex: number
  char: string
}

type ReadingListener = (s: ReadingState | null) => void

/** 单字符时长权重（相对值）：汉字 1，中文标点短停顿，英文字母约半拍 */
function charWeight(ch: string): number {
  if (/[\u4e00-\u9fff]/.test(ch)) return 1
  if (/[，。！？；：、""''（）《》〈〉…—～·]/.test(ch)) return 0.55
  if (/[a-zA-Z0-9]/.test(ch)) return 0.45
  if (ch === " " || ch === "\u3000") return 0.15
  return 0.3
}

interface TimelineItem {
  char: string
  start: number
  end: number
}

/** 归一化时间线（0..1）：emoji 等不可发音字符权重 0，不占时长 */
function buildTimeline(text: string): TimelineItem[] {
  const items: TimelineItem[] = []
  let total = 0
  for (const ch of [...text]) {
    const w = charWeight(ch)
    items.push({ char: ch, start: total, end: total + w })
    total += w
  }
  if (total <= 0) return []
  for (const it of items) {
    it.start /= total
    it.end /= total
  }
  return items
}

class AudioManager {
  private audio: HTMLAudioElement | null = null
  private listeners = new Set<Listener>()
  private _speaking = false
  private finishResolvers: Array<() => void> = []

  private readingListeners = new Set<ReadingListener>()
  private readingCleanup: (() => void) | null = null

  get speaking(): boolean {
    return this._speaking
  }

  /** 订阅全局朗读态，返回取消订阅函数 */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** 订阅朗读卡拉OK进度（正在读的字符）；无朗读时收到 null */
  subscribeReading(fn: ReadingListener): () => void {
    this.readingListeners.add(fn)
    return () => {
      this.readingListeners.delete(fn)
    }
  }

  private setSpeaking(v: boolean) {
    if (this._speaking === v) return
    this._speaking = v
    for (const fn of this.listeners) fn(v)
  }

  private setReading(s: ReadingState | null) {
    for (const fn of this.readingListeners) fn(s)
  }

  private clearReading() {
    if (this.readingCleanup) {
      this.readingCleanup()
      this.readingCleanup = null
    }
    this.setReading(null)
  }

  /** 启动卡拉OK进度：audio 的 timeupdate → 按时间线算当前字 */
  private startReading(text: string, audio: HTMLAudioElement) {
    const timeline = buildTimeline(text)
    if (timeline.length === 0) return
    const onTime = () => {
      const dur = audio.duration
      const ratio = dur && isFinite(dur) && dur > 0 ? audio.currentTime / dur : 0
      let hit: TimelineItem | null = null
      for (const it of timeline) {
        if (it.start <= ratio && ratio < it.end) {
          hit = it
          break
        }
      }
      if (hit) this.setReading({ text, charIndex: timeline.indexOf(hit), char: hit.char })
    }
    audio.addEventListener("timeupdate", onTime)
    this.readingCleanup = () => {
      audio.removeEventListener("timeupdate", onTime)
      this.setReading(null)
    }
  }

  private resolveFinish() {
    const rs = this.finishResolvers
    this.finishResolvers = []
    for (const r of rs) r()
  }

  /** 播放完成 promise（当前音频自然结束 / 出错 / 被 stop 时 resolve） */
  waitFinish(): Promise<void> {
    if (!this._speaking) return Promise.resolve()
    return new Promise((resolve) => this.finishResolvers.push(resolve))
  }

  /**
   * 播放一个音频 URL。若已有音频在播放则拒绝（返回 false）。
   * 播放自然结束 / 出错 → 自动复位（通知所有 waitFinish 等待者）。
   * 不监听 pause——旧音频的 pause 事件可能误停新音频（竞态）。
   * @param readingText 朗读文本（传入则广播逐字朗读进度，供 UI 卡拉OK高亮）
   */
  playUrl(url: string, readingText?: string): boolean {
    if (this._speaking) return false
    const audio = new Audio(url)
    const finish = () => {
      if (this.audio === audio) {
        this.audio = null
        this.setSpeaking(false)
        this.clearReading()
        this.resolveFinish()
      }
    }
    audio.onended = finish
    audio.onerror = finish
    this.audio = audio
    this.setSpeaking(true)
    if (readingText) this.startReading(readingText, audio)
    audio.play().catch(finish)
    return true
  }

  /** 立即停止当前音频 */
  stop() {
    if (this.audio) {
      const a = this.audio
      this.audio = null
      a.onended = null
      a.onerror = null
      a.pause()
      a.src = ""
      this.setSpeaking(false)
      this.clearReading()
      this.resolveFinish()
    }
  }
}

export const audioManager = new AudioManager()
