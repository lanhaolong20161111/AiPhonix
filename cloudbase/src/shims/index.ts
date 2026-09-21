/**
 * 绑定装配：把 Cloudflare 的三个绑定（D1 / R2 / Assets）换成 Node 侧的等价实现，
 * 其余密钥字段从进程环境变量平铺映射（server_cf 的 env.ts 只读 bindings，不读 process.env，
 * 故环境变量名与 wrangler secret 名保持完全一致，配置零翻译）。
 *
 * 目录约定（与 Dockerfile/entrypoint 一致）：
 *   /app/shared            ← R2 根（键空间 data/ static/ cache/ downloads/）
 *   /app/shared/data/app.db← D1（由生产 D1 快照播种）
 *   /app/server_cf/static_assets ← Workers Assets 根（web/ + tts-cache/）
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Bindings } from "../../../server_cf/src/bindings.js"
import { AssetsShim } from "./assets.js"
import { D1Shim } from "./d1.js"
import { R2Shim } from "./r2.js"

export interface BindingOptions {
  /** R2 根目录（对应生产 R2 桶 aiphonix-files 的键空间） */
  filesRoot: string
  /** Workers Assets 根目录（对应 server_cf/static_assets） */
  assetsRoot: string
  /** D1 数据库文件；默认 <filesRoot>/data/app.db */
  dbPath?: string
  /** 环境变量来源，默认 process.env */
  env?: Record<string, string | undefined>
}

/** 三个绑定的具体实现（不是 workers-types 里的接口类型，仅用于装配与自检） */
export interface Shims {
  DB: D1Shim
  FILES: R2Shim
  ASSETS: AssetsShim
}

/**
 * 装配结果。
 * ⚠️ 为什么 `bindings` 与 `shims` 分开：shim 只实现 server_cf 实际用到的子集
 * （如 D1Database.withSession 并未实现），结构上与 workers-types 的接口不完全兼容；
 * 故对外暴露成 Bindings 时用一次显式断言（真实运行期行为由 shim 保证），
 * 需要摸统计/调试时用 shims。
 */
export interface CloudBaseRuntime {
  bindings: Bindings
  shims: Shims
}

/**
 * 与 server_cf/src/bindings.ts 一一对应的密钥/变量名。
 * 名字必须与生产 `wrangler secret put <NAME>` 完全一致 —— 云托管侧用同名 EnvParam 注入。
 */
export const PASSTHROUGH_KEYS = [
  "CORS_ALLOW_ORIGINS",
  "JWT_SECRET",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "BAIDU_TTS_APP_ID",
  "BAIDU_TTS_API_KEY",
  "BAIDU_TTS_SECRET_KEY",
  "VOLC_TTS_API_KEY",
  "VOLC_TTS_ENGINE",
  "BAIDU_ASR_APP_ID",
  "BAIDU_ASR_API_KEY",
  "TENCENT_APP_ID",
  "TENCENT_SECRET_ID",
  "TENCENT_SECRET_KEY",
  "ARK_API_KEY",
  "ARK_MODEL",
  "ARK_CHAT_MODEL",
  "ARK_VISION_MODEL",
  "PADDLE_OCR_TOKEN",
  "OCR_ENGINE",
  "BIGMODEL_API_KEY",
  "BIGMODEL_MODEL",
] as const

export function createRuntime(opts: BindingOptions): CloudBaseRuntime {
  const src = opts.env ?? process.env
  const filesRoot = opts.filesRoot
  const dbPath = opts.dbPath ?? join(filesRoot, "data", "app.db")

  if (!existsSync(dbPath)) {
    // 不致命：better-sqlite3 会建空库。但空库意味着所有业务查询都查不到数据，必须显式告警。
    console.warn(`[bindings] D1 数据库不存在，将建空库: ${dbPath}`)
  }
  if (!existsSync(opts.assetsRoot)) {
    console.warn(`[bindings] Assets 根目录不存在，/web/ 将 404: ${opts.assetsRoot}`)
  }

  const shims: Shims = {
    DB: new D1Shim(dbPath),
    FILES: new R2Shim(filesRoot),
    ASSETS: new AssetsShim(opts.assetsRoot),
  }

  const bindings: Record<string, unknown> = { DB: shims.DB, FILES: shims.FILES, ASSETS: shims.ASSETS }
  for (const key of PASSTHROUGH_KEYS) {
    const v = src[key]
    if (typeof v === "string" && v.trim() !== "") bindings[key] = v
  }

  return { bindings: bindings as unknown as Bindings, shims }
}

/** 启动日志用：列出已注入的密钥名（**绝不打印值**） */
export function describeBindings(bindings: Bindings): { configured: string[]; missing: string[] } {
  const record = bindings as unknown as Record<string, unknown>
  const configured: string[] = []
  const missing: string[] = []
  for (const key of PASSTHROUGH_KEYS) {
    const v = record[key]
    if (typeof v === "string" && v.trim() !== "") configured.push(key)
    else missing.push(key)
  }
  return { configured, missing }
}
