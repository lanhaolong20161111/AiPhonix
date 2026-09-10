/* AiPhonix server_ts — 火山 ARK（豆包/DeepSeek/GLM）openai SDK 调用示例
 *
 * 已实测可用的模型端点（三版本 + 识图）：
 *  - flash 正式版 : deepseek-v4-flash-ga-260731   （纯文本，文本分析默认）
 *  - pro 版       : deepseek-v4-pro-ga-260813     （纯文本，能力更强）
 *  - GLM 5.2      : glm-5-2-260617                （纯文本，工具调用 agent）
 *  - 识图多模态   : doubao-seed-2-1-turbo-260628   （唯一支持图片输入）
 *
 * 运行示例：
 *  npx tsx test_ark_sdk.ts deepseek-v4-flash-ga-260731
 *  npx tsx test_ark_sdk.ts deepseek-v4-pro-ga-260813
 *  npx tsx test_ark_sdk.ts glm-5-2-260617
 *
 * 实测结论：
 *  - 标准请求(Non-streaming)：✅ 正常，完整返回。
 *  - 流式请求(streaming)：内容完整返回，但流结束时 ARK 服务端会提前关闭
 *    keep-alive 连接，SDK 在收尾时抛 "Premature close"（内容并未丢失）。
 *    生产代码应对该错误做捕获忽略；lib/ark.ts 的 chatStream() 已内置该容错。
 *
 * apiKey: 优先环境变量 ARK_API_KEY，否则回退 config.yaml 的 ark_chat.api_key
 */
import OpenAI from "openai"
import { loadConfig } from "./src/env.js"

const apiKey = process.env["ARK_API_KEY"] || loadConfig().ark_chat.api_key || ""
const model = process.argv[2] || "deepseek-v4-flash-ga-260731"
if (!apiKey) {
  console.error("未找到 ARK_API_KEY（环境变量或 config.yaml ark_chat.api_key）")
  process.exit(1)
}

const openai = new OpenAI({
  apiKey,
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
})

async function main() {
  // Non-streaming:
  console.log("----- standard request -----  model =", model)
  const completion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: "你是人工智能助手" },
      { role: "user", content: "你好" },
    ],
    model,
  })
  console.log(completion.choices[0]?.message?.content)

  // Streaming:
  console.log("----- streaming request -----")
  let collected = ""
  try {
    const stream = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "你是人工智能助手" },
        { role: "user", content: "你好" },
      ],
      model,
      stream: true,
    })
    for await (const part of stream) {
      const delta = part.choices?.[0]?.delta?.content || ""
      collected += delta
      process.stdout.write(delta)
    }
    process.stdout.write("\n")
  } catch (e) {
    // ARK 流式收尾会抛 Premature close，内容已完整收集；此处按需记录但不视为失败
    const msg = String((e as Error).message ?? e)
    if (msg.includes("Premature close")) {
      console.warn("\n[info] 流式收尾连接已由服务端关闭(Premature close)，内容已完整：")
      console.log(collected)
    } else {
      throw e
    }
  }
  console.log("----- DONE -----")
}

main().catch((e) => {
  console.error("\n调用失败:" + String((e as Error).message ?? e))
  process.exitCode = 1
})
