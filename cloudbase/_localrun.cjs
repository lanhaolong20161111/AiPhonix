#!/usr/bin/env node
/**
 * 本地复现云托管容器行为 —— 用**完全相同的入口与绑定装配**跑 server_cf。
 *
 * 为什么要它：云托管一次部署 3~5 分钟，调 MIME / 缓存头 / 307 / WS 这类细节时
 * 必须先在本地把行为对齐生产 CF，再上云验证「只剩平台差异」。
 *
 * 用法：
 *   node cloudbase/_localrun.cjs                 # 默认 18010
 *   PORT=18011 node cloudbase/_localrun.cjs
 *
 * 密钥来源：cloudbase/_envparam.json（由 _ctxgen.cjs 生成，键名 = server_cf/src/bindings.ts）。
 * 数据来源：仓库根 shared/（R2 键空间 + data/app.db）、server_cf/static_assets/。
 */
const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")

const HERE = __dirname
const ROOT = path.resolve(HERE, "..")
const NODE = process.execPath
const ENTRY = path.join(HERE, "dist", "cloudbase", "src", "main.js")

if (!fs.existsSync(ENTRY)) {
  console.error(`[localrun] 找不到 ${ENTRY}\n[localrun] 先跑：cd cloudbase && tsc -p tsconfig.json`)
  process.exit(1)
}

/** @type {Record<string,string>} */
let secrets = {}
const envFile = path.join(HERE, "_envparam.json")
if (fs.existsSync(envFile)) {
  secrets = JSON.parse(fs.readFileSync(envFile, "utf8"))
} else {
  console.warn("[localrun] 没有 _envparam.json（跑 node cloudbase/_ctxgen.cjs 生成），将以空密钥启动")
}

const env = {
  ...process.env,
  ...secrets,
  PORT: process.env.PORT || "18010",
  BIND_HOST: process.env.BIND_HOST || "127.0.0.1",
  SHARED_ROOT: process.env.SHARED_ROOT || path.join(ROOT, "shared"),
  ASSETS_ROOT: path.join(ROOT, "server_cf", "static_assets"),
}

console.log(`[localrun] 入口     ${ENTRY}`)
console.log(`[localrun] 端口     ${env.PORT}`)
console.log(`[localrun] 密钥     ${Object.keys(secrets).length} 项`)
const child = spawn(NODE, [ENTRY], { env, stdio: "inherit" })
child.on("exit", (code) => process.exit(code ?? 0))
