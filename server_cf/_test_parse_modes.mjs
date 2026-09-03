/**
 * API 级 smoke：验证 /ai-chinese/parse-image 的 mode=english（英语模式跳过多音字/中文去噪）。
 * 注册临时用户 → 同一张图分别走 chinese（no_cache）与 english（mode+no_cache）→ 打印状态/耗时/结果规模。
 * 配合 `wrangler tail aiphonix-api-staging` 观察服务端日志（mode=english、补多音字、去噪是否出现）。
 * 用法：NODE_PATH="...web/node_modules" node _test_parse_modes.mjs [图片路径]
 */
const API_BASE = process.env.API_BASE || "https://aiphonix-api-staging.xinyi7lan.workers.dev/api/v1"
const USER = "smoke_modes_" + Date.now()

const reg = await (
  await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: "test1234", nickname: "smoke" }),
  })
).json()
const token = reg.access_token
if (!token) throw new Error("register failed: " + JSON.stringify(reg))
console.log("registered:", USER, "user_id:", reg.user_id)

const fs = await import("fs")
const imgPath = process.argv[2] || "C:/Users/lhl20/Desktop/android_cli_demos/test_card_wake.jpg"
const buf = fs.readFileSync(imgPath)
console.log("image:", imgPath, buf.length, "bytes")

async function parseMode(label, qs) {
  const t0 = Date.now()
  try {
    const form = new FormData()
    form.append("file", new Blob([buf], { type: "image/jpeg" }), "test_card_wake.jpg")
    const res = await fetch(`${API_BASE}/ai-chinese/parse-image${qs}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const ms = Date.now() - t0
    const j = await res.json().catch(() => null)
    const poly = (j?.blocks ?? []).some((b) => b?.polyphones && Object.keys(b.polyphones).length > 0)
    console.log(
      `${label}: HTTP ${res.status} ${ms}ms textLen=${j?.text?.length ?? 0} blocks=${j?.blocks?.length ?? 0}` +
        ` questions=${j?.questions?.length ?? 0} hasPolyphones=${poly}` +
        (j?.detail ? ` detail=${String(j.detail).slice(0, 120)}` : "")
    )
    console.log(`  text[0..80]: ${String(j?.text ?? "").slice(0, 80).replace(/\n/g, " ")}`)
  } catch (e) {
    console.log(`${label}: EXCEPTION after ${Date.now() - t0}ms: ${(e && e.message) || e}`)
  }
}

// 中文模式：强制不缓存（新的字节缓存键 parse_<sha>.json 第一次必是新，但保险起见带上）
await parseMode("chinese", "?no_cache=true")
// 英语模式：跳过补多音字 + 跳过 LLM 中文去噪（缓存键 parse_<sha>_en.json）
await parseMode("english", "?mode=english&no_cache=true")
console.log("done")
