import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { formatSoeScore, isSoeMissing, restoreWordCase, soeScoreClass, withRefCase } from "./soeDisplay"
import type { SoeWord } from "./soeApi"

/** 造一个词级单位（默认含音素） */
function word(w: string, accuracy: number, matchTag = 0, phones: SoeWord["phone_infos"] = []): SoeWord {
  return { word: w, accuracy, match_tag: matchTag, phone_infos: phones }
}

describe("isSoeMissing / formatSoeScore", () => {
  test("MatchTag=2 即缺读（腾讯的漏读标记）", () => {
    assert.equal(isSoeMissing(-1, 2), true)
    assert.equal(isSoeMissing(0, 2), true, "有分但标了 2 仍算缺读")
    assert.equal(formatSoeScore(-1, 2), "未读")
  })

  test("PronAccuracy < 0 即缺读，绝不显示 -1", () => {
    for (const v of [-1, -0.5, -100]) {
      assert.equal(isSoeMissing(v), true, `${v} 应判为缺读`)
    }
    assert.equal(formatSoeScore(-1), "未读")
    assert.notEqual(formatSoeScore(-1), "-1")
  })

  test("NaN / undefined / null 视为无数据（缺读）", () => {
    assert.equal(isSoeMissing(Number.NaN), true)
    assert.equal(isSoeMissing(undefined), true)
    assert.equal(isSoeMissing(null), true)
    assert.equal(formatSoeScore(Number.NaN), "未读")
  })

  test("0 分是「读得很差」而不是缺读（必须区分）", () => {
    assert.equal(isSoeMissing(0), false)
    assert.equal(formatSoeScore(0), "0")
  })

  test("正常分四舍五入取整", () => {
    assert.equal(formatSoeScore(91.5), "92")
    assert.equal(formatSoeScore(58.3), "58")
    assert.equal(formatSoeScore(3.1), "3")
  })
})

describe("soeScoreClass", () => {
  test("色阶阈值 80 / 60", () => {
    assert.equal(soeScoreClass(80), "good")
    assert.equal(soeScoreClass(79.9), "ok")
    assert.equal(soeScoreClass(60), "ok")
    assert.equal(soeScoreClass(59.9), "bad")
  })

  test("缺读归 miss（灰），不归 bad（红）", () => {
    assert.equal(soeScoreClass(-1, 2), "miss")
    assert.equal(soeScoreClass(-1), "miss")
  })
})

describe("restoreWordCase", () => {
  test("英文 SOE 全小写 → 按参考文本还原", () => {
    const words = [word("i", 91.5), word("see", 92.4), word("a", 96.4), word("red", 82.1), word("apple", 42)]
    const out = restoreWordCase(words, "I see a red apple")
    assert.deepEqual(out.map((w) => w.word), ["I", "see", "a", "red", "apple"])
  })

  test("专名首字母还原（Lily / China）", () => {
    const words = [word("lily", 18.3), word("is", 28.6), word("my", 96.3), word("best", 86.7), word("friend", 43.8)]
    assert.deepEqual(
      restoreWordCase(words, "Lily is my best friend.").map((w) => w.word),
      ["Lily", "is", "my", "best", "friend"],
    )
    assert.deepEqual(
      restoreWordCase([word("i", 90), word("love", 90), word("china", 90)], "I love China!").map((w) => w.word),
      ["I", "love", "China"],
    )
  })

  test("标点不影响对齐（词表已去掉标点）", () => {
    const words = [word("play", 58), word("games", 70), word("school", -1, 2)]
    assert.deepEqual(
      restoreWordCase(words, "I play games after school.").map((w) => w.word),
      ["play", "games", "school"],
    )
  })

  test("SOE 漏词（返回词少于参考文本）时仍按顺序对齐", () => {
    const words = [word("i", 90), word("games", 70)]
    assert.deepEqual(restoreWordCase(words, "I play Games").map((w) => w.word), ["I", "Games"])
  })

  test("重复词不串位（the cat and the dog）", () => {
    const words = [word("the", 90), word("cat", 90), word("and", 90), word("the", 90), word("dog", 90)]
    assert.deepEqual(
      restoreWordCase(words, "The cat and the dog").map((w) => w.word),
      ["The", "cat", "and", "the", "dog"],
    )
  })

  test("参考文本里找不到的词保持原样（不猜）", () => {
    const words = [word("hello", 90), word("xyz", 80)]
    assert.deepEqual(restoreWordCase(words, "hello world").map((w) => w.word), ["hello", "xyz"])
  })

  test("中文/空文本 → 原样返回，不误伤", () => {
    const zh = [word("学", 90), word("习", 80)]
    assert.deepEqual(restoreWordCase(zh, "学习").map((w) => w.word), ["学", "习"])
    assert.deepEqual(restoreWordCase(zh, "").map((w) => w.word), ["学", "习"])
    assert.deepEqual(restoreWordCase([], "I am").length, 0)
  })

  test("不改原数组（返回新对象）", () => {
    const words = [word("i", 90)]
    const out = restoreWordCase(words, "I am")
    assert.equal(words[0].word, "i", "原数组不能被改写")
    assert.equal(out[0].word, "I")
  })

  test("撇号：both typographic and straight", () => {
    const words = [word("don't", 88)]
    assert.deepEqual(restoreWordCase(words, "Don't run").map((w) => w.word), ["Don't"])
    assert.deepEqual(restoreWordCase([word("it's", 88)], "It\u2019s ok").map((w) => w.word), ["It\u2019s"])
  })

  test("词号/数字混合", () => {
    const words = [word("unit", 80), word("3", 80)]
    assert.deepEqual(restoreWordCase(words, "Unit 3 is fun").map((w) => w.word), ["Unit", "3"])
  })
})

describe("withRefCase", () => {
  test("返回新 result 且保留其它字段", () => {
    const r = {
      engine: "16k_en",
      eval_mode: "1",
      pron_accuracy: 61.2,
      pron_fluency: 70,
      pron_completion: 100,
      suggested_score: 61,
      words: [word("i", 90), word("see", 80)],
    }
    const out = withRefCase(r, "I see")
    assert.equal(out.pron_accuracy, 61.2)
    assert.equal(out.engine, "16k_en")
    assert.deepEqual(out.words.map((w) => w.word), ["I", "see"])
    assert.equal(r.words[0].word, "i", "原 result 不被改写")
  })

  test("无 words / 空 words 时原样返回", () => {
    const r = { engine: "16k_en", words: [] as SoeWord[] }
    assert.equal(withRefCase(r, "I see"), r)
  })
})
