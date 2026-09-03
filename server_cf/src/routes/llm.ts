/** LLM 运维路由 — /api/v1/llm/logs、/llm/logs/clear、/llm/budget（对齐 Python routes/llm.py）
 *  Cloud 版：deepseek lib 的 getCallLogs/clearCallLogs/getDayCost 变 async，handler 加 await。
 */
import { Hono } from "hono"
import { getConfig } from "../env.js"
import { getCallLogs, clearCallLogs, getDayCost } from "../lib/deepseek.js"
import { requireAuth, requireRole } from "../middleware/auth.js"

const router = new Hono()

// GET /api/v1/llm/logs（全站 prompt 日志：仅管理员）
router.get("/logs", requireRole("admin"), async (c) => {
  const logs = await getCallLogs()
  let totalTokens = 0
  let totalCost = 0
  let success = 0
  for (const l of logs) {
    totalTokens += l.total_tokens
    totalCost += l.cost_yuan
    if (l.success) success += 1
  }
  return c.json({
    total_calls: logs.length,
    success,
    failed: logs.length - success,
    total_tokens: totalTokens,
    total_cost: totalCost,
    logs: logs.map((l) => ({
      time: l.time,
      caller: l.caller,
      model: l.model,
      prompt_tokens: l.prompt_tokens,
      comp_tokens: l.comp_tokens,
      total_tokens: l.total_tokens,
      cost_yuan: l.cost_yuan,
      duration_ms: l.duration_ms,
      success: l.success,
      error: l.error,
    })),
  })
})

// POST /api/v1/llm/logs/clear（清空审计：仅管理员）
router.post("/logs/clear", requireRole("admin"), async (c) => {
  await clearCallLogs()
  return c.json({ status: "ok" })
})

// GET /api/v1/llm/budget
router.get("/budget", requireAuth(), async (c) => {
  const cfg = getConfig()
  const day = await getDayCost()
  return c.json({
    date: day.date,
    total_cost: day.total_cost,
    calls: day.calls,
    max_cost_per_day: cfg.deepseek.max_cost_per_day,
    max_cost_per_call: cfg.deepseek.max_cost_per_call,
    max_input_chars: cfg.deepseek.max_input_chars,
    blocked: day.total_cost >= cfg.deepseek.max_cost_per_day,
  })
})

export default router
