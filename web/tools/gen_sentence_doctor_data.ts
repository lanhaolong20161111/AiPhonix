/**
 * 句子小医生 · 数据搬运脚本（Web → Android）
 *
 * 跑法（★ 必须在**仓库根** `AiPhonix/` 下，输出路径按 cwd 解析）：
 *   `./web/node_modules/.bin/tsx web/tools/gen_sentence_doctor_data.ts`
 *   （★ `npx tsx` 在本机不真的执行，只打印 npm warn 就退出 ⇒ 必须用 node_modules/.bin/tsx）
 *
 * 为什么用「导入真模块再序列化」而不是正则抠 `data.ts`：
 * content 里全是中文引号（\u201C / \u201D）、`：`+引号 这种两字符答案、以及 `ok` 可选字段，
 * 正则一旦吃错一个字，孩子那边看到的就是错答案，而测试只覆盖结构、不覆盖内容对错。
 * 直接把 web 的模块 import 进来，等于让 **web 自己吐数据** —— 零转录误差。
 *
 * 生成物：app/src/main/java/com/example/ai/data/sentencedoctor/SentenceDoctorData.kt
 * 该文件 **必须提交**；本脚本也提交（web 侧内容改了就跑一次，跑完重新编译+跑单测）。
 *
 * ⚠️ 放置位置别乱挪：`web/tools/` 才是本仓「与源码同维护的构建期工具」目录
 *    （先例 `web/tools/cssSkillMark.py`）。**别放 `scripts/`** —— `.gitignore:69`
 *    把整个 `scripts/` 当**临时脚本**目录忽略掉了（新文件连 `git status` 都不显示），
 *    也**别放 `web/_*`** —— 那是「一次性探针」的命名区（.gitignore 里逐条列举）。
 */

import { writeFileSync } from "node:fs"

import {
  CQ,
  FIX_LEVELS,
  FIX_TOOLS,
  OQ,
  PUNCT_KEYS,
  PUNCT_LEVELS,
  SLOT_HINT,
} from "../src/modules/sentence_doctor/data"

/** ⚠️ 相对 **cwd**（不是脚本位置）⇒ 必须在仓库根 `AiPhonix/` 下跑 */
const OUT = "app/src/main/java/com/example/ai/data/sentencedoctor/SentenceDoctorData.kt"

/** Kotlin 字符串字面量（转义 `\` `"` `$`，换行压成 \n） */
function q(s: string): string {
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, "\\$")
      .replace(/\r?\n/g, "\\n") +
    '"'
  )
}

const KINDS = ["tag", "open", "in", "close", "mid", "end", "narr"] as const
const TOOLS: Record<string, string> = {
  改正: "CORRECT",
  增补: "ADD",
  删除: "DELETE",
  对调: "SWAP",
  移动: "MOVE",
}
const SLOT_KIND_ENUM: Record<string, string> = {
  tag: "TAG",
  open: "OPEN",
  in: "IN",
  close: "CLOSE",
  mid: "MID",
  end: "END",
  narr: "NARR",
}

// ── 先做一遍交叉校验：数目不对就别生成，免得把半份数据写进仓库 ──
const punctItems = PUNCT_LEVELS.reduce((n, l) => n + l.items.length, 0)
const fixItems = FIX_LEVELS.reduce((n, l) => n + l.items.length, 0)
const fixSpots = FIX_LEVELS.reduce((n, l) => n + l.items.reduce((m, it) => m + it.spots.length, 0), 0)
if (PUNCT_LEVELS.length !== 4) throw new Error(`标点册关卡数变了：${PUNCT_LEVELS.length}`)
if (punctItems !== 19) throw new Error(`标点册句数变了：${punctItems}`)
console.log(
  `源数据：标点册 ${PUNCT_LEVELS.length} 关 / ${punctItems} 句；` +
    `病句册 ${FIX_LEVELS.length} 关 / ${fixItems} 句 / ${fixSpots} 处病灶`,
)
if (FIX_LEVELS.length !== 6) throw new Error(`病句册关卡数变了：${FIX_LEVELS.length}`)
if (fixItems !== 30) throw new Error(`病句册句数变了：${fixItems}`)
if (fixSpots !== 35) throw new Error(`病句册病灶数变了：${fixSpots}`)
for (const k of KINDS) if (!SLOT_HINT[k]) throw new Error(`SLOT_HINT 缺 kind：${k}`)
for (const t of FIX_TOOLS) if (!TOOLS[t.key]) throw new Error(`未映射的修改符号：${t.key}`)

const L: string[] = []
const p = (s = "") => L.push(s)

p("package com.example.ai.data.sentencedoctor")
p()
p("/**")
p(" * 句子小医生 · 练习内容（Web → Android 一字不改搬过来的）")
p(" *")
p(" * ⚠️ **本文件由脚本生成，不要手改** —— 内容真源在")
p(" *    `web/src/modules/sentence_doctor/data.ts`（廖敏老师自制练习册《提示语及修改病句专项练习》：")
p(" *    上半册《识破标点的幻术》4 关 19 句、下半册《医治句子的疾病》6 关 30 句 35 处病灶）。")
p(" *    生成脚本：`web/tools/gen_sentence_doctor_data.ts`")
p(" *    （跑法：在仓库根 `./web/node_modules/.bin/tsx web/tools/gen_sentence_doctor_data.ts`）。")
p(" *")
p(" * 为什么内容与逻辑分家：一句话 = 文本片段（parts）+ 空位（slots），空位自带标准答案与理由；")
p(" * 页面只负责「点、判、讲」。")
p(" *")
p(" * ⚠️ 标点答案里前引号是 " + q(OQ) + "、后引号是 " + q(CQ) + " —— 两者是不同字符。")
p(" *    「提示语在中间」那种句子里两处都用逗号，唯一的区别就是引号朝向。")
p(" */")
p()
p("internal const val SD_OQ = " + q(OQ) + "   // 中文前引号")
p("internal const val SD_CQ = " + q(CQ) + "   // 中文后引号")
p()
p("/** 空位在句子里的角色 —— 决定「✨ 提示」怎么点它 */")
p("internal enum class SdSlotKind { TAG, OPEN, IN, CLOSE, MID, END, NARR }")
p()
p("/** 五把手术刀。`whenTo` 是课本给的使用时机（符号卡的 tooltip 与说明行） */")
p("internal enum class SdTool(val label: String, val whenTo: String) {")
FIX_TOOLS.forEach((t, i) => {
  const comma = i < FIX_TOOLS.length - 1 ? "," : ";"
  p(`    ${TOOLS[t.key]}(${q(t.key)}, ${q(t.when)})${comma}`)
})
p("}")
p()
p("internal data class SdPunctKey(val c: String, val label: String)")
p()
p("internal data class SdPunctSlot(")
p("    /** 标准答案（按顺序拼出来的标点串，可能两个字符，如「：」+ 前引号） */")
p("    val a: String,")
p("    /** 同样算对的其它写法 */")
p("    val ok: List<String>,")
p("    val kind: SdSlotKind,")
p("    /** 为什么这么填 */")
p("    val why: String,")
p(")")
p()
p("internal data class SdPunctItem(")
p("    /** 文本片段；相邻两段之间（以及首、尾）各有一个空位 */")
p("    val parts: List<String>,")
p("    /** 长度 = parts.size + 1；null = 这里本来就没有标点（不是练习点） */")
p("    val slots: List<SdPunctSlot?>,")
p("    /** ✨ 提示：不直接给答案，只说该往哪儿看 */")
p("    val tip: String,")
p(")")
p()
p("internal data class SdPunctLevel(")
p("    val key: String,")
p("    val name: String,")
p("    /** 通关口诀 */")
p("    val rule: String,")
p("    val items: List<SdPunctItem>,")
p(")")
p()
p("/** 一处病灶在**原句里的位置** —— 用来把修改符号直接画在原句上（位置不靠 diff 猜，见 web 注释） */")
p("internal data class SdSpotMark(")
p("    /** 原句里要划掉／框住的那段（对调、移动时是「源」） */")
p("    val cut: String? = null,")
p("    /** 写上去的新文字（改正、增补） */")
p("    val put: String? = null,")
p("    /** put 补在哪个字之前（增补）；省略 = 就补在 cut 原来的位置 */")
p("    val at: String? = null,")
p("    /** 与 cut 配对的那一段（对调 = 互换的另一半；移动 = 挪到它前面） */")
p("    val with: String? = null,")
p(")")
p()
p("internal data class SdFixSpot(")
p("    val tool: SdTool,")
p("    /** 诊断候选（把病因说成孩子能懂的话） */")
p("    val options: List<String>,")
p("    /** 正确项下标 */")
p("    val answer: Int,")
p("    /** 为什么 */")
p("    val why: String,")
p("    val mark: SdSpotMark,")
p(")")
p()
p("internal data class SdFixCase(")
p("    val text: String,")
p("    /** 一处或多处病灶，按顺序作答 */")
p("    val spots: List<SdFixSpot>,")
p("    /** 订正后的整句（参考答案） */")
p("    val fixed: String,")
p(")")
p()
p("internal data class SdFixLevel(")
p("    val key: String,")
p("    val name: String,")
p("    /** 本关说明（✨ 提示用） */")
p("    val intro: String,")
p("    val items: List<SdFixCase>,")
p(")")
p()
p("/** 空位可选的标点牌（点一下追加到空位里，可叠两个，如「：」+ 前引号） */")
p("internal val SD_PUNCT_KEYS: List<SdPunctKey> = listOf(")
PUNCT_KEYS.forEach((k, i) => {
  p(`    SdPunctKey(${q(k.c)}, ${q(k.label)})${i < PUNCT_KEYS.length - 1 ? "," : ","}`)
})
p(")")
p()
p("/** 空位角色 → 提示语（✨ 提示里逐空点一下，但不给答案） */")
p("internal val SD_SLOT_HINT: Map<SdSlotKind, String> = mapOf(")
KINDS.forEach((k) => {
  p(`    SdSlotKind.${SLOT_KIND_ENUM[k]} to ${q(SLOT_HINT[k])},`)
})
p(")")
p()
p("/** 上半册：提示语标点 */")
p("internal val SD_PUNCT_LEVELS: List<SdPunctLevel> = listOf(")
PUNCT_LEVELS.forEach((lv) => {
  p("    SdPunctLevel(")
  p(`        key = ${q(lv.key)},`)
  p(`        name = ${q(lv.name)},`)
  p(`        rule = ${q(lv.rule)},`)
  p("        items = listOf(")
  lv.items.forEach((it) => {
    p("            SdPunctItem(")
    p(`                parts = listOf(${it.parts.map(q).join(", ")}),`)
    p("                slots = listOf(")
    it.slots.forEach((s) => {
      if (!s) {
        p("                    null,")
      } else {
        const ok = s.ok && s.ok.length ? `listOf(${s.ok.map(q).join(", ")})` : "emptyList()"
        p("                    SdPunctSlot(")
        p(`                        a = ${q(s.a)},`)
        p(`                        ok = ${ok},`)
        p(`                        kind = SdSlotKind.${SLOT_KIND_ENUM[s.kind]},`)
        p(`                        why = ${q(s.why)},`)
        p("                    ),")
      }
    })
    p("                ),")
    p(`                tip = ${q(it.tip)},`)
    p("            ),")
  })
  p("        ),")
  p("    ),")
})
p(")")
p()
p("/** 下半册：修改病句（7 处 `intro` / `why` 里带 markdown 粗体 `**`，渲染前用 sdStripBold 去掉） */")
p("internal val SD_FIX_LEVELS: List<SdFixLevel> = listOf(")
FIX_LEVELS.forEach((lv) => {
  p("    SdFixLevel(")
  p(`        key = ${q(lv.key)},`)
  p(`        name = ${q(lv.name)},`)
  p(`        intro = ${q(lv.intro)},`)
  p("        items = listOf(")
  lv.items.forEach((it) => {
    p("            SdFixCase(")
    p(`                text = ${q(it.text)},`)
    p("                spots = listOf(")
    it.spots.forEach((s) => {
      const m = s.mark
      const args: string[] = []
      if (m.cut !== undefined) args.push(`cut = ${q(m.cut)}`)
      if (m.put !== undefined) args.push(`put = ${q(m.put)}`)
      if (m.at !== undefined) args.push(`at = ${q(m.at)}`)
      if (m.with !== undefined) args.push(`with = ${q(m.with)}`)
      p("                    SdFixSpot(")
      p(`                        tool = SdTool.${TOOLS[s.tool]},`)
      p("                        options = listOf(")
      s.options.forEach((o) => p(`                            ${q(o)},`))
      p("                        ),")
      p(`                        answer = ${s.answer},`)
      p(`                        why = ${q(s.why)},`)
      p(`                        mark = SdSpotMark(${args.join(", ")}),`)
      p("                    ),")
    })
    p("                ),")
    p(`                fixed = ${q(it.fixed)},`)
    p("            ),")
  })
  p("        ),")
  p("    ),")
})
p(")")
p()

const text = L.join("\n")
writeFileSync(OUT, text, "utf8")

// ── 生成后再数一遍，确认落盘的文件里条目数量与源一致 ──
// ★ 必须排除 `data class SdXxx(` 那一行（声明也长得一样），否则恒多 1 —— 上一版就是这么骗过自己的
const written = text
const count = (name: string) => (written.match(new RegExp("(?<!data class )" + name + "\\(", "g")) ?? []).length
const cItems = count("SdPunctItem")
const cSlots = count("SdPunctSlot")
const cCases = count("SdFixCase")
const cSpots = count("SdFixSpot")
console.log(`标点册：${PUNCT_LEVELS.length} 关 / ${cItems} 句 / ${cSlots} 个空位`)
console.log(`病句册：${FIX_LEVELS.length} 关 / ${cCases} 句 / ${cSpots} 处病灶`)
console.log(`标点牌 ${PUNCT_KEYS.length} 个 / 手术刀 ${FIX_TOOLS.length} 把`)
if (cItems !== punctItems) throw new Error(`句数对不上：文件 ${cItems} vs 源 ${punctItems}`)
if (cCases !== fixItems) throw new Error(`病句句数对不上：文件 ${cCases} vs 源 ${fixItems}`)
if (cSpots !== fixSpots) throw new Error(`病灶数对不上：文件 ${cSpots} vs 源 ${fixSpots}`)
console.log(`→ 已写出 ${OUT}`)
