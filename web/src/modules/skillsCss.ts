/** 样式裁剪 —— App.css 里用 `@skill: <id>` 标记块标注归属，构建期按开关整块保留/剔除。
 *
 * ── 为什么不是「每个模块一个 css 文件」 ──────────────────────────────
 * App.css 里各模块的规则是**散段**的（36 个模块共 154 段，`ai_parse_result` 散了 24 处），
 * 而 CSS 的层叠结果依赖**规则顺序**：把散段合并进独立文件，等于改变它们的加载位置。
 * 静态分析（`web/_css_split.py`）量出 86 对「同特指度 + 共享 class + 被搬走的原本排在
 * 留下的之前」的规则 —— 这些搬走后会从「输」变「赢」，是**静默**的样式回归。
 *
 * ── 所以这里的做法 ────────────────────────────────────────────────
 * 保留**单一有序样式表**，只做「整块删除」：被删的规则属于未启用模块，那些模块的 DOM
 * 根本不会渲染 ⇒ 不可能影响任何元素的最终样式。
 * 于是默认路径（未设 `VITE_SKILLS`）下，产出的 CSS 与改造前**逐字节相同**（零风险），
 * 裁剪路径才真正变小。
 *
 * 标记形如：
 *   `/* @skill: math_units *&#47;`
 *   …该模块的规则…
 *   `/* @skill:end *&#47;`
 * 标记本身是合法 CSS 注释，就算没有这个过滤器，样式表也照常工作。
 */

// ⚠️ 带扩展名：这个文件同时被 vite.config.ts（nodenext 的 tsconfig.node.json）引入，
//    nodenext 要求相对 import 显式写扩展名；tsconfig.app.json 已开 allowImportingTsExtensions。
import { ALWAYS_ON_SKILLS } from "./skillsSwitch.ts"

/** 开标记：`/* @skill: <id> *​/` */
const OPEN_LINE = /^[ \t]*\/\* @skill: ([\w-]+) \*\/[ \t]*$/
/** 闭标记：`/* @skill:end *​/` */
const CLOSE_LINE = /^[ \t]*\/\* @skill:end \*\/[ \t]*$/

/** 扫出标记块，返回 [{ id, start, end }]（行号，含标记行自身）。 */
export function scanSkillBlocks(css: string): { id: string; start: number; end: number }[] {
  const lines = css.split("\n")
  const blocks: { id: string; start: number; end: number }[] = []
  let openId: string | null = null
  let openLine = -1
  for (let i = 0; i < lines.length; i++) {
    const o = lines[i].match(OPEN_LINE)
    if (o) {
      if (openId !== null) {
        throw new Error(`@skill 标记嵌套：第 ${openLine + 1} 行的「${openId}」里又开了「${o[1]}」`)
      }
      openId = o[1]
      openLine = i
      continue
    }
    if (CLOSE_LINE.test(lines[i])) {
      if (openId === null) throw new Error(`第 ${i + 1} 行的 @skill:end 没有对应的 @skill 开标记`)
      blocks.push({ id: openId, start: openLine, end: i })
      openId = null
      openLine = -1
    }
  }
  if (openId !== null) {
    throw new Error(`@skill「${openId}」（第 ${openLine + 1} 行）没有闭合`)
  }
  return blocks
}

/** 样式表里标注了归属的模块 id（去重，保持出现顺序）。 */
export function listSkillCssIds(css: string): string[] {
  return [...new Set(scanSkillBlocks(css).map((b) => b.id))]
}

/**
 * 按启用集合裁剪样式表。
 * @param enabled null = 不裁剪（默认构建），此时**原样返回**，保证与改造前逐字节相同。
 *
 * ⚠️ `ALWAYS_ON_SKILLS`（登录 / 注册 / 占位 / 内核页 home）无论调用方给什么都保留 ——
 * 这些页面注册表那边不会被裁掉，样式必须跟着留下，否则就是「页面在、样式没了」的白屏。
 */
export function filterCssBySkills(css: string, enabled: Iterable<string> | null): string {
  if (enabled === null) return css
  const on = new Set(enabled)
  for (const id of ALWAYS_ON_SKILLS) on.add(id)
  const lines = css.split("\n")
  const drop = new Set<number>()
  for (const b of scanSkillBlocks(css)) {
    if (on.has(b.id)) continue
    for (let i = b.start; i <= b.end; i++) drop.add(i)
  }
  if (drop.size === 0) return css
  return lines.filter((_, i) => !drop.has(i)).join("\n")
}

/** 自检：标记是否成对、id 是否都在 catalog 里。返回问题清单，空数组 = 通过。 */
export function checkSkillCss(css: string, knownIds: Iterable<string>): string[] {
  const problems: string[] = []
  let blocks: { id: string; start: number; end: number }[]
  try {
    blocks = scanSkillBlocks(css)
  } catch (e) {
    return [`标记不合法：${(e as Error).message}`]
  }
  const known = new Set(knownIds)
  for (const b of blocks) {
    if (!known.has(b.id)) problems.push(`@skill 块「${b.id}」不在模块 catalog 里（拼错？还是模块被删了没清标记？）`)
  }
  const dup = blocks.map((b) => b.id).filter((id, i, a) => a.indexOf(id) !== i)
  for (const id of [...new Set(dup)]) {
    // 允许同名多块（一个模块的规则本来就散着），但不能两块挨在一起（等于没拆开）
    const bs = blocks.filter((b) => b.id === id)
    for (let i = 1; i < bs.length; i++) {
      if (bs[i].start === bs[i - 1].end + 1) problems.push(`@skill 块「${id}」有相邻的两块，应合并`)
    }
  }
  return problems
}
