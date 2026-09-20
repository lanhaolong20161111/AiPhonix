import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanSentence, extractEnglishVocab, extractWords, normalizeOcrText } from "./enVocabExtract"

test("整段课文：按句末标点切句，词表去重", () => {
  const v = extractEnglishVocab(
    "I have a happy family. My father is a doctor. My mother is a teacher. She likes reading books.",
  )
  assert.deepEqual(v.sentences, [
    "I have a happy family.",
    "My father is a doctor.",
    "My mother is a teacher.",
    "She likes reading books.",
  ])
  // my/father/is 等虚词被剔除；happy 保留
  assert.ok(v.words.includes("happy"))
  assert.ok(v.words.includes("doctor"))
  assert.ok(v.words.includes("reading"))
  assert.equal(v.words.includes("my"), false)
  assert.equal(v.words.includes("is"), false)
})

test("句首大写词的词形落成小写，专有名词保留大写", () => {
  const w = extractWords("My father is here. Father and Tom go home. Tom is happy.")
  assert.ok(w.includes("father"), `father 应为小写，实际 ${w.join(",")}`)
  assert.ok(w.includes("Tom"), "Tom 出现在句中 → 判为专有名词保留原形")
  assert.equal(w.includes("My"), false)
})

test("只在句首出现过的大写词也进小写（Look / New）", () => {
  const w = extractWords("Look at the picture. New words are here.")
  assert.ok(w.includes("look"), `look 应为小写，实际 ${w.join(",")}`)
  assert.ok(w.includes("new"))
  assert.equal(w.includes("Look"), false)
})

test("虚词开关：keepStop=true 时保留 the/is（单字母 a/I 一律不进词表）", () => {
  const a = extractEnglishVocab("This is a red apple.")
  assert.equal(a.words.includes("is"), false)
  assert.equal(a.words.includes("the"), false)
  const b = extractEnglishVocab("This is a red apple and the cat is here.", { keepStop: true })
  assert.ok(b.words.some((w) => w.toLowerCase() === "is"))
  assert.ok(b.words.some((w) => w.toLowerCase() === "the"))
  assert.equal(b.words.includes("a"), false, "单字母词不作为练习词")
})

test("中文注释行被剥掉，且中文句号也作为断句符", () => {
  const v = extractEnglishVocab("Look at the picture. 看图片。This is my mother. 这是我的妈妈。")
  assert.deepEqual(v.sentences, ["Look at the picture.", "This is my mother."])
})

test("小数与缩写不误切句", () => {
  const v = extractEnglishVocab("The box is 3.5 kilos. Mr. Wang is here. He likes U.S. cartoons.")
  assert.equal(v.sentences.length, 3)
  assert.equal(v.sentences[0], "The box is 3.5 kilos.")
  assert.ok(v.sentences[2].includes("U.S."))
})

test("单词表行（无标点、3 个词）不当句子；4 个词的无标点行当句子", () => {
  const v = extractEnglishVocab("apple banana orange\nMy mother is a teacher")
  assert.equal(v.sentences.includes("apple banana orange"), false)
  assert.ok(v.sentences.includes("My mother is a teacher"))
  assert.deepEqual(v.words.slice(0, 3), ["apple", "banana", "orange"])
})

test("页码/序号/版面前缀整行剔除（句子与单词都不含 Unit/write）", () => {
  const v = extractEnglishVocab("12\nUnit 3 My Family\n1. I like apples.\nLesson 2\nRead and write.\nSay hello to your friend.")
  assert.deepEqual(v.sentences, ["I like apples.", "Say hello to your friend."])
  assert.equal(v.words.includes("12"), false)
  // 版面前缀行整行丢弃：Unit / write 不再进词表（family 只出现在被丢弃的标题行里 → 也不进）
  assert.equal(v.words.includes("unit"), false)
  assert.equal(v.words.includes("write"), false)
  assert.equal(v.words.includes("family"), false)
  assert.ok(v.words.includes("apples"))
})

test("全角标点与弯引号先归一化", () => {
  assert.equal(normalizeOcrText("I like apples．").trim(), "I like apples.")
  assert.equal(normalizeOcrText("It\u2019s a book").trim(), "It's a book")
  const v = extractEnglishVocab("It\u2019s a cat． I like it！")
  assert.equal(v.sentences.length, 2)
})

test("噪声词（≤3 字母且无元音）被剔除，有 y 的短词保留", () => {
  // keepStop=true 隔离掉虚词表的影响，单测「无元音」这一条规则
  const w = extractWords("mm qq tv by try", true)
  assert.equal(w.includes("mm"), false)
  assert.equal(w.includes("tv"), false)
  assert.ok(w.includes("by"))
  assert.ok(w.includes("try"))
})

test("不依赖输入顺序去重（大小写/标点不同视为同一句）", () => {
  const v = extractEnglishVocab("Hello, Tom! hello tom")
  assert.equal(v.sentences.length, 1)
})

test("超上限截断并置标志", () => {
  const many = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ")
  const v = extractEnglishVocab(many, { maxSentences: 5 })
  assert.equal(v.sentences.length, 5)
  assert.equal(v.sentencesTruncated, true)
  const words = extractEnglishVocab("apple banana cherry date elderberry fig grape honey ice jam", { maxWords: 3 })
  assert.equal(words.words.length, 3)
  assert.equal(words.wordsTruncated, true)
})

test("空输入安全返回空结果", () => {
  const v = extractEnglishVocab("")
  assert.deepEqual(v, { words: [], sentences: [], wordsTruncated: false, sentencesTruncated: false })
  assert.deepEqual(extractEnglishVocab("   \n  ").words, [])
})

test("cleanSentence 边界", () => {
  assert.equal(cleanSentence("。"), "")
  assert.equal(cleanSentence("A."), "") // 词数不足
  assert.equal(cleanSentence("1."), "")
  assert.equal(cleanSentence("It is."), "It is.")
})
