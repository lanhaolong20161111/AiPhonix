/** AI 语文(ai_chinese)/数学(ai_homework)路由共享的工具函数 — Cloudflare 版
 *
 * 与 server_ts 差异：readCache/writeCache 变 async（R2）；音频路径用 POSIX key 拼接。
 */
import { createHash } from "node:crypto"
import { readJson, writeJson } from "./jsonfile.js"

export function stripFence(s: string): string {
  let c = (s || "").trim()
  if (c.startsWith("```")) {
    c = c.replace(/^```(?:json)?\s*/i, "")
    c = c.replace(/\s*```\s*$/, "")
  }
  return c
}

export function parseJsonObj(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(stripFence(s))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function readCache<T = Record<string, unknown>>(file: string): Promise<T | null> {
  const data = await readJson<unknown>(file, null)
  return data === null ? null : (data as T)
}

export async function writeCache(file: string, data: unknown): Promise<void> {
  await writeJson(file, data)
}

/** 句子朗读录音路径（md5 命名）——R2 key 形如 data/ai_chinese_sentence_audio/<md5>.m4a */
export function makeSentenceAudioPath(sentenceAudioDir: string) {
  return (sentence: string): string => {
    const h = createHash("md5").update(sentence.trim()).digest("hex")
    return `${sentenceAudioDir.replace(/\/+$/, "")}/${h}.m4a`
  }
}

// ── render_analyze 提示词（对齐 prompts_aihomework.py） ──

export function renderAnalyze(question: string, sentences: string[]): string {
  const list = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")
  return `以下是数学应用题的句子列表（已按标点切分）。请输出 JSON：
{"marks":[{"is_key":bool,"highlight":"关键信息摘要，非关键句留空"},...],
 "quantities":[{"name":"实体名","value":数字或null,"unit":"单位"}],
 "relations":[{"a":"主体","b":"基准","type":"more/less/times/total","amount":数字}],
 "questions":[{"text":"问题原文","target":"要求解的量","needs":["先要知道的量"],"hint":"求解方向简述"}]}
 规则：
 1) marks 数组顺序与句子一一对应；is_key=该句是否含**解题必需**的数量条件（数字/倍数/比较关系）。
    **只标真正必需的关键句（通常 1~3 句）**：与求解直接相关的条件句才标 true；
    背景描述、场景铺垫、无数字的句子一律 false。
 2) quantities：每个数量主体一个（如小明/苹果/原价）；已知数值用数字，题目所求未知量 value 为 null，unit 无单位留空字符串。
 3) relations：more=a比b多amount；less=a比b少amount；times=a是b的amount倍；total=求和（a 是『一共』或所求总量，parts 列出所有分量名）。
 4) 求『a比b多/少多少』的差值也要提取（amount=0，quantities 补未知差值实体如『贵的金额』）。
 5) questions：题目里的每个问题一条；needs 是回答该问需要先知道的量；hint 是求解方向（不给答案不剧透）。
 【输出精简】highlight≤10字；JSON 无多余空格与换行；非关键句只输出 is_key=false。
 不要解题过程，不要答案。

 句子列表：
${list}`
}
