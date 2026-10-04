/** 数学展示分段 —— 从 `modules/ai_parse_result/index.tsx` 抽出（2026-09-15），为了：
 *  ① 可单测（align/indent/表格判定这些规则以前埋在页面组件里，改错没人拦得住）
 *  ② 渲染循环 / navCount / sectionLabel 共用同一份（索引必须对得上）
 *
 *  服务端（`server_cf/src/lib/subject/math.ts`）自 2026-09-15 起按「试卷规格」返回
 *  `type`（title/heading/table/question/option/note/body/foot）、`align`、逐行 `indent`。
 *  这里负责把这些字段**原样带到前端**，不再只留 `{text, type}` 把 align/indent 丢掉。
 *
 *  ⚠️ 无 blocks 时的退回项 type 取 `question` 而非 `body` —— `body` 在前端是
 *  「算式/竖式逐行渲染」，把整道题标成 body 会让长题干失去段落折行（回归）。 */

export interface MathSegLine {
  text: string
  indent: number
}

export interface MathSeg {
  text: string
  type: string
  align: "left" | "center" | "right"
  /** 与 text 同一份来源的逐行数据（物理行保真）；服务端没给 lines 时由 text 按 \n 拆 */
  lines: MathSegLine[]
}

interface RawBlock {
  text?: string
  type?: string
  align?: string
  lines?: { text?: string; indent?: number }[]
}

/** 越界 align 回退 left（与服务端 kernel 的 normAlign 同口径） */
export function mathAlignTextAlign(v: unknown): "left" | "center" | "right" {
  const a = String(v ?? "").trim()
  return a === "center" || a === "right" ? a : "left"
}

/** indent 级 → em（1 级 ≈ 2 个汉字宽）；夹取 0~3，与服务端 clampIndent 同口径 */
export function mathIndentEm(v: unknown): number {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, 3) * 2
}

/** 是否表格块：type=table，或正文里内嵌 HTML `<table>`（模型两种输出都要认） */
export function isTableSeg(seg: { text?: string; type?: string }): boolean {
  if (String(seg?.type ?? "") === "table") return true
  return /<table[\s>]/i.test(String(seg?.text ?? ""))
}

/** 块内逐行数据：优先服务端 lines；缺失/为空则由 text 按 `\n` 拆、indent 一律 0。
 *  ⚠️ 行文本**只裁行尾**，绝不裁行首 —— 竖式靠行首空格对齐，裁掉列位就散了。 */
export function segLines(text: string, lines?: { text?: string; indent?: number }[]): MathSegLine[] {
  const given = (lines ?? [])
    .map((l) => ({ text: String(l?.text ?? "").replace(/\s+$/, ""), indent: Number(l?.indent ?? 0) || 0 }))
    .filter((l) => l.text !== "")
  if (given.length) return given
  return String(text ?? "")
    .split("\n")
    .map((t) => ({ text: t.replace(/\s+$/, ""), indent: 0 }))
    .filter((l) => l.text !== "")
}

export function mathDisplaySegments(
  blocks: RawBlock[] | undefined,
  questions: string[],
  text: string,
): MathSeg[] {
  const fromBlocks = (blocks ?? [])
    .map((b) => {
      const t = String(b?.text ?? "").replace(/\s+$/, "")
      return {
        text: t,
        type: String(b?.type ?? "body"),
        align: mathAlignTextAlign(b?.align),
        lines: segLines(t, b?.lines),
      } as MathSeg
    })
    .filter((s) => s.text.trim() && s.type !== "image")
  if (fromBlocks.length) return fromBlocks

  const qs = (questions ?? []).map((q) => String(q ?? "").trim()).filter(Boolean)
  if (qs.length) {
    return qs.map((t) => ({ text: t, type: "question", align: "left" as const, lines: [{ text: t, indent: 0 }] }))
  }
  const t = (text ?? "").trim()
  return t ? [{ text: t, type: "question", align: "left", lines: [{ text: t, indent: 0 }] }] : []
}
