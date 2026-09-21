/** phonicsTips 单测 —— 音素要领表的查询归一化与覆盖完整性 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { phoneTip, hasLocalTip, localTipText, LOCAL_TIP_COUNT, tipSpeechText, tipNeedsSpeechFix } from "./phonicsTips"
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

// ══════════════════════════════════════════════════════════════════
// 朗读文本处理 (tipSpeechText)
//
// 实测依据（2026-09-21，百度 TTS + ASR 回灌）：
//   孤立字母 "f" → 读成字母名「艾弗」（ASR 转出 `F。`）
//   整词 "friend" → 正常读英文单词
// ⇒ 音素符号必须替换，整词必须保留。
// ══════════════════════════════════════════════════════════════════

test("朗读：孤立的音素符号被换成「这个音」", () => {
  const src = "读friend的f时，上牙轻轻咬下嘴唇再送气哦"
  const out = tipSpeechText(src, ["f"])
  assert.ok(!/的f/.test(out), `不该残留「的f」：${out}`)
  assert.match(out, /读friend的这个音时/)
})

test("朗读：整词 friend 必须原样保留（它是参考词，读出来是对的）", () => {
  const out = tipSpeechText("读friend的f时，上牙轻轻咬下嘴唇再送气哦", ["f"])
  assert.match(out, /friend/)
})

test("朗读：多个音素各自所在句子的符号都替换", () => {
  const out = tipSpeechText("读lily的l时舌尖顶上牙床，读lily的ih时嘴要放松", ["l", "ih"])
  assert.ok(!/的l时/.test(out), `残留了 l：${out}`)
  assert.ok(!/的ih时/.test(out), `残留了 ih：${out}`)
  assert.match(out, /读lily的这个音时/)
})

test("朗读：/f/ 这种带定界符的整块替换", () => {
  assert.match(tipSpeechText("发/f/的时候上牙咬下唇", ["f"]), /发这个音的时候/)
  assert.match(tipSpeechText("发[th]的时候舌尖伸出来", ["th"]), /发这个音的时候/)
})

test("朗读：本地表文案（纯中文）跑一遍不变 —— 幂等", () => {
  const codes = ["th", "dh", "r", "l", "v", "f", "w", "sh", "iy", "eh", "ay", "er"]
  for (const c of codes) {
    const tip = phoneTip(c)!.tip
    assert.equal(tipSpeechText(tip, [c]), tip, `${c} 的本地文案被改动了：${tip}`)
    assert.equal(tipNeedsSpeechFix(tip, [c]), false, `${c} 不该被判为需要修正`)
  }
})

test("朗读：无音素码的纯中文原样返回", () => {
  const s = "舌尖轻轻伸到上下牙齿中间，送气"
  assert.equal(tipSpeechText(s, []), s)
})

test("朗读：空串安全", () => {
  assert.equal(tipSpeechText("", ["f"]), "")
})

test("朗读：不会把「的」重复成「的这个音的音」", () => {
  const out = tipSpeechText("读friend的f时要注意", ["f"])
  assert.ok(!/这个音的这个音/.test(out), `出现重复：${out}`)
})

test("朗读：★ 不能改坏「别读成 s 或 z」这类句子（s/z 是错误读法，替换会失去意义）", () => {
  // 本地表 th 的文案就是这种：把 s/z 换成「这个音」会让句子变成废话
  const th = phoneTip("th")!.tip
  assert.match(th, /别读成 s 或 z/)
  assert.equal(tipSpeechText(th, ["th"]), th, "本地 th 文案被改坏了")
  // 同理：r 的「别读成汉语的 r」——末尾那个 r 也不能动
  const r = phoneTip("r")!.tip
  assert.match(r, /别读成汉语的 r/)
  assert.equal(tipSpeechText(r, ["r"]), r, "本地 r 文案被改坏了")
})
