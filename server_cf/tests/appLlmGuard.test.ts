/** App 端 LLM 代理的请求校验回归测试
 *
 * 这个文件锁住的是**安全边界**，不是普通业务逻辑。任何一条挂掉都意味着
 * `/api/v1/app-llm/chat/completions` 对外暴露了比设计更多的东西。三类断言：
 *   1. 结构类错误必须**拒绝**（说明调用方不是我们的客户端，别把脏数据喂给上游）；
 *   2. 越界类输入必须**钳制**（客户端填大了不该让整条请求失败，反正成本已封顶）；
 *   3. **白名单**：客户端传的任何非白名单字段都不许出现在结果里 ——
 *      尤其是 `model`：照转的话客户端就能把服务端配的便宜模型换成贵的。
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  APP_LLM_LIMITS,
  normalizeAppLlmRequest,
  type AppLlmLimits,
} from "../src/lib/appLlmGuard.js"

/** 一个最小的合法请求（形状与 Android 端 LlmClient 实际发的完全一致） */
function okBody(extra: Record<string, unknown> = {}) {
  return {
    messages: [
      { role: "system", content: "只输出 JSON" },
      { role: "user", content: "水泥的英语怎么说" },
    ],
    ...extra,
  }
}

/** 取出成功结果，失败直接让测试炸掉 */
function valueOf(body: unknown, limits?: AppLlmLimits) {
  const r = normalizeAppLlmRequest(body, limits)
  assert.equal(r.ok, true, `本应通过，实际被拒：${r.ok ? "" : r.error.message}`)
  return r.ok ? r.value : (null as never)
}

function errorOf(body: unknown, limits?: AppLlmLimits) {
  const r = normalizeAppLlmRequest(body, limits)
  assert.equal(r.ok, false, "本应被拒，实际通过了")
  return r.ok ? (null as never) : r.error
}

test("合法请求：messages 原样保留，inputChars 按实际字符数合计", () => {
  const v = valueOf(okBody())
  assert.deepEqual(v.messages, [
    { role: "system", content: "只输出 JSON" },
    { role: "user", content: "水泥的英语怎么说" },
  ])
  assert.equal(v.inputChars, "只输出 JSON".length + "水泥的英语怎么说".length)
})

test("缺省值：不传 max_tokens / temperature / thinking 时用项目默认", () => {
  const v = valueOf(okBody())
  assert.equal(v.maxTokens, APP_LLM_LIMITS.defaultMaxTokens)
  assert.equal(v.temperature, 0.7)
  // 默认关思考：这是给小学生的即时语音问答，实测关掉后成本 487→228 token、2.03s→1.57s 且质量不变
  assert.deepEqual(v.thinking, { type: "disabled" })
  assert.equal(v.responseFormat, undefined)
})

test("越界钳制：max_tokens / temperature 超范围被钳到硬上限，而不是报错", () => {
  // 填太大很常见（客户端可能照抄官方文档的 4096），不该因此整条失败
  assert.equal(valueOf(okBody({ max_tokens: 99999 })).maxTokens, APP_LLM_LIMITS.maxMaxTokens)
  assert.equal(valueOf(okBody({ max_tokens: 4096 })).maxTokens, APP_LLM_LIMITS.maxMaxTokens)
  assert.equal(valueOf(okBody({ max_tokens: 0 })).maxTokens, 1)
  assert.equal(valueOf(okBody({ max_tokens: -5 })).maxTokens, 1)
  assert.equal(valueOf(okBody({ max_tokens: 12.7 })).maxTokens, 12) // 取整
  assert.equal(valueOf(okBody({ temperature: 5 })).temperature, APP_LLM_LIMITS.maxTemperature)
  assert.equal(valueOf(okBody({ temperature: -1 })).temperature, 0)
})

test("非数字的 max_tokens / temperature 回落默认，不报错也不变成 NaN", () => {
  for (const junk of ["abc", null, {}, [], true, Number.NaN, Number.POSITIVE_INFINITY]) {
    const v = valueOf(okBody({ max_tokens: junk, temperature: junk }))
    assert.equal(v.maxTokens, APP_LLM_LIMITS.defaultMaxTokens, `max_tokens 非法值 ${String(junk)}`)
    assert.equal(v.temperature, 0.7, `temperature 非法值 ${String(junk)}`)
  }
})

test("结构类错误：请求体不是对象 ⇒ 400", () => {
  for (const bad of [null, undefined, "hello", 42, [], [{}]]) {
    assert.equal(errorOf(bad).status, 400, `body=${JSON.stringify(bad) ?? "undefined"}`)
  }
})

test("结构类错误：messages 缺失 / 空 / 非数组 ⇒ 400", () => {
  assert.equal(errorOf({}).status, 400)
  assert.equal(errorOf({ messages: [] }).status, 400)
  assert.equal(errorOf({ messages: "x" }).status, 400)
  assert.equal(errorOf({ messages: {} }).status, 400)
})

test("结构类错误：messages 条数超过上限 ⇒ 422", () => {
  const many = Array.from({ length: APP_LLM_LIMITS.maxMessages + 1 }, () => ({
    role: "user",
    content: "hi",
  }))
  assert.equal(errorOf({ messages: many }).status, 422)
  // 正好等于上限应放行（边界不多不少）
  const exact = many.slice(0, APP_LLM_LIMITS.maxMessages)
  assert.equal(normalizeAppLlmRequest({ messages: exact }).ok, true)
})

test("结构类错误：role 不在白名单（tool / developer / 空）⇒ 422", () => {
  for (const role of ["tool", "developer", "function", "", null, 123]) {
    const r = normalizeAppLlmRequest({ messages: [{ role, content: "hi" }] })
    assert.equal(r.ok, false, `role=${String(role)} 本应被拒`)
  }
})

test("结构类错误：content 必须是「非空字符串」——多模态数组/数字/null 全拒", () => {
  // 数组形式是多模态（image_url 等），本端点只做文本，不装作支持
  for (const content of [[{ type: "text", text: "hi" }], 123, null, undefined, {}, true]) {
    const r = normalizeAppLlmRequest({ messages: [{ role: "user", content }] })
    assert.equal(r.ok, false, `content=${JSON.stringify(content) ?? "undefined"} 本应被拒`)
  }
  // 纯空白等于没内容
  assert.equal(normalizeAppLlmRequest({ messages: [{ role: "user", content: "   \n\t " }] }).ok, false)
})

test("结构类错误：单条 content 超长 / 合计超长 ⇒ 422，且边界正好放行", () => {
  const per = APP_LLM_LIMITS.maxContentChars
  assert.equal(normalizeAppLlmRequest(okBody({ messages: [{ role: "user", content: "中".repeat(per) }] })).ok, true)
  assert.equal(normalizeAppLlmRequest(okBody({ messages: [{ role: "user", content: "中".repeat(per + 1) }] })).ok, false)

  // 合计：每条都在单条上限内，但加起来越界 —— 这条挡住「多条都卡在单条上限」的绕过。
  // ⚠️ maxInputChars(8000) 正好 = 2 × maxContentChars(4000)，所以「恰好 8000」放行，
  //    只能靠第 3 条（3001×3=9003）来触发合计上限，不能用 2 条去凑。
  const total = APP_LLM_LIMITS.maxInputChars
  const perCap = APP_LLM_LIMITS.maxContentChars
  assert.equal(perCap * 2, total, "本用例的前提：合计上限正好是单条上限的两倍")
  assert.equal(
    normalizeAppLlmRequest({
      messages: [
        { role: "user", content: "中".repeat(perCap) },
        { role: "assistant", content: "中".repeat(perCap) },
      ],
    }).ok,
    true,
    "恰好等于合计上限应放行"
  )
  const third = Math.floor(total / 3) + 1 // 3001，每条都远小于单条上限
  assert.equal(
    normalizeAppLlmRequest({
      messages: [
        { role: "user", content: "中".repeat(third) },
        { role: "assistant", content: "中".repeat(third) },
        { role: "user", content: "中".repeat(third) },
      ],
    }).ok,
    false,
    "合计越界必须被拒（否则预算守卫会按错误的输入长度估成本）"
  )
})

test("🔴 白名单：客户端传的 model / stream / n / tools 一律不进结果", () => {
  const v = valueOf(
    okBody({
      model: "deepseek-v4-pro", // ← 想换成更贵的模型，必须无效
      stream: true,
      n: 5,
      tools: [{ type: "function" }],
      frequency_penalty: 2,
      presence_penalty: 2,
      logprobs: true,
      user: "someone",
      stop: ["\n"],
    })
  )
  const keys = Object.keys(v).sort()
  assert.deepEqual(
    keys,
    ["inputChars", "maxTokens", "messages", "responseFormat", "temperature", "thinking"],
    "结果只应有这 6 个键；多出来的键就意味着它可能被转发了"
  )
  const serialized = JSON.stringify(v)
  for (const leaked of ["deepseek-v4-pro", "stream", "tools", "frequency_penalty", "logprobs", "stop"]) {
    assert.equal(serialized.includes(leaked), false, `字段 ${leaked} 泄漏进了上游请求`)
  }
})

test("thinking 白名单：只认 disabled / enabled，其它值回落到默认", () => {
  assert.deepEqual(valueOf(okBody({ thinking: { type: "enabled" } })).thinking, { type: "enabled" })
  assert.deepEqual(valueOf(okBody({ thinking: { type: "disabled" } })).thinking, { type: "disabled" })
  for (const junk of [
    { type: "auto" },
    { type: "DISABLED" }, // 大小写敏感，避免上游语义不明
    "disabled", // 字符串不是 {type}
    {},
    null,
    { type: 1 },
    { level: "low" }, // GLM 风格的字段，这里不认
  ]) {
    assert.deepEqual(
      valueOf(okBody({ thinking: junk })).thinking,
      { type: APP_LLM_LIMITS.defaultThinking },
      `thinking=${JSON.stringify(junk)} 应回落默认`
    )
  }
})

test("response_format：只转发 json_object，其余忽略（含 json_schema）", () => {
  assert.deepEqual(valueOf(okBody({ response_format: { type: "json_object" } })).responseFormat, {
    type: "json_object",
  })
  for (const junk of [
    { type: "text" },
    { type: "json_schema", json_schema: { name: "x", schema: {} } },
    {},
    null,
    "json_object",
  ]) {
    assert.equal(
      valueOf(okBody({ response_format: junk })).responseFormat,
      undefined,
      `response_format=${JSON.stringify(junk)} 不应被转发`
    )
  }
})

test("limits 参数真的生效（否则调用方以为改了阈值其实没改）", () => {
  const tight: AppLlmLimits = { ...APP_LLM_LIMITS, maxMaxTokens: 32, defaultMaxTokens: 8, maxMessages: 1 }
  // 用 1 条消息，先过「条数」闸门，好单独考察 max_tokens 这两条阈值
  const one = { messages: [{ role: "user", content: "hi" }] }
  assert.equal(valueOf({ ...one, max_tokens: 999 }, tight).maxTokens, 32)
  assert.equal(valueOf({ ...one, max_tokens: "x" }, tight).maxTokens, 8)
  assert.equal(errorOf(okBody(), tight).status, 422) // 2 条 > maxMessages=1
})
