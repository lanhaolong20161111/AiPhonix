/**
 * 把 cloudbase/_envparam.json 推送为云托管服务的 EnvParam。
 *
 * ⚠️ 为什么 cf 版必须推 EnvParam：server_cf/src/env.ts **只从 bindings 读配置**
 *    （不读 config.yaml、不读 process.env），而 bindings 在容器里就是环境变量。
 *    所以 cf 版容器没有 EnvParam = 所有密钥为空 = 登录/TTS/识图全线不可用。
 *
 * 走 tcbr/SubmitServerConfigChangeDiff：Key="EnvParam"（单数！Value 为 JSON 字符串）。
 * 该接口语义是「更新配置并使用最新镜像发布」—— 因此必须在镜像部署成功之后执行。
 *
 * 密钥只在本机文件里流转：不出现在命令行参数中，也不打印到 stdout。
 */
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const HERE = __dirname
const NODE = "C:/Users/lhl20/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
const TCB =
  "C:/Users/lhl20/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb"
const ENV_ID = process.env.CB_ENV_ID || "cloudbase-test-d8gna6iyy14e2ba39"
const SERVER = process.env.CB_SERVER_NAME || "aiphonix-api"

const file = path.join(HERE, "_envparam.json")
if (!fs.existsSync(file)) {
  console.error(`缺少 ${file}（先跑 node cloudbase/_ctxgen.cjs --env-only）`)
  process.exit(1)
}
const envParam = JSON.parse(fs.readFileSync(file, "utf8"))
const body = {
  EnvId: ENV_ID,
  ServerName: SERVER,
  Items: [{ Key: "EnvParam", Value: JSON.stringify(envParam) }],
}

console.log("[push] 目标 %s / %s", ENV_ID, SERVER)
console.log("[push] 将注入 %d 个环境变量:", Object.keys(envParam).length)
console.log("[push]", Object.keys(envParam).sort().join(", "))

// 部署相关 API 走内网直达，清掉代理避免被中间设备拦成 403
const childEnv = { ...process.env }
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY"]) {
  delete childEnv[k]
}

const r = spawnSync(
  NODE,
  [TCB, "api", "tcbr", "SubmitServerConfigChangeDiff", "--api-version", "2022-02-17", "--body", JSON.stringify(body), "--json"],
  { encoding: "utf8", env: childEnv, maxBuffer: 32 * 1024 * 1024 },
)
process.stdout.write(r.stdout || "")
process.stderr.write(r.stderr || "")
process.exit(r.status ?? 1)
