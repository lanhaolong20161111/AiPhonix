/** 多图批次会话 store 的单测（2026-09-16）
 *
 * 覆盖「一次选多张照片」的核心不变式：
 *  1. 建页骨架时第 1 张先解析、其余排队；
 *  2. 后台页的结果**不会**污染用户正在看的那一页，切过去才看得到；
 *  3. 多音字按页回填，切页不串味（注音跟着页走）；
 *  4. 失败页带上原因，标签能读到；
 *  5. 单页路径（历史回看 / 切块识别）仍走纯 session，不被多图逻辑影响。
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { useParseSessionStore } from "./parseSessionStore"
import type { ParseImageResult } from "../services/aiImage"

const st = () => useParseSessionStore.getState()

/** 造一个最小可用的识别结果：`blocks` 张块，每块有自己的文字 */
function mkResult(text: string, blockCount = 1): ParseImageResult {
  return {
    text,
    questions: [text],
    blocks: Array.from({ length: blockCount }, (_, i) => ({
      type: "body",
      text: `${text}#${i}`,
      align: "left",
      lines: [{ text: `${text}#${i}`, indent: 0 }],
      polyphones: {},
    })),
  }
}

function begin(pageCount: number, module: "chinese" | "math" | "english" = "chinese") {
  st().clearSession()
  st().beginPages(
    Array.from({ length: pageCount }, (_, i) => ({ file: new Blob([`f${i}`]), previewUrl: `u${i}` })),
    module,
  )
}

test("多图：beginPages 建骨架 —— 第 1 张先解析，其余排队", () => {
  begin(3)
  assert.equal(st().pages.length, 3)
  assert.deepEqual(
    st().pages.map((p) => p.status),
    ["parsing", "waiting", "waiting"],
  )
  // session 展开的是第 1 页
  assert.equal(st().session?.previewUrl, "u0")
  assert.deepEqual(
    st().pages.map((p) => p.status),
    ["parsing", "waiting", "waiting"],
  )
  // 每页独立会话 id（问答 scope / 历史条目按页隔离的前提）
  assert.equal(new Set(st().pages.map((p) => p.sessionId)).size, 3)
})

test("多图：后台页的结果不污染当前页，切过去才看得到", () => {
  begin(2)
  st().setPageResult(0, mkResult("页一"))
  // 第 2 页（后台）先于用户切换就识别完了
  st().setPageResult(1, mkResult("页二"))

  assert.equal(st().session?.text, "页一") // 用户还在第 1 张上
  // 标签读的是 pages（后台页完成时标签立刻变「已识别」），而当前页内容不受影响
  assert.deepEqual(
    st().pages.map((p) => p.status),
    ["done", "done"],
  )

  st().selectPage(1)
  assert.equal(st().activePage, 1)
  assert.equal(st().session?.text, "页二")
  assert.equal(st().session?.blocks?.[0]?.text, "页二#0")
  // 切回第 1 页，内容还是第 1 页的
  st().selectPage(0)
  assert.equal(st().session?.text, "页一")
})

test("多图：多音字按页回填，切页不串味", () => {
  begin(2)
  st().setPageResult(0, mkResult("甲乙"))
  st().setPageResult(1, mkResult("丙丁"))
  // 第 2 页的注音后到（后台补的），此时用户还在第 1 页
  st().patchPagePolyphones(1, { 丙: "bǐng" })

  assert.equal(st().session?.blocks?.[0]?.polyphones?.["丙"], undefined) // 没串到第 1 页
  st().selectPage(1)
  assert.equal(st().session?.blocks?.[0]?.polyphones?.["丙"], "bǐng")
  // 切走再切回来，注音仍在（回填要写回页数据，不能只改 session）
  st().selectPage(0)
  st().selectPage(1)
  assert.equal(st().session?.blocks?.[0]?.polyphones?.["丙"], "bǐng")
})

test("多图：失败页记录原因并反映到标签", () => {
  begin(3)
  st().setPageResult(0, mkResult("好的这张"))
  st().setPageError(2, "没识别到文字，这张可能太模糊了")
  assert.deepEqual(
    st().pages.map((p) => p.status),
    ["done", "waiting", "error"],
  )
  assert.equal(st().pages[2].error, "没识别到文字，这张可能太模糊了")
  // 切过去后结果页从 pages[activePage].error 取占位文案
  st().selectPage(2)
  assert.equal(st().pages[st().activePage].error, "没识别到文字，这张可能太模糊了")
})

test("多图：迟到的阶段回调不会把已完成的页打回 parsing", () => {
  begin(2)
  st().setPageResult(1, mkResult("页二"))
  st().setPageStage(1, "recognizing") // 迟到的进度回调
  assert.equal(st().pages[1].status, "done")
})

test("多图：最近一次识别/旋转会把结果与图片写回当前页", () => {
  begin(2)
  st().setPageResult(0, mkResult("旧结果"))
  st().selectPage(1)
  st().setPageResult(1, mkResult("重识别结果"), { previewUrl: "u1-new" })
  assert.equal(st().pages[1].previewUrl, "u1-new")
  assert.equal(st().session?.previewUrl, "u1-new")
  assert.equal(st().pages[0].text, "旧结果") // 别的页不受影响
})

test("单页路径：setSession 清掉多图页（历史回看 / 切块识别不受多图逻辑影响）", () => {
  begin(3)
  st().setSession({
    sessionId: "single",
    module: "chinese",
    text: "历史回看",
    questions: ["历史回看"],
    blocks: [],
    pageBounds: null,
    previewUrl: "h",
    file: null,
    fromHistory: true,
  })
  assert.equal(st().pages.length, 0)
  assert.equal(st().session?.fromHistory, true)
  // 没有 pages 时写结果走"直接更新 session"分支（重新识别用）
  st().setPageResult(0, mkResult("新结果"))
  assert.equal(st().session?.text, "新结果")
  assert.equal(st().session?.sessionId, "single") // 会话 id 不被改写（问答 scope 保持）
})
