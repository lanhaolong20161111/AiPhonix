/** phonicsTips 单测 —— 音素要领表的查询归一化与覆盖完整性 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { phoneTip, hasLocalTip, localTipText, LOCAL_TIP_COUNT } from "./phonicsTips"
import { arpabetToIpa } from "./arpabet"

test("小写音素码能查到（智聆返回小写）", () => {
  assert.ok(phoneTip("th"))
  assert.match(phoneTip("th")!.tip, /牙齿/)
})

test("大写音素码能查到", () => {
  assert.equal(phoneTip("TH")?.tip, phoneTip("th")?.tip)
})

test("尾随重音数字被忽略（ah0 → AH）", () => {
  // AH0 有自己的条目；AH 也有。分别验证两种
  assert.ok(phoneTip("ah0"))
  assert.ok(phoneTip("er0"))
  assert.ok(phoneTip("th1"))
})

test("带逗号的 r 双元音（ih,r）能查到", () => {
  assert.ok(phoneTip("ih,r"))
  assert.equal(phoneTip("ih,r")?.tip, phoneTip("ihr")?.tip)
})

test("未知音素返回 null，不抛异常", () => {
  assert.equal(phoneTip("zzz"), null)
  assert.equal(phoneTip(""), null)
  assert.equal(phoneTip("   "), null)
})

test("带声调数字的拼音韵母查不到（不在本表范围）", () => {
  assert.equal(phoneTip("o1"), null)
  assert.equal(phoneTip("ui1"), null)
  assert.equal(phoneTip("ang4"), null)
})

test("⚠️ 中文声母 zh 会撞上英文 ZH 的要领（已知且无害）", () => {
  // 中文 SOE 的声母码与英文智聆音素码共用一套字母，`zh`/`sh`/`ch` 天然重叠。
  // 这本身没问题：调用方（SoeDetail）只在**英文引擎**的低分音素上渲染要领，
  // 中文页面根本不会走到这里；此处把行为固化下来，免得将来有人误以为丢了条数据。
  assert.equal(phoneTip("zh")?.tip, phoneTip("ZH")?.tip)
  assert.ok(phoneTip("zh"))
})

test("hasLocalTip 与 phoneTip 一致", () => {
  assert.equal(hasLocalTip("th"), true)
  assert.equal(hasLocalTip("zzz"), false)
})

test("localTipText 返回要领原文", () => {
  assert.equal(localTipText("v"), phoneTip("v")!.tip)
  assert.equal(localTipText("zzz"), null)
})

test("每条要领都非空且不过长（一句话）", () => {
  // 抽查若干条：必须是非空字符串，且长度在合理区间
  const samples = ["th", "r", "v", "iy", "ay", "er", "ah0"]
  for (const p of samples) {
    const tip = phoneTip(p)!.tip
    assert.ok(tip.length > 0, `${p} 要领为空`)
    assert.ok(tip.length <= 40, `${p} 要领过长（${tip.length}）：${tip}`)
    assert.ok(!tip.includes("\n"), `${p} 要领不该有换行`)
  }
})

test("本地表覆盖了全部英文辅音（arpabet 表里的辅音子集）", () => {
  // arpabet 里不含字母的辅音 + 易错辅音，都应在本表有要领
  const required = [
    "th", "dh", "r", "l", "v", "f", "w", "sh", "zh", "ch", "jh",
    "ng", "n", "m", "hh", "y", "k", "g", "t", "d", "p", "b", "s", "z",
  ]
  for (const p of required) {
    assert.ok(phoneTip(p), `辅音 ${p} 缺少要领`)
  }
})

test("本地表覆盖了全部单元音与双元音", () => {
  const required = [
    "iy", "ih", "eh", "ae", "ah", "aa", "ao", "uh", "uw",
    "ay", "ey", "ow", "oy", "aw",
    "er", "er0", "ihr", "ehr", "uhr", "ah0",
  ]
  for (const p of required) {
    assert.ok(phoneTip(p), `元音 ${p} 缺少要领`)
  }
})

test("覆盖数量与表大小一致（防手滑删条目）", () => {
  assert.ok(LOCAL_TIP_COUNT >= 44, `条目太少：${LOCAL_TIP_COUNT}`)
})

test("被覆盖的音素都是 arpabet 能转出 IPA 的（防止表里写了错码）", () => {
  // 反向校验：所有本地要领的音素码，丢给 arpabetToIpa 都应该转出**与音素码不同**的 IPA。
  // arpabetToIpa 查不到时会返回 `/${phone}/`（原样回显），据此可发现拼错的键。
  // ⚠️ 例外：`r`/`l`/`b`/`d`/`g`/`k`/`m`/`n`/`p`/`s`/`t`/`v`/`w`/`z`/`f` 这些
  //    符号本身就叫 r/l/b…，IPA 与音素码**天然同形**，不能用「是否原样回显」判错。
  const AMBIGUOUS = new Set(["r", "l", "b", "d", "g", "k", "m", "n", "p", "s", "t", "v", "w", "z", "f"])
  const codes = [
    "th", "dh", "r", "l", "v", "f", "w", "sh", "zh", "ch", "jh",
    "ng", "n", "m", "hh", "y", "k", "g", "t", "d", "p", "b", "s", "z",
    "iy", "ih", "eh", "ae", "ah", "aa", "ao", "uh", "uw",
    "ay", "ey", "ow", "oy", "aw",
  ]
  for (const p of codes) {
    if (AMBIGUOUS.has(p)) continue
    const ipa = arpabetToIpa(p, "uk")
    assert.notEqual(ipa, `/${p}/`, `音素码 ${p} 在 arpabet 表里不存在（会原样回显）`)
  }
})

test("每条要领都不含方括号/引号等易渲染出错的字符", () => {
  const codes = [
    "th", "dh", "r", "l", "v", "f", "w", "sh", "zh", "ch", "jh",
    "ng", "n", "m", "hh", "y", "k", "g", "t", "d", "p", "b", "s", "z",
    "iy", "ih", "eh", "ae", "ah", "aa", "ao", "uh", "uw",
    "ay", "ey", "ow", "oy", "aw", "er", "er0", "ihr", "ehr", "uhr", "ah0",
  ]
  for (const p of codes) {
    const tip = phoneTip(p)!.tip
    assert.ok(!/[<>"]/.test(tip), `${p} 要领含危险字符：${tip}`)
  }
})
