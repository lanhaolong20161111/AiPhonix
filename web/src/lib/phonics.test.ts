import { test } from "node:test"
import assert from "node:assert/strict"
import { isEnglishWord, joinPhonics, segmentPhonics, type PhonicType } from "./phonics"
import { POLYPHONE_EXCEPTIONS } from "./phonicsExceptions"

/** 把切分结果压成便于断言的紧凑串：#普通辅音 用单字母原样，其余按缩写 */
const ABBR: Record<PhonicType, string> = {
  consonant: "c",
  "vowel-single": "v",
  "vowel-long": "L",
  "vowel-team": "T",
  digraph: "d",
  silent: "s",
  other: "o",
}
function shape(word: string): string {
  return segmentPhonics(word)
    .map((x) => `${x.text}:${ABBR[x.type]}`)
    .join("|")
}
/** 某个字母跑到了哪个类别（字母可能和相邻同类字母并成一个块） */
function typeOfLetter(word: string, letter: string): PhonicType | undefined {
  return segmentPhonics(word).find((x) => x.text.toLowerCase().includes(letter.toLowerCase()))?.type
}
/** 元音块个数 —— 本功能的核心承诺是「色块数 == 真实元音音素个数」 */
function vowelBlocks(word: string): number {
  const VOWEL: PhonicType[] = ["vowel-single", "vowel-long", "vowel-team"]
  return segmentPhonics(word).filter((x) => VOWEL.includes(x.type)).length
}

test("magic-e：尾 e 不发音，前面的元音读长音", () => {
  assert.equal(shape("make"), "m:c|a:L|k:c|e:s")
  assert.equal(shape("cake"), "c:c|a:L|k:c|e:s")
  assert.equal(shape("home"), "h:c|o:L|m:c|e:s")
  assert.equal(shape("nice"), "n:c|i:L|c:c|e:s")
  assert.equal(shape("knife"), "k:s|n:c|i:L|f:c|e:s")
})

test("magic-e 跨轻后缀仍成立（homes / liked）", () => {
  assert.equal(shape("homes"), "h:c|o:L|m:c|e:s|s:c")
  assert.equal(shape("liked"), "l:c|i:L|k:c|e:s|d:c")
})

test("magic-e 不该误伤：尾 e 前不是「元音+辅音」时不触发", () => {
  // -le 结尾走「成音节的 l」那条规则（见下），元音保持单字母
  assert.equal(shape("apple"), "a:v|pp:d|le:T")
  // ⚠️ -le 前的元音是长是短无法从拼写判定（table 长 / apple 短），故保持单字母元音不动
  assert.equal(shape("table"), "t:c|a:v|b:c|le:T")
  // 末尾不是 e 的普通词不受影响
  assert.equal(shape("hello"), "h:c|e:v|ll:d|o:v")
})

test("★ 尾 e 判定不能抢走元音组合的字母（house / please / choose）", () => {
  // 曾把 house 的 u、please 的 a、choose 的第二个 o 先判成长元音，
  // 后面的 ou / ea / oo 因「跨越已判定位」匹配失败 → 一个音被拆成两块。
  assert.equal(shape("house"), "h:c|ou:T|s:c|e:s")
  assert.equal(shape("please"), "pl:c|ea:L|s:c|e:s")
  assert.equal(shape("choose"), "ch:d|oo:T|s:c|e:s")
  assert.equal(vowelBlocks("house"), 1)
  assert.equal(vowelBlocks("please"), 1)
  assert.equal(vowelBlocks("choose"), 1)
})

test("-tion/-sion/-cial：ti/ci 读 /ʃ/，算辅音组合不算元音", () => {
  assert.equal(shape("nation"), "n:c|a:L|ti:d|o:v|n:c")
  assert.equal(shape("question"), "qu:d|e:v|s:c|ti:d|o:v|n:c")
  assert.equal(shape("special"), "sp:c|e:v|ci:d|a:v|l:c")
  assert.equal(vowelBlocks("information"), 4)
})

test("-le / -al 成音节：末尾的 /əl/ 是一个真音节", () => {
  assert.equal(shape("apple"), "a:v|pp:d|le:T")
  assert.equal(shape("table"), "t:c|a:v|b:c|le:T")
  assert.equal(shape("little"), "l:c|i:v|tt:d|le:T")
  assert.equal(shape("people"), "p:c|eo:T|p:c|le:T")
  assert.equal(shape("animal"), "a:v|n:c|i:v|m:c|al:T")
})

test("屈折后缀 -ed / -es 自成音节（wanted / pages / houses）", () => {
  // -ed 在 t / d 之后读 /ɪd/
  assert.equal(shape("wanted"), "w:c|a:v|nt:c|e:v|d:c")
  assert.equal(shape("started"), "st:c|ar:T|t:c|e:v|d:c")
  assert.equal(vowelBlocks("needed"), 2)
  // 其它情况 -ed 的 e 仍是哑的
  assert.equal(shape("looked"), "l:c|oo:T|k:c|e:s|d:c")
  assert.equal(shape("played"), "pl:c|ay:L|e:s|d:c")
  // -es 在咝音后读 /ɪz/
  assert.equal(vowelBlocks("pages"), 2)
  assert.equal(vowelBlocks("houses"), 2)
  assert.equal(vowelBlocks("addresses"), 3)
})

test("词尾 -ying：y 是元音（trying / carrying）", () => {
  assert.equal(shape("trying"), "tr:c|y:v|i:v|ng:d")
  assert.equal(vowelBlocks("carrying"), 3)
})

test("词尾长元音族与 eigh / gu / que", () => {
  assert.equal(shape("eight"), "eigh:L|t:c")
  assert.equal(shape("weight"), "w:c|eigh:L|t:c")
  assert.equal(typeOfLetter("guard", "u"), "silent") // gu 的 u 只是软化标记
  assert.equal(vowelBlocks("guard"), 1)
  assert.equal(typeOfLetter("tongue", "u"), "silent") // -gue 的 ue 都不发音
  assert.equal(vowelBlocks("tongue"), 1)
})

test("例外词表：规则算不出来的词走人工切分", () => {
  for (const w of ["have", "give", "come", "love", "one", "said", "friend"]) {
    assert.equal(vowelBlocks(w), 1, `${w} 应当只有 1 个元音块`)
  }
  // business 是 /ˈbɪznəs/ —— 两个元音，靠例外表把中间的 i 标成哑音才对
  assert.equal(typeOfLetter("business", "i"), "silent")
  assert.equal(vowelBlocks("business"), 2)
  assert.equal(shape("have"), "h:c|a:v|v:c|e:s")
  assert.equal(shape("colour"), "c:c|o:v|l:c|our:T")
  assert.equal(vowelBlocks("colour"), 2)
})

test("例外词表自检：所有条目的字母拼起来必须等于单词本身", () => {
  for (const [word, chunks] of POLYPHONE_EXCEPTIONS) {
    assert.equal(joinPhonics(chunks), word, `例外表条目 ${word} 的切分与单词对不上`)
    assert.ok(chunks.length > 0)
  }
})

test("★ 相邻元音块绝不合并（块边界才是要教的东西）", () => {
  // flower = fl + ow + er：两个不同的组合元音，合并会让孩子误以为是一个音块
  assert.equal(shape("flower"), "fl:c|ow:T|er:T")
  assert.equal(segmentPhonics("flower").filter((x) => x.type === "vowel-team").length, 2)
})

test("长元音组合：ai / ea / ee / oa / igh 归「长元音」", () => {
  assert.equal(shape("rain"), "r:c|ai:L|n:c")
  assert.equal(shape("teacher"), "t:c|ea:L|ch:d|er:T")
  assert.equal(shape("night"), "n:c|igh:L|t:c")
  assert.equal(shape("boat"), "b:c|oa:L|t:c")
  assert.equal(shape("green"), "gr:c|ee:L|n:c")
})

test("组合元音：oo / oi / ou / ow + r 控制元音", () => {
  assert.equal(shape("book"), "b:c|oo:T|k:c")
  assert.equal(shape("coin"), "c:c|oi:T|n:c")
  assert.equal(shape("father"), "f:c|a:v|th:d|er:T")
  assert.equal(shape("car"), "c:c|ar:T")
  assert.equal(shape("bird"), "b:c|ir:T|d:c")
})

test("辅音组合与双写辅音", () => {
  assert.equal(shape("ship"), "sh:d|i:v|p:c")
  assert.equal(shape("watch"), "w:c|a:v|tch:d")
  assert.equal(shape("summer"), "s:c|u:v|mm:d|er:T")
  assert.equal(shape("bridge"), "br:c|i:v|dge:d")
  assert.equal(shape("quick"), "qu:d|i:v|ck:d")
})

test("不发音字母：词首 kn/wr、词尾 gn/mb、-alk 的 l", () => {
  assert.equal(typeOfLetter("knee", "k"), "silent")
  assert.equal(typeOfLetter("write", "w"), "silent")
  assert.equal(typeOfLetter("sign", "g"), "silent")
  assert.equal(typeOfLetter("lamb", "b"), "silent")
  assert.equal(typeOfLetter("walk", "l"), "silent")
  // signal 的 g 要发音（gn 只在收尾时才算不发音）
  assert.equal(typeOfLetter("signal", "g"), "consonant")
})

test("标点、撇号、连字符归 other，且不影响字母切分", () => {
  assert.equal(shape("father?"), "f:c|a:v|th:d|er:T|?:o")
  assert.equal(shape("don't"), "d:c|o:v|n:c|':o|t:c")
  assert.equal(shape("(big)"), "(:o|b:c|i:v|g:c|):o")
  assert.equal(joinPhonics(segmentPhonics("well-known!")), "well-known!")
})

test("大小写不改变切分结果（保留原文大小写）", () => {
  const types = (w: string) => segmentPhonics(w).map((x) => x.type)
  assert.deepEqual(types("Tom"), types("tom"))
  assert.deepEqual(types("CHINA"), types("china"))
  assert.equal(joinPhonics(segmentPhonics("Tom")), "Tom")
})

test("词尾 y 当元音；词中 y 仍是辅音", () => {
  assert.equal(typeOfLetter("happy", "y"), "vowel-single")
  assert.equal(typeOfLetter("yes", "y"), "consonant")
  assert.equal(typeOfLetter("yellow", "y"), "consonant")
})

test("切分结果可无损还原原文", () => {
  for (const w of ["father", "make?", "don't", "well-known", "apple", "knife", "homes", "China!"]) {
    assert.equal(joinPhonics(segmentPhonics(w)), w)
  }
})

test("边界：空串 / 单字母 / 纯符号 / 纯数字", () => {
  assert.deepEqual(segmentPhonics(""), [])
  assert.equal(shape("a"), "a:v")
  assert.equal(shape("I"), "I:v")
  assert.equal(shape("!!!"), "!!!:o")
  assert.equal(shape("3.5"), "3.5:o")
})

test("isEnglishWord：只有英文单词才着色（生词本中英混排用）", () => {
  assert.equal(isEnglishWord("father"), true)
  assert.equal(isEnglishWord("don't"), true)
  assert.equal(isEnglishWord("well-known"), true)
  assert.equal(isEnglishWord("  Tom  "), true)
  assert.equal(isEnglishWord("爸爸"), false)
  assert.equal(isEnglishWord("我"), false)
  assert.equal(isEnglishWord("3.5"), false)
  assert.equal(isEnglishWord("cat?"), false)
  assert.equal(isEnglishWord(""), false)
})

test("缓存：同一单词多次调用结果稳定且不串味", () => {
  const a = segmentPhonics("father")
  const b = segmentPhonics("father")
  assert.deepEqual(a, b)
  assert.deepEqual(segmentPhonics("mother").map((x) => x.type), segmentPhonics("father").map((x) => x.type))
})
