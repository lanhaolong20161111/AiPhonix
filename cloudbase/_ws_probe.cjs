/**
 * WebSocket 升级路径自检（入站 101 / 拒绝 / 出站到上游）。
 *
 * 用法（PROBE_URLS 用逗号分隔，条目格式 `标签|ws地址|是否发START`）：
 *   # 本地两实例
 *   node _ws_probe.cjs
 *   # 打云托管
 *   PROBE_URLS="云托管无密钥|wss://<容器域名>/api/v1/asr/stream?lang=zh|0" node _ws_probe.cjs
 *
 * 期望：
 *   · 无密钥 → 升级被拒（HTTP 500 JSON），证明「拒绝路径把 HTTP 响应写回裸 socket」；
 *   · 有密钥 → 101 成功；发 START 后若上游凭据无效，会收到 FIN_TEXT 错误帧（证明出站 fetch+Upgrade 通）。
 */
const WebSocket = require("ws")

const DEFAULT =
  "18010 无密钥|ws://127.0.0.1:18010/api/v1/asr/stream?lang=zh|0," +
  "18011 假密钥|ws://127.0.0.1:18011/api/v1/asr/stream?lang=zh|1"

const targets = (process.env.PROBE_URLS || DEFAULT)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [label, url, start] = s.split("|")
    return { label: label.trim(), url: url.trim(), start: start === "1" }
  })

function probe({ label, url, start }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    let done = false
    const finish = (msg) => {
      if (done) return
      done = true
      console.log(`${label} → ${msg}`)
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
      resolve()
    }
    const timer = setTimeout(() => finish("超时（20s 内无结论）"), 20000)

    ws.on("unexpected-response", (_req, res) => {
      let body = ""
      res.on("data", (d) => (body += d))
      res.on("end", () => {
        clearTimeout(timer)
        finish(`升级被拒 HTTP ${res.statusCode} body=${body}`)
      })
    })
    ws.on("open", () => {
      console.log(`${label} 升级成功（101）`)
      if (start) ws.send(JSON.stringify({ type: "START", data: { cuid: "probe" } }))
      let frames = 0
      ws.on("message", (d, isBinary) => {
        frames++
        console.log(`${label} 帧#${frames}:`, isBinary ? `<binary ${d.length}B>` : String(d).slice(0, 220))
      })
      setTimeout(
        () => {
          clearTimeout(timer)
          finish(`收到 ${frames} 帧后主动关闭`)
        },
        start ? 12000 : 1500,
      )
    })
    ws.on("error", (e) => {
      clearTimeout(timer)
      finish(`客户端错误: ${e.message}`)
    })
  })
}

;(async () => {
  for (const t of targets) await probe(t)
  process.exit(0)
})()
