/** 识别结果会话 store — 图片识别完成后，从输入页跳转到独立结果页展示（内存态，刷新即清）
 *
 * 多张照片（2026-09-16）：一次选多张图时走 `pages` —— 每张一个 ParsePage，各自独立识别、
 * 独立 sessionId（问答/历史互不串味）。`session` 始终是**当前活动页的展开视图**，
 * 结果页只读 session（外加 pages 用于画「第 N 张」标签），因此单页时代码路径完全不变。
 */

import { create } from "zustand"
import type { CropItem, ParseImageResult, ParseStage, TextBlock } from "../services/aiImage"
import type { PosTagItem, StoryElementItem } from "../services/aichinese"

export interface ParseSession {
  /** 会话 id：问答 scope 前缀，识别/回看时生成（crypto.randomUUID） */
  sessionId: string
  module: "chinese" | "math" | "english"
  text: string
  questions: string[]
  blocks: TextBlock[]
  pageBounds: { left: number; top: number; right: number; bottom: number } | null
  /** 原图预览（objectURL，当前会话有效） */
  previewUrl: string
  /** 原图文件（重新识别 / 旋转用；历史回看时为 null） */
  file: File | Blob | null
  /** 带图提问时的初始问题（由输入框文本带入，结果页识别后自动问答） */
  initialQuestion?: string
  /** 是否为回看历史（点击历史条目进入），回看不应再次自动保存 */
  fromHistory?: boolean
  /** 纯文本多轮对话（回看历史对话时展示；正常识别无此字段） */
  turns?: { role: "user" | "assistant"; content: string }[]
  /** 页面按题目/区域裁剪的小图（Vision bbox 检测），前端附图对照 */
  crops?: CropItem[]
  /** 词性标注：语文按块下标、英语按题下标 → 该段词性（历史回看时由条目透传） */
  pos?: Record<number, PosTagItem[]>
  /** 文章要素标注：同上按块/题下标 → 该段要素 */
  story?: Record<number, StoryElementItem[]>
  // ⚠️ 多图批次（几张照片、每张什么状态）**刻意不放这里**：那是批次级信息，放 session 里
  //    就会出现「后台页完成但 session 没同步 → 两个真相源打架」。需要它就读 store.pages。
}

/** 单张照片的识别状态 */
export type ParsePageStatus = "waiting" | "parsing" | "done" | "error"

/** 一批多图识别里的单页（每页独立识别、独立会话） */
export interface ParsePage {
  /** 稳定 key（React 列表 & 批次内定位用） */
  id: string
  /** 该页自己的会话 id：问答 scope / 历史条目 / 多音字回填都按页隔离 */
  sessionId: string
  module: "chinese" | "math" | "english"
  previewUrl: string
  file: File | Blob | null
  status: ParsePageStatus
  /** 识别阶段（仅第 1 张前台识别时用得上，后台页只表达"识别中"） */
  stage: ParseStage | null
  error: string
  text: string
  questions: string[]
  blocks: TextBlock[]
  pageBounds: { left: number; top: number; right: number; bottom: number } | null
  crops?: CropItem[]
}

/** 多页之间共享的会话字段（不属于任何单页） */
type SharedFields = Pick<ParseSession, "initialQuestion" | "fromHistory" | "turns" | "pos" | "story">

interface ParseSessionState {
  session: ParseSession | null
  /** 多图批次的所有页（单张识别时为空数组，走纯 session 路径） */
  pages: ParsePage[]
  /** 当前展示第几页（0 起） */
  activePage: number
  /** 多页共享字段（initialQuestion 等） */
  shared: SharedFields
  setSession: (s: ParseSession) => void
  /** 开始一批多图识别：建页骨架（第 0 页 parsing、其余 waiting）并展开第 0 页 */
  beginPages: (inputs: { file: File | Blob; previewUrl: string }[], module: ParsePage["module"], shared?: SharedFields) => void
  /** 更新某页识别阶段 */
  setPageStage: (i: number, stage: ParseStage | null) => void
  /** 更新某页预览图（原始 objectURL 先占位，转正/压缩后换成处理过的） */
  setPagePreview: (i: number, previewUrl: string) => void
  /** 写入某页识别结果（status=done）；若它就是活动页，同步展开到 session */
  setPageResult: (i: number, res: ParseImageResult, media?: { file?: File | Blob; previewUrl?: string }) => void
  /** 标记某页识别失败 */
  setPageError: (i: number, msg: string) => void
  /** 切到第 i 页（把该页展开为 session） */
  selectPage: (i: number) => void
  /**
   * 回填异步补到的多音字（2026-09-02）。
   * 服务端为缩短首屏把注音挪到后台，补丁就绪后调这里合并进当前会话的 blocks，
   * 结果页是 zustand 订阅组件 → 自动重渲染，用户无感看到注音出现。
   * @param poly 字→拼音映射
   * @param start/end 仅回填 blocks[start,end)（切块/多框选时每段各补各的）
   */
  patchPolyphones: (poly: Record<string, string>, start?: number, end?: number) => void
  /** 同上，但指定第 i 页（多图批次每页各自回填） */
  patchPagePolyphones: (i: number, poly: Record<string, string>, start?: number, end?: number) => void
  clearSession: () => void
}

/** 把「第 i 页 + 共享字段」展开成结果页读的 session（唯一展开点，避免两处口径跑偏） */
function expand(pages: ParsePage[], i: number, shared: SharedFields): ParseSession | null {
  const p = pages[i]
  if (!p) return null
  return {
    ...shared,
    sessionId: p.sessionId,
    module: p.module,
    text: p.text,
    questions: p.questions,
    blocks: p.blocks,
    pageBounds: p.pageBounds,
    previewUrl: p.previewUrl,
    file: p.file,
    crops: p.crops ?? [],
  }
}

/** 把多音字合并进一段 blocks（表格块不带注音字段，跳过） */
function mergePolyIntoBlocks(blocks: TextBlock[], poly: Record<string, string>, start: number, end: number): TextBlock[] {
  return blocks.map((b, i) =>
    i >= start && i < end && b && b.type && b.type !== "table"
      ? { ...b, polyphones: { ...(b.polyphones || {}), ...poly } }
      : b,
  )
}

export const useParseSessionStore = create<ParseSessionState>()((set) => ({
  session: null,
  pages: [],
  activePage: 0,
  shared: {},

  setSession: (s) => set({ session: s, pages: [], activePage: 0, shared: {} }),

  beginPages: (inputs, module, shared = {}) =>
    set(() => {
      const pages: ParsePage[] = inputs.map((x, i) => ({
        id: `${Date.now().toString(36)}-${i}`,
        sessionId: newSessionId(),
        module,
        previewUrl: x.previewUrl,
        file: x.file,
        status: i === 0 ? "parsing" : "waiting",
        stage: i === 0 ? "preparing" : null,
        error: "",
        text: "",
        questions: [],
        blocks: [],
        pageBounds: null,
      }))
      return { pages, activePage: 0, shared, session: expand(pages, 0, shared) }
    }),

  setPageStage: (i, stage) =>
    set((st) => {
      if (!st.pages[i]) return st
      const pages: ParsePage[] = st.pages.map((p, k) => {
        if (k !== i) return p
        // 已出结果/已失败的页不因迟到的阶段回调被打回 parsing
        const status: ParsePageStatus = p.status === "done" || p.status === "error" ? p.status : "parsing"
        return { ...p, stage, status }
      })
      return { pages, session: st.activePage === i ? expand(pages, i, st.shared) : st.session }
    }),

  setPagePreview: (i, previewUrl) =>
    set((st) => {
      if (!st.pages[i]) return st
      const pages = st.pages.map((p, k) => (k === i ? { ...p, previewUrl } : p))
      return { pages, session: st.activePage === i ? expand(pages, i, st.shared) : st.session }
    }),

  setPageResult: (i, res, media) =>
    set((st) => {
      const patch = {
        status: "done" as ParsePageStatus,
        stage: null,
        error: "",
        text: res.text ?? "",
        questions: res.questions?.length ? res.questions : res.text ? [res.text] : [],
        blocks: res.blocks ?? [],
        pageBounds: res.page_bounds ?? null,
        crops: res.crops ?? [],
        ...(media?.file ? { file: media.file } : {}),
        ...(media?.previewUrl ? { previewUrl: media.previewUrl } : {}),
      }
      // 单页路径（历史回看 / 切块 / 框选后重新识别）：没有 pages，直接更新 session
      if (!st.pages.length) {
        return {
          session: st.session
            ? {
                ...st.session,
                text: patch.text,
                questions: patch.questions,
                blocks: patch.blocks,
                pageBounds: patch.pageBounds,
                crops: patch.crops,
                ...(media?.file ? { file: media.file } : {}),
                ...(media?.previewUrl ? { previewUrl: media.previewUrl } : {}),
              }
            : null,
        }
      }
      if (!st.pages[i]) return st
      const pages = st.pages.map((p, k) => (k === i ? { ...p, ...patch } : p))
      return { pages, session: st.activePage === i ? expand(pages, i, st.shared) : st.session }
    }),

  setPageError: (i, msg) =>
    set((st) => {
      if (!st.pages[i]) {
        return st
      }
      const pages = st.pages.map((p, k) => (k === i ? { ...p, status: "error" as ParsePageStatus, stage: null, error: msg } : p))
      return { pages, session: st.activePage === i ? expand(pages, i, st.shared) : st.session }
    }),

  selectPage: (i) =>
    set((st) => (st.pages[i] ? { activePage: i, session: expand(st.pages, i, st.shared) } : st)),

  patchPolyphones: (poly, start = 0, end = Number.MAX_SAFE_INTEGER) =>
    set((st) => {
      const s = st.session
      if (!s || !poly || !Object.keys(poly).length || !Array.isArray(s.blocks)) return st
      const blocks = mergePolyIntoBlocks(s.blocks, poly, start, end)
      // 多页时同步写回页数据，否则切走再切回注音就丢了
      const pages = st.pages.length
        ? st.pages.map((p, k) =>
            k === st.activePage ? { ...p, blocks: mergePolyIntoBlocks(p.blocks, poly, start, end) } : p,
          )
        : st.pages
      return { session: { ...s, blocks }, pages }
    }),

  patchPagePolyphones: (i, poly, start = 0, end = Number.MAX_SAFE_INTEGER) =>
    set((st) => {
      if (!st.pages[i] || !poly || !Object.keys(poly).length) return st
      const pages = st.pages.map((p, k) =>
        k === i ? { ...p, blocks: mergePolyIntoBlocks(p.blocks, poly, start, end) } : p,
      )
      return { pages, session: st.activePage === i ? expand(pages, i, st.shared) : st.session }
    }),

  clearSession: () => set({ session: null, pages: [], activePage: 0, shared: {} }),
}))

/** 生成一个新的会话 id（问答 scope 前缀） */
export function newSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
