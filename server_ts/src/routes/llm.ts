/** LLM 运维路由 — /api/v1/llm/logs、/llm/logs/clear、/llm/budget（对齐 Python routes/llm.py） */
import { Hono } from "hono"
import { getConfig } from "../env.js"
import { getCallLogs, clearCallLogs, getDayCost } from "../lib/deepseek.js"
import { requireRole } from "../middleware/auth.js"

const router = new Hono()

// ⚠️ 运维端点限管理员（全站 prompt 日志 / 清空审计只开放给 admin）。
// 必须**逐路由**挂门卫，不能用 `router.use(requireRole("admin"))`：
// Hono 的 route() 会把子应用的无路径 use 合并成 `/llm/*` 中间件，从而连带把后面
// 同前缀挂载的 chinesePracticeRoutes（en-dialogue-setup / zh-teach-setup / article-recite…）
// 一并锁成 admin-only —— 学生端一律 403「权限不足」。server_cf 一直是逐路由写法，勿改回。

// GET /api/v1/llm/logs
router.get("/logs", requireRole("admin"), (c) => {
  const logs = getCallLogs()
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

// POST /api/v1/llm/logs/clear
router.post("/logs/clear", requireRole("admin"), (c) => {
  clearCallLogs()
  return c.json({ status: "ok" })
})

// GET /api/v1/llm/budget
router.get("/budget", requireRole("admin"), (c) => {
  const cfg = getConfig()
  const day = getDayCost()
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
