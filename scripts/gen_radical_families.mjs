#!/usr/bin/env node
/**
 * 从 web/src/data/radicalFamilies.ts 生成 Android 端 Kotlin 字族数据。
 *
 * 用法：node scripts/gen_radical_families.mjs
 * 产物：app/src/main/java/com/example/ai/data/radical/RadicalFamilies.kt
 *
 * 为什么用脚本而不是手抄：34 个字族 / 约 150 个字的「偏旁·偏旁名·含义·例词·读音例外」
 * 是手工核对过的教学数据，手工转录必出错。改数据请改 web 的 radicalFamilies.ts 后重跑本脚本。
 *
 * 解析要点（踩过的坑）：定位到 `export const RADICAL_FAMILIES` 后先找 `=`，再从 `=` **之后**
 * 找第一个 `[` 做括号匹配 —— 不能直接找 `[`，否则会匹配到类型标注 `RadicalFamily[]` 的空括号。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const SRC = join(root, "web", "src", "data", "radicalFamilies.ts")
const OUT_DIR = join(root, "app", "src", "main", "java", "com", "example", "ai", "data", "radical")
const OUT = join(OUT_DIR, "RadicalFamilies.kt")

const src = readFileSync(SRC, "utf8")

const declIdx = src.indexOf("export const RADICAL_FAMILIES")
if (declIdx < 0) throw new Error("找不到 RADICAL_FAMILIES 声明")
const eqIdx = src.indexOf("=", declIdx)
if (eqIdx < 0) throw new Error("找不到赋值符 =")
const start = src.indexOf("[", eqIdx)
if (start < 0) throw new Error("找不到数组起始 [")

// 括号匹配（跳过字符串字面量，防方括号出现在字符串里）
let depth = 0
let end = -1
let inStr = null
let esc = false
for (let i = start; i < src.length; i++) {
  const c = src[i]
  if (inStr) {
    if (esc) { esc = false; continue }
    if (c === "\\") { esc = true; continue }
    if (c === inStr) inStr = null
    continue
  }
  if (c === '"' || c === "'" || c === "`") { inStr = c; continue }
  if (c === "[") depth++
  else if (c === "]") { depth--; if (depth === 0) { end = i; break } }
}
if (end < 0) throw new Error("数组括号不匹配")

const arrayText = src.slice(start, end + 1)
// 安全性：只接受纯字面量（无函数/引用），否则求值会静默拿到别的东西
if (/=>|\bfunction\b|\brequire\(|\bimport\b/.test(arrayText)) {
  throw new Error("数组里出现了表达式，本脚本只支持纯字面量，请升级解析逻辑")
}
const families = new Function("return (" + arrayText + ")")()

// ── 校验 ──
if (!Array.isArray(families) || families.length === 0) throw new Error("解析结果不是非空数组")
const ITEM_KEYS = ["char", "pinyin", "radical", "radicalName", "radicalMeaning", "word"]
for (const f of families) {
  for (const k of ["base", "pinyin", "items"]) {
    if (!(k in f)) throw new Error(`字族 ${f.base ?? "?"} 缺字段 ${k}`)
  }
  if (!Array.isArray(f.items) || f.items.length === 0) throw new Error(`字族 ${f.base} 没有 items`)
  for (const it of f.items) {
    for (const k of ITEM_KEYS) {
      if (typeof it[k] !== "string" || it[k] === "") {
        throw new Error(`字族 ${f.base} 的字 ${it.char ?? "?"} 字段 ${k} 缺失或非字符串`)
      }
    }
  }
}

/** Kotlin 字符串字面量转义（含 $ 插值符） */
const kstr = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$") + '"'

const L = []
L.push("package com.example.ai.data.radical")
L.push("")
L.push("// 本文件由 scripts/gen_radical_families.mjs 自动生成 —— 勿手改。")
L.push("// 数据源：web/src/data/radicalFamilies.ts（改数据请改 web 那份后重新生成）")
L.push("")
L.push("/** 字族里的一个字：形旁（偏旁）管意思，声旁管读音 */")
L.push("data class RadicalItem(")
L.push("    val char: String,")
L.push("    val pinyin: String,")
L.push("    val radical: String,          // 形旁符号")
L.push("    val radicalName: String,      // 偏旁名称（如「三点水」）")
L.push("    val radicalMeaning: String,   // 形旁含义提示（如「和水有关」）")
L.push("    val word: String,             // 例词（必含 char）")
L.push("    val exception: String = \"\", // 读音与声旁差远时的例外说明")
L.push(")")
L.push("")
L.push("/** 一个声旁字族（同一声旁 + 不同形旁） */")
L.push("data class RadicalFamily(")
L.push("    val base: String,             // 声旁基础字")
L.push("    val pinyin: String,")
L.push("    val items: List<RadicalItem>,")
L.push(")")
L.push("")
L.push("/** 全部字族（顺序 = web 的 RADICAL_FAMILIES 顺序） */")
L.push("object RadicalFamilies {")
L.push("    val ALL: List<RadicalFamily> = listOf(")
families.forEach((f) => {
  L.push("        RadicalFamily(")
  L.push(`            base = ${kstr(f.base)},`)
  L.push(`            pinyin = ${kstr(f.pinyin)},`)
  L.push("            items = listOf(")
  f.items.forEach((it) => {
    const args = [
      kstr(it.char),
      kstr(it.pinyin),
      kstr(it.radical),
      kstr(it.radicalName),
      kstr(it.radicalMeaning),
      kstr(it.word),
    ]
    if (it.exception) args.push(kstr(it.exception))
    L.push(`                RadicalItem(${args.join(", ")}),`)
  })
  L.push("            ),")
  L.push("        ),")
})
L.push("    )")
L.push("")
L.push("    /** 全部字（去重前 = 各字族 items 之和） */")
L.push("    val ALL_CHARS: List<String> = ALL.flatMap { f -> f.items.map { it.char } }")
L.push("")
L.push("    /** 全部偏旁（去重） */")
L.push("    val ALL_RADICALS: List<String> = ALL.flatMap { f -> f.items.map { it.radical } }.distinct()")
L.push("}")
L.push("")

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, L.join("\n"), "utf8")

const charCount = families.reduce((n, f) => n + f.items.length, 0)
console.log(`✅ 生成 ${OUT}`)
console.log(`   字族 ${families.length} 个 · 字 ${charCount} 个 · 去重偏旁 ${new Set(families.flatMap((f) => f.items.map((i) => i.radical))).size} 个`)
