/** 看图识字词语/句子客户端 — 从静态资源加载 LLM 生成的示例数据
 *
 * 数据由 server_py/gen_char_examples.py 用免费 ARK 批量生成：
 * {"字": {"words": ["词语1", "词语2"], "sentence": "句子"}}
 * 前端按字查询，点击 TTS 发音。
 */

export interface CharExample {
  words: string[]
  sentence: string
}

type CharExamplesFile = Record<string, CharExample>

let examplesPromise: Promise<CharExamplesFile> | null = null

function loadExamples(): Promise<CharExamplesFile> {
  if (examplesPromise) return examplesPromise
  examplesPromise = fetch("/web/char_examples.json").then((r) => {
    if (!r.ok) throw new Error(`词语例句加载失败 HTTP ${r.status}`)
    return r.json() as Promise<CharExamplesFile>
  })
  return examplesPromise
}

/** 查询某个字的词语+句子示例（字不在库中返回 null） */
export async function getCharExample(char: string): Promise<CharExample | null> {
  const data = await loadExamples()
  return data[char] ?? null
}
