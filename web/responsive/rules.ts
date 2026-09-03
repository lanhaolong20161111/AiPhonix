/** Responsive Audit 规则引擎
 * 几何事实类规则（不做主观视觉判断）：
 *  P1 响应式失效（溢出/越界/图片撑破）
 *  P2 可用性（触控目标过小/文字截断/fixed 遮挡风险）
 *  P3 视觉规范（max-width、移动端单列等约束）
 * 采集(captureDOM)与判断(check)分离：页面 evaluate 采几何数据，规则在 Node 侧跑。
 */

export type Sev = "P1" | "P2" | "P3"

export interface DomNode {
  tag: string
  id: string
  cls: string
  text: string | null
  x: number; y: number; w: number; h: number
  pos: string
  isImg: boolean
  isFixed: boolean
  isSticky: boolean
  scrollW: number; clientW: number
  scrollH: number; clientH: number
  overflowX: string
  fontSize: number
  /** display:grid 时的列数（仅 grid 元素） */
  gridCols: number
  /** 是否有横向可滚动祖先（scroll-snap 容器内元素右缘超出视口属正常） */
  inHScroll: boolean
}

export interface ViewportInfo {
  vw: number; vh: number
  docSW: number; docCW: number
  docSH: number; docCH: number
  url: string
  title: string
}

export interface CaptureResult {
  nodes: DomNode[]
  viewport: ViewportInfo
  /** 主内容容器(.page)的 computed max-width；无则为 0 */
  mainMaxWidth: number
}

export interface Violation {
  rule: string
  sev: Sev
  msg: string
  n: number
  samples: string[]
}

export interface AuditContext {
  viewportName: string
  group: "mobile" | "tablet" | "desktop"
  expect?: { maxContentWidth?: number; mobileColumns?: number }
}

export interface RuleDef {
  id: string
  title: string
  sev: Sev
  check(c: CaptureResult, ctx: AuditContext): Violation | null
}

function desc(n: DomNode): string {
  return `${n.tag}${n.cls ? "." + n.cls.split(/\s+/)[0] : ""}${n.id ? "#" + n.id : ""}${n.text ? `「${n.text.slice(0, 14)}」` : ""}`
}

/** 页面根容器（高度=文档高>视口高属正常纵向滚动，不算越界） */
function isPageRoot(n: DomNode): boolean {
  return n.tag === "HTML" || n.tag === "BODY" || n.id === "root"
}

/** 采集 DOM 几何数据（在页面里执行；注意：page.evaluate 只序列化本函数，外部变量不可见） */
export function captureDOM(): CaptureResult {
  const round = (v: number) => Math.round(v * 10) / 10
  function inHScroll(el: Element): boolean {
    let cur: Element | null = el.parentElement
    while (cur) {
      const st = getComputedStyle(cur)
      if ((st.overflowX === "auto" || st.overflowX === "scroll") && cur.scrollWidth > cur.clientWidth + 1) return true
      cur = cur.parentElement
    }
    return false
  }
  const vp = {
    vw: window.innerWidth,
    vh: window.innerHeight,
    docSW: document.documentElement.scrollWidth,
    docCW: document.documentElement.clientWidth,
    docSH: document.documentElement.scrollHeight,
    docCH: document.documentElement.clientHeight,
    url: location.pathname + location.search,
    title: document.title,
  }
  const nodes: DomNode[] = []
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    const st = getComputedStyle(el)
    if (st.display === "none" || st.visibility === "hidden") continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (Number(st.opacity) === 0) continue
    let gridCols = 0
    if (st.display === "grid" || st.display === "inline-grid") {
      const tracks = st.gridTemplateColumns.split(/\s+/).filter((t) => t && t !== "none")
      gridCols = tracks.length
    }
    nodes.push({
      tag: el.tagName,
      id: el.id || "",
      cls: typeof el.className === "string" ? el.className : "",
      text: (el.textContent || "").trim().slice(0, 40) || null,
      x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height),
      pos: st.position,
      isImg: el.tagName === "IMG",
      isFixed: st.position === "fixed",
      isSticky: st.position === "sticky",
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      overflowX: st.overflowX,
      fontSize: parseFloat(st.fontSize) || 0,
      gridCols,
      inHScroll: inHScroll(el),
    })
  }
  const pageEl = document.querySelector<HTMLElement>(".page")
  const mainMaxWidth = pageEl ? parseFloat(getComputedStyle(pageEl).maxWidth || "0") || 0 : 0
  return { nodes, viewport: vp, mainMaxWidth }
}

export const RULES: RuleDef[] = [
  {
    id: "R001",
    title: "页面横向溢出",
    sev: "P1",
    check(c) {
      const { docSW, docCW } = c.viewport
      if (docSW <= docCW + 1) return null
      // 找溢出源头：超出右缘的非 fixed 元素（排除根容器/横向滚动容器内元素）
      const outs = c.nodes
        .filter((n) => !isPageRoot(n) && !n.inHScroll && n.pos !== "fixed" && n.x + n.w > c.viewport.vw + 1)
        .sort((a, b) => b.w - a.w)
        .slice(0, 6)
      return {
        rule: "R001",
        sev: "P1",
        msg: `页面横向溢出 ${docSW - docCW}px（scrollWidth=${docSW} > clientWidth=${docCW}）`,
        n: outs.length,
        samples: outs.map(desc),
      }
    },
  },
  {
    id: "R002",
    title: "元素越出视口",
    sev: "P1",
    check(c) {
      const { vw, vh } = c.viewport
      // 普通元素只查横向越界（纵向超出视口 = 正常滚动）；fixed 元素全维检查（脱离滚动流）
      const outs = c.nodes
        .filter((n) => !isPageRoot(n) && !n.inHScroll &&
          (n.pos === "fixed"
            ? n.x < -1 || n.y < -1 || n.x + n.w > vw + 1 || n.y + n.h > vh + 1
            : n.x < -1 || n.x + n.w > vw + 1))
        .slice(0, 8)
      if (!outs.length) return null
      return {
        rule: "R002",
        sev: "P1",
        msg: `${outs.length} 个元素越出视口 ${vw}×${vh}`,
        n: outs.length,
        samples: outs.map((n) => `${desc(n)} @(${n.x},${n.y}) ${n.w}×${n.h}`),
      }
    },
  },
  {
    id: "R003",
    title: "负坐标元素",
    sev: "P1",
    check(c) {
      const neg = c.nodes.filter((n) => n.x < -2 || n.y < -2).slice(0, 5)
      if (!neg.length) return null
      return {
        rule: "R003",
        sev: "P1",
        msg: `${neg.length} 个元素位于负坐标（可能被推出布局）`,
        n: neg.length,
        samples: neg.map((n) => `${desc(n)} x=${n.x} y=${n.y}`),
      }
    },
  },
  {
    id: "R004",
    title: "fixed 元素遮挡风险",
    sev: "P2",
    check(c) {
      const fixed = c.nodes.filter((n) => n.isFixed)
      if (!fixed.length) return null
      const top = fixed.filter((n) => n.y <= 2 && n.h <= 140)
      const bottom = fixed.filter((n) => n.y + n.h >= c.viewport.vh - 2 && n.h <= 160)
      const parts: string[] = []
      if (top.length) parts.push(`顶部条×${top.length}`)
      if (bottom.length) parts.push(`底部条×${bottom.length}`)
      const others = fixed.length - top.length - bottom.length
      if (others) parts.push(`其它×${others}`)
      return {
        rule: "R004",
        sev: "P2",
        msg: `存在 ${parts.join("、")} — 检查是否遮挡正文滚动（fixed 元素）`,
        n: fixed.length,
        samples: fixed.slice(0, 6).map((n) => `${desc(n)} @y=${n.y} h=${n.h}`),
      }
    },
  },
  {
    id: "R005",
    title: "触控目标过小（移动端）",
    sev: "P2",
    check(c, ctx) {
      if (ctx.group !== "mobile") return null
      const small = c.nodes
        .filter((n) => (n.tag === "BUTTON" || n.tag === "A" || n.tag === "INPUT") && (n.w < 40 || n.h < 40) && n.w >= 10 && n.h >= 10)
        .slice(0, 8)
      if (!small.length) return null
      return {
        rule: "R005",
        sev: "P2",
        msg: `${small.length} 个按钮/链接/输入框 < 44×44px（推荐最小触控目标）`,
        n: small.length,
        samples: small.map((n) => `${desc(n)} ${n.w}×${n.h}`),
      }
    },
  },
  {
    id: "R006",
    title: "文字被裁剪/溢出",
    sev: "P2",
    check(c) {
      const clipped = c.nodes
        .filter((n) => n.scrollW > n.clientW + 2 && (n.overflowX === "hidden" || n.tag === "BUTTON" || n.tag === "SPAN"))
        .slice(0, 8)
      if (!clipped.length) return null
      return {
        rule: "R006",
        sev: "P2",
        msg: `${clipped.length} 个元素内容超出自身宽度（可能文字被截断）`,
        n: clipped.length,
        samples: clipped.map((n) => `${desc(n)} client=${n.clientW} scroll=${n.scrollW}`),
      }
    },
  },
  {
    id: "R007",
    title: "图片撑破容器",
    sev: "P1",
    check(c) {
      const { vw } = c.viewport
      const imgs = c.nodes
        .filter((n) => n.isImg && !n.inHScroll && (n.w > vw + 1 || n.x + n.w > vw + 1))
        .slice(0, 6)
      if (!imgs.length) return null
      return {
        rule: "R007",
        sev: "P1",
        msg: `${imgs.length} 张图片宽度超过视口（可导致横向滚动）`,
        n: imgs.length,
        samples: imgs.map((n) => `${desc(n)} ${n.w}px > vw ${vw}px`),
      }
    },
  },
  {
    id: "R008",
    title: "移动端多列过挤 / 违反单列契约",
    sev: "P2",
    check(c, ctx) {
      if (ctx.group !== "mobile") return null
      const { vw } = c.viewport
      const grids = c.nodes.filter((n) => n.gridCols > 1 && n.w > vw * 0.5)
      const expectCols = ctx.expect?.mobileColumns
      const crowded = grids.filter((n) => n.gridCols > 2 || (vw - 16) / n.gridCols < 120)
      const bad: string[] = []
      if (expectCols === 1 && grids.length) {
        bad.push(`期望单列，检测到 grid 多列×${grids.length}`)
      }
      if (crowded.length) {
        bad.push(`${crowded.length} 个 grid 移动端列宽 <120px 或 >2 列`)
      }
      if (!bad.length) return null
      return {
        rule: "R008",
        sev: "P2",
        msg: bad.join("；"),
        n: grids.length,
        samples: grids.slice(0, 5).map((n) => `${desc(n)} cols=${n.gridCols} w=${n.w}`),
      }
    },
  },
  {
    id: "R009",
    title: "桌面内容缺少 max-width",
    sev: "P3",
    check(c, ctx) {
      if (ctx.group !== "desktop") return null
      const { vw } = c.viewport
      const expect = ctx.expect?.maxContentWidth
      let msg = ""
      if (expect) {
        if (c.mainMaxWidth === 0) msg = `Layout Contract 要求 max-width:${expect}px，但主容器未设 max-width`
        else if (c.mainMaxWidth > expect + 1) msg = `Layout Contract 要求 max-width:${expect}px，实际为 ${c.mainMaxWidth}px`
        else return null
      } else if (c.mainMaxWidth === 0 || c.mainMaxWidth >= vw * 0.92) {
        msg = `主容器宽度 ${c.mainMaxWidth || "未设"} 接近视口 ${vw}px，内容将横跨整个屏幕（建议 max-width:1280 + margin:0 auto）`
      } else {
        return null
      }
      return { rule: "R009", sev: "P3", msg, n: 1, samples: [`.page max-width=${c.mainMaxWidth}px (vw=${vw})`] }
    },
  },
]

export function runRules(c: CaptureResult, ctx: AuditContext): Violation[] {
  const out: Violation[] = []
  for (const r of RULES) {
    try {
      const v = r.check(c, ctx)
      if (v) out.push({ ...v, rule: r.id, sev: v.sev })
    } catch {
      /* 单规则失败不阻塞整体 */
    }
  }
  return out
}