/**
 * 装配 CloudBase 云托管（CloudRun）的**构建上下文** `cloudbase/_ctx/`，并生成 cf 版专用 EnvParam。
 *
 * 为什么需要它：`tcb cloudrun deploy --source <dir>` 会把 <dir> 整体上传，且要求 Dockerfile 在
 * <dir> 根。而仓库根有 11GB（shared 4.2G / server_py 4.5G / .git 850M），绝不能整体上传。
 * 故这里把「镜像真正需要的东西」抄进一个自包含的小目录（约 100MB）：
 *
 *   _ctx/
 *     Dockerfile  docker-entrypoint.sh
 *     package.json  package-lock.json  tsconfig.json   ← 生成/拷贝，容器内 /app 根
 *     cloudbase/src/**             ← 适配层（对仓库 cloudbase/src 的拷贝）
 *     server_cf/src/**             ← 生产 CF Worker 源码（原样，零改动）
 *     static_assets/{web,tts-cache}
 *     seed/data/app.db             ← D1 快照（**含生产用户数据，不入库**）
 *     seed/static/**               ← R2 静态资源（letter_clips / images / videos，由 CTX_STATIC 控制）
 *
 * ⚠️ 为什么是「扁平」而不是 cloudbase/ 子目录：Node 的裸模块解析是从调用文件所在目录向上找
 *    node_modules。容器里 `server_cf/src/*.ts` 的 `import "hono"` 只会看 /app/node_modules。
 *    若把 server_cf 放到 /app/cloudbase/ 下而 node_modules 也在那里，构建期就会全线
 *    `TS2307: Cannot find module 'hono'/'zod'/'drizzle-orm'`（2026-09-20 首次 cf 部署失败的原因）。
 *    扁平布局恰好让 `rootDir="."` 产出 `dist/{cloudbase,server_cf}`，与本地
 *    `cloudbase/tsconfig.json`（rootDir=".."）的输出结构一一对应。
 *
 * 用法：
 *   node cloudbase/_ctxgen.cjs            # 装配 + 报体积
 *   node cloudbase/_ctxgen.cjs --env-only # 只重生成 _envparam.json
 *
 * 产出（均不入库）：
 *   cloudbase/_ctx/                 构建上下文
 *   cloudbase/_envparam.json        cf 版 EnvParam（键名 = server_cf/src/bindings.ts 的字段名）
 */
const fs = require("node:fs")
const path = require("node:path")

const HERE = __dirname // <repo>/cloudbase
const ROOT = path.resolve(HERE, "..") // <repo>
const CTX = path.join(HERE, "_ctx")

const log = (...a) => console.log("[ctxgen]", ...a)

// ── 小工具 ────────────────────────────────────────────────────────
function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(e)) continue
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d, filter)
    else if (e.isSymbolicLink()) fs.copyFileSync(fs.realpathSync(s), d)
    else fs.copyFileSync(s, d)
  }
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}

/** 目录统计（文件数 + 字节数） */
function measure(dir) {
  let files = 0
  let bytes = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        files++
        try {
          bytes += fs.statSync(p).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return { files, bytes }
}

const mb = (b) => (b / 1048576).toFixed(1) + " MB"

function loadDotEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

/** 极简 YAML 取值（只支持 `a:\n  b: "v"` 两层，够用且不引依赖） */
function yamlGet(text, section, key) {
  const lines = text.split(/\r?\n/)
  let inSection = false
  for (const line of lines) {
    if (/^[A-Za-z_]/.test(line)) {
      inSection = new RegExp(`^${section}\\s*:`).test(line)
      continue
    }
    if (!inSection) continue
    const m = line.match(new RegExp(`^\\s+${key}\\s*:\\s*(.*)$`))
    if (m) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  return ""
}

// ── 1. EnvParam（键名 = server_cf/src/bindings.ts 的字段名）────────
function buildEnvParam() {
  const dev = loadDotEnv(path.join(ROOT, "server_cf", ".dev.vars"))
  const cfgText = fs.readFileSync(path.join(ROOT, "shared", "config.yaml"), "utf8")
  const env = {}
  const put = (k, v) => {
    const s = typeof v === "string" ? v.trim() : ""
    if (s) env[k] = s
  }

  // server_cf 的 env.ts 只读 bindings → 变量名必须与 wrangler secret 完全一致
  put("JWT_SECRET", dev.JWT_SECRET)
  put("DEEPSEEK_API_KEY", dev.DEEPSEEK_API_KEY || yamlGet(cfgText, "deepseek", "api_key"))
  put("DEEPSEEK_BASE_URL", dev.DEEPSEEK_BASE_URL || yamlGet(cfgText, "deepseek", "base_url"))
  put("DEEPSEEK_MODEL", dev.DEEPSEEK_MODEL || yamlGet(cfgText, "deepseek", "model"))
  // 百度 TTS：生产由 config.yaml 灌入（.dev.vars 里没有）
  put("BAIDU_TTS_APP_ID", dev.BAIDU_TTS_APP_ID || yamlGet(cfgText, "baidu_tts", "app_id"))
  put("BAIDU_TTS_API_KEY", dev.BAIDU_TTS_API_KEY || yamlGet(cfgText, "baidu_tts", "api_key"))
  put("BAIDU_TTS_SECRET_KEY", dev.BAIDU_TTS_SECRET_KEY || yamlGet(cfgText, "baidu_tts", "secret_key"))
  put("VOLC_TTS_API_KEY", dev.VOLC_TTS_API_KEY || yamlGet(cfgText, "volc_tts", "api_key"))
  put("VOLC_TTS_ENGINE", dev.VOLC_TTS_ENGINE || yamlGet(cfgText, "volc_tts", "engine"))
  put("BAIDU_ASR_APP_ID", dev.BAIDU_ASR_APP_ID)
  put("BAIDU_ASR_API_KEY", dev.BAIDU_ASR_API_KEY)
  put("TENCENT_APP_ID", dev.TENCENT_APP_ID || yamlGet(cfgText, "tencent", "app_id"))
  put("TENCENT_SECRET_ID", dev.TENCENT_SECRET_ID || yamlGet(cfgText, "tencent", "secret_id"))
  put("TENCENT_SECRET_KEY", dev.TENCENT_SECRET_KEY || yamlGet(cfgText, "tencent", "secret_key"))
  put("ARK_API_KEY", dev.ARK_API_KEY || yamlGet(cfgText, "ark_chat", "api_key"))
  put("ARK_CHAT_MODEL", dev.ARK_CHAT_MODEL || yamlGet(cfgText, "ark_chat", "model"))
  put("ARK_VISION_MODEL", dev.ARK_VISION_MODEL || "doubao-seed-2-1-turbo-260628")
  // ⚠️ 字段名是 PADDLE_OCR_TOKEN（server_ts 那边叫 PP_TOKEN，别混）
  put("PADDLE_OCR_TOKEN", dev.PADDLE_OCR_TOKEN || yamlGet(cfgText, "pp_structure", "token"))
  // wrangler [vars]（非密钥）
  put("OCR_ENGINE", process.env.OCR_ENGINE || "paddle")
  put("BIGMODEL_API_KEY", dev.BIGMODEL_API_KEY)
  put("BIGMODEL_MODEL", dev.BIGMODEL_MODEL)
  put("CORS_ALLOW_ORIGINS", dev.CORS_ALLOW_ORIGINS)

  const file = path.join(HERE, "_envparam.json")
  fs.writeFileSync(file, JSON.stringify(env, null, 2), "utf8")
  log(`EnvParam 已写入 ${path.relative(ROOT, file)}（${Object.keys(env).length} 项，含真实密钥，勿入库）`)
  log("EnvParam 键名:", Object.keys(env).sort().join(", "))
  return env
}

// ── 2. 装配构建上下文（扁平布局，见文件头注释）────────────────────
function assemble() {
  if (fs.existsSync(CTX)) {
    fs.rmSync(CTX, { recursive: true, force: true })
    log("已清空旧的 _ctx/")
  }

  // Dockerfile / entrypoint（本体入库，这里只是拷到上下文根）
  for (const f of ["Dockerfile", "docker-entrypoint.sh"]) {
    copyFile(path.join(HERE, f), path.join(CTX, f))
  }
  log("Dockerfile + docker-entrypoint.sh 已就位")

  // 外壳依赖清单（与 server_cf 的运行期依赖同源，见 package.json 注释）
  for (const f of ["package.json", "package-lock.json"]) {
    const src = path.join(HERE, f)
    if (!fs.existsSync(src)) throw new Error(`缺少 ${path.relative(ROOT, src)}（先跑 npm install 生成 lock）`)
    copyFile(src, path.join(CTX, f))
  }

  // 容器专用 tsconfig：由本地 cloudbase/tsconfig.json 派生，只改 rootDir / outDir / include。
  // 单一真源 = cloudbase/tsconfig.json，避免两份配置各自漂移。
  const devTs = JSON.parse(fs.readFileSync(path.join(HERE, "tsconfig.json"), "utf8"))
  const buildTs = {
    ...devTs,
    // 本地是 rootDir=".."（覆盖仓库根的 server_cf/src）；容器里 /app 就是根
    compilerOptions: { ...devTs.compilerOptions, rootDir: ".", outDir: "dist" },
    include: ["cloudbase/src/**/*.ts", "server_cf/src/**/*.ts"],
  }
  fs.writeFileSync(path.join(CTX, "tsconfig.json"), JSON.stringify(buildTs, null, 2) + "\n", "utf8")
  log('tsconfig.json 已生成（rootDir="."，include = cloudbase/src + server_cf/src）')

  // 适配层源码（→ /app/cloudbase/src）
  copyDir(path.join(HERE, "src"), path.join(CTX, "cloudbase", "src"))
  log("cloudbase/src 已就位")

  // server_cf 源码（原版，零改动；→ /app/server_cf/src，与 node_modules 同级）
  copyDir(path.join(ROOT, "server_cf", "src"), path.join(CTX, "server_cf", "src"))
  const cfSrc = measure(path.join(CTX, "server_cf", "src"))
  log(`server_cf/src 已就位（${cfSrc.files} 个文件）`)

  // Worker Assets 根：只取 web/ 与 tts-cache/
  for (const d of ["web", "tts-cache"]) {
    const src = path.join(ROOT, "server_cf", "static_assets", d)
    if (!fs.existsSync(src)) throw new Error(`缺少 ${path.relative(ROOT, src)}`)
    copyDir(src, path.join(CTX, "static_assets", d))
    const m = measure(src)
    log(`static_assets/${d} 已就位（${m.files} 个文件，${mb(m.bytes)}）`)
  }

  // 前端入口哈希自检：必须与生产一致（web 目录就是生产部署源）
  const idx = fs.readFileSync(path.join(CTX, "static_assets", "web", "index.html"), "utf8")
  const hash = (idx.match(/assets\/index-([A-Za-z0-9_-]+)\.js/) || [])[1] || "(未匹配到入口)"
  log(`前端入口哈希 = ${hash}（index.html ${idx.length}B）—— 应与生产 /web/ 一致`)

  // D1 快照：优先用已产出的 server_ts/_seed/data/app.db（同一份 D1 导出）
  const candidates = [
    path.join(ROOT, "server_ts", "_seed", "data", "app.db"),
    path.join(ROOT, "shared", "data", "app.db"),
  ]
  const dbSrc = candidates.find((p) => fs.existsSync(p))
  if (!dbSrc) throw new Error("找不到 app.db（D1 快照）")
  copyFile(dbSrc, path.join(CTX, "seed", "data", "app.db"))
  const dbStat = fs.statSync(dbSrc)
  log(`seed/data/app.db 已就位（源 ${path.relative(ROOT, dbSrc)}，${mb(dbStat.size)}，mtime ${dbStat.mtime.toISOString()}）`)

  // ── R2 静态资源（→ 镜像内 /app/shared/static/**）──────────────────
  // 对应生产 R2 桶 aiphonix-files 的 static/ 前缀，路由见 server_cf/src/index.ts：
  //   /letter-clips/*  → static/letter_clips/<path>
  //   /videos/*        → static/videos/<path>
  // 容器版没有 R2，R2Shim 直读 /app/shared；不带上这些，这两个路由就是 404。
  // ⚠️ 刻意**不含** shared/static/web：`/web/*` 由 Worker Assets（static_assets/web）直出，
  //    R2 里那份是历史遗留，带进来只会造成两份真相。
  //
  // 体积开关 CTX_STATIC（默认 all，434MB；上传耗时与失败率随之上升）：
  //   all   = letter_clips + images + videos   （parity 全绿）
  //   small = letter_clips + images             （约 21MB，够跑通字母视频，videos 仍 404）
  //   none  = 不带
  const staticMode = process.env.CTX_STATIC || "all"
  const STATIC_SUBS =
    staticMode === "all"
      ? ["letter_clips", "images", "videos"]
      : staticMode === "small"
        ? ["letter_clips", "images"]
        : []
  for (const d of STATIC_SUBS) {
    const src = path.join(ROOT, "shared", "static", d)
    if (!fs.existsSync(src)) {
      log(`⚠️ shared/static/${d} 不存在，跳过`)
      continue
    }
    copyDir(src, path.join(CTX, "seed", "static", d))
  }
  if (STATIC_SUBS.length) {
    const m = measure(path.join(CTX, "seed", "static"))
    log(`seed/static 已就位（${STATIC_SUBS.join(" + ")}；${m.files} 个文件，${mb(m.bytes)}）`)
  } else {
    log("seed/static 跳过（CTX_STATIC=none）—— /letter-clips/* 与 /videos/* 将 404")
  }

  const total = measure(CTX)
  log(`构建上下文总计：${total.files} 个文件，${mb(total.bytes)}`)
  log('部署命令：yes "" | tcb cloudrun deploy --env-id <envId> --service-name aiphonix-api --source "'
    + CTX + '" --port 8080 --min-num 1 --max-num 1 --wait')
  log('（交互提问有两处：确认部署 / 是否灰度，必须持续供回车，故用 yes ""）')
}

const envOnly = process.argv.includes("--env-only")
buildEnvParam()
if (!envOnly) assemble()
