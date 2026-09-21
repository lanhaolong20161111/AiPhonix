/** 一致性测试：同一脚本内「注册 → 立刻用该 token 校验」，跑 5 轮。
 *
 * ## 它测出了什么（2026-09-20 实测）
 *
 * - **单次运行内是自洽的**：`sub` 55→56→57→58→59 单调递增，5 次 `/users/me` 全 200。
 * - **但跨运行会回退**：上一次脚本跑出到 `sub=60`，几分钟后再跑又从 `55` 开始。
 *   期间 `DescribeCloudRunPodList` 显示 **同一个 PodId（`...-x4dsl`，CreateTime 20:47:08）从未变过**。
 *   ⇒ **容器可写层被重置了**（容器进程重启 → 文件系统回到镜像态；k8s 里容器重启会拿新容器文件系统，
 *   但 Pod 名字不变，所以光看 PodId 看不出来）。
 *
 * ## 为什么这条很重要
 *
 * `MinNum=0` 下容器频繁启停 ⇒ **把真实数据（sqlite：用户 / 练习记录）放在容器本地文件上不可靠**。
 * 「持久卷」不是优化项，是**上线硬阻塞**（挂 `/app/shared/data`，见 skill）。
 *
 * ## 用法
 *   node cloudbase/_consistency.cjs
 * 判据：任一 `/users/me` 非 200，或 `sub` 相比上一轮**没有递增** ⇒ 数据不一致。
 */
const GW = process.env.GW || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.ap-shanghai.app.tcloudbase.com"
const dec = (t) => {
  try {
    return JSON.parse(Buffer.from(t.split(".")[1], "base64").toString())
  } catch {
    return {}
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  for (let i = 1; i <= 5; i++) {
    const u = "cons_" + i + "_" + Date.now()
    const r = await fetch(GW + "/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: "test1234", nickname: "一致性" + i }),
    })
    let tok = ""
    let sub = "?"
    try {
      const j = await r.json()
      tok = j.access_token
      sub = dec(tok).sub
    } catch {}
    const m = await fetch(GW + "/api/v1/users/me", { headers: { Authorization: "Bearer " + tok } })
    let me = ""
    try {
      me = JSON.stringify(await m.json()).slice(0, 90)
    } catch {}
    console.log(`第 ${i} 轮：注册 http=${r.status} sub=${sub} → /users/me http=${m.status} ${m.status === 200 ? "✅" : "❌ " + me}`)
    await sleep(1500)
  }
})()
