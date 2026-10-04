/**
 * 双端路由「有意分叉」声明 —— `routeParity.test.ts` 的比对基准。
 *
 * ## 为什么需要这个文件
 * `contractParity.test.ts` 只比 zod schema 的**结构指纹**，它覆盖不到：
 *   ① 路由/挂载清单    ② 端点路径与 method    ③ 裸常量    ④ 中间件作用域
 * 而 `index.ts` 的路由挂载曾是**两端各一份手工清单、零护栏** ——
 * 历史事故：`router.use(requireRole("admin"))` 被写进 `llm.ts`，顺着 Hono 的 `route()`
 * 泄漏成 `/llm/*` 全匹配，学生端整片 403（见 skill `aiphonix-backend-parity` §4）。
 *
 * 本文件把「两端本就不该一样」的部分**显式冻结**下来。任何**未列在此处**的端点差异
 * 都会让门禁变红 ⇒ 分叉要么被镜像，要么被有意识地记到这里，而不是静默漂移。
 *
 * ## 判据
 * 每条差异都要能回答「为什么另一端不该有它」。写不出理由 = 不该在这儿 = 应该去镜像。
 */

export interface RouteDivergence {
  /** server_cf 有、server_ts 没有（`METHOD /path`） */
  cfOnly: string[]
  /** server_ts 有、server_cf 没有 */
  tsOnly: string[]
  /** 模块 id 层面的已知分叉（与 cfOnly/tsOnly 同源，但更粗、更易读） */
  cfOnlyModules: string[]
  tsOnlyModules: string[]
}

export const ROUTE_DIVERGENCE: RouteDivergence = {
  cfOnly: [
    // ── 基础设施：部署形态不同，不是业务接口 ──
    "GET /", // Worker 根路径 302 → /web/（Node 侧无此入口）
    "GET /web", // 以下 4 条：server_cf 由 Workers Assets 直出 + SPA fallback，
    "GET /web/*", //   server_ts 用 @hono/node-server 的 serveStatic（不进 routes 表）
    "GET /letter-clips/*", // R2 媒体（server_ts 走本地静态目录）
    "GET /videos/*",

    // ── server_ts 完全没有这个模块（详见 cfOnlyModules）──
    "GET /api/v1/daily-en",
    "PUT /api/v1/daily-en",
    "GET /api/v1/daily-en/word-info",
    "GET /api/v1/daily-en/sentence-info",
    "GET /api/v1/daily-en/image",
    "GET /api/v1/daily-en/file/:filename",
    "POST /api/v1/daily-en/phone-tips",
    "GET /api/v1/daily-zh",
    "PUT /api/v1/daily-zh",
    "GET /api/v1/joy",
    "GET /api/v1/joy/list",
    "POST /api/v1/joy/generate",
    "DELETE /api/v1/joy/:id",
    "GET /api/v1/generated-dict/:type/:text",
    "POST /api/v1/generated-dict/ensure",
    "GET /api/v1/ops/logs",
    "GET /api/v1/ops/metrics",
    "GET /api/v1/radical/riddles",
    "GET /api/v1/radical/song",
    "GET /api/v1/wordbook/list",
    "GET /api/v1/wordbook/review",
    "POST /api/v1/wordbook/add",
    "POST /api/v1/wordbook/add-many",
    "POST /api/v1/wordbook/rate",
    "DELETE /api/v1/wordbook/:id",

    // ── 两端都有该模块，但 server_cf 多出这些端点 ──
    // ai-chat：流式对话与会话查询只有生产端实现
    "POST /api/v1/ai-chat/ask-stream",
    "GET /api/v1/ai-chat/session",
    // ai-chinese：切块检测 + 多音字解析（依赖 server_cf 独有的 polyToken 链路）
    "POST /api/v1/ai-chinese/detect-blocks",
    "GET /api/v1/ai-chinese/parse-polyphones",
    // llm：诗词检索/总结只在生产端挂载
    "GET /api/v1/llm/zh-poem-search",
    "POST /api/v1/llm/zh-poem-summary",
    // tts：server_ts 的 tts.ts 只有 stream/synthesize 两条（无逐字缓存接口）
    "GET /api/v1/tts/char/:char",
    "GET /api/v1/tts/char/:char/exists",
  ],

  tsOnly: [
    // 本地开发便利页面（读本地 APK / 图片索引文件），生产不需要
    "GET /download",
    "GET /download/apk",
    "GET /review",
    "GET /review/new",
  ],

  cfOnlyModules: [
    "daily_zh",
    "daily_en",
    "joy",
    "generated_dict",
    "ops",
    "wordbook",
    "radical",
    // asr：server_cf 单文件覆盖 short+stream，server_ts 拆成两个模块（见下）
    "asr",
  ],

  tsOnlyModules: ["asr_short", "asr_stream"],
}
