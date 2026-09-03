/** 百度 TTS 多音字注音工具
 *
 * ⚠️ 语法为实测确认（2026-08-30，对生产 /api/v1/tts/synthesize 做对照实验）：
 *
 *   生效：字(拼音数字调)    例 重(zhong4)庆 / 银行(xing2) / 好(hao3)的(de5)
 *        - 数字调 1~5 均可（5 = 轻声），大小写不敏感
 *   无效：{字^拼音}          —— 旧实现的写法，拼音会被当字面内容念出来
 *        字(声调符号)        —— 如 重(zhòng)庆，同样被当字面念
 *        字(无声调)          —— 如 重(zhong)庆，同样被当字面念
 *
 *   判据（对照实验）：
 *     - 标注成与默认相同的音 → 音频与原文字节级一致（md5 相同）
 *     - 标注成异音           → 音频长度不变、仅内容变化
 *     - 语法无效时           → 音频明显变长（拼音字母被追加念出）
 *
 * 本文件同时修掉了旧实现 useBlockSpeaking 的 {字^拼音}（无效语法）。
 */

import { normalizePinyin } from "./pinyin"
import { isPolyphone } from "../data/polyphoneChars"

/** 汉字范围（不含标点、字母、数字） */
const CJK = /[\u4e00-\u9fa5]/

/** 百度可识别的音节：字母 + 数字调 1~5 */
const BAIDU_SYL = /^[a-z]+[1-5]$/

/**
 * 拼音 → 百度可识别的数字调音节；非法输入返回 ""。
 * "zhòng" → "zhong4"；"zhong4" → "zhong4"；"zhong"（无声调）→ ""
 */
export function toBaiduSyllable(syl: string): string {
  const s = normalizePinyin(syl).trim().toLowerCase()
  return BAIDU_SYL.test(s) ? s : ""
}

export interface AnnotateOptions {
  /** 只给多音字注音（默认 true）。false = 给所有有拼音的字都注音。 */
  polyphoneOnly?: boolean
}

/**
 * 给中文文本标注读音，产出百度 TTS 的 tex。
 *
 * 安全策略：字数与音节数对不上、或音节格式非法时，**原样返回文本**，
 * 宁可让百度自由发挥，也绝不把文本改坏。
 *
 * @param text   中文原文
 * @param pinyin 与 text 逐字对应的拼音（空格分隔，可带声调符号或数字调）
 */
export function annotateTts(
  text: string,
  pinyin?: string,
  opts: AnnotateOptions = {},
): string {
  const polyphoneOnly = opts.polyphoneOnly ?? true
  if (!text || !pinyin || !pinyin.trim()) return text

  const syls = normalizePinyin(pinyin).trim().split(/\s+/).filter(Boolean)
  if (!syls.length) return text

  const chars = [...text]
  const cnCount = chars.filter((c) => CJK.test(c)).length
  // 字数与音节数必须严格一致，否则无法保证逐字对齐
  if (cnCount !== syls.length) return text

  let si = 0
  return chars
    .map((ch) => {
      if (!CJK.test(ch)) return ch
      const py = toBaiduSyllable(syls[si++] ?? "")
      if (!py) return ch
      if (polyphoneOnly && !isPolyphone(ch)) return ch
      return `${ch}(${py})`
    })
    .join("")
}
