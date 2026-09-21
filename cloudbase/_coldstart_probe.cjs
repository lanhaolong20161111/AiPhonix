#!/usr/bin/env node
/**
 * 冷启动探测 —— 验证 `MinNum=0` 是否真的缩容到 0，以及冷启动要多久。
 *
 * 用法：
 *   CB_BASE=https://<网关域名> WAIT_MIN=45 ROUNDS=2 node cloudbase/_coldstart_probe.cjs
 *
 * 平台规则（官方文档）：
 *   运行模式「始终自动扩缩容」下实例数可在 0-10 之间自动调整；
 *   但**版本流量百分比不为 0 时，需要连续半小时的观测期**，期间版本没有产生真实业务流量，
 *   才会触发缩容到 0。⇒ 静置期间**绝对不能访问该域名**（任何请求都会把空闲计时器清零）。
 *   控制面 API（MCP queryCloudRun / queryEnv）不算业务流量，可以调。
 *
 * ⚠️ 第一版失败的教训：静置 38 分钟已 > 30 分钟，但首击仍是 336ms（热的）。
 *    事后查平台指标 `TkeInvokeNumService` 发现：静置期 15:35 有 3 次、15:45 有 1 次调用，
 *    **把 30 分钟窗口重置到 16:15**，而探测在 16:10:45 就打了 ⇒ 早了 5 分钟，实验作废。
 *    ⇒ 单轮 38 分钟不够。本版加 ROUNDS：某轮若仍是热态，就再等一轮（自校正）。
 *    ⇒ 判读结果时**必须**用 `queryEnv(action="metrics", metricName="TkeInvokeNumService")`
 *       复核静置窗口内是否真的零调用，否则结论不成立。
 *
 * 另：本机沙箱下 spawnSync 恒 EBUSY ⇒ 这里一律用 fetch，不 spawn 子进程。
 *
 * 判据：
 *   · 冷启动：第一个请求明显变慢（≥2s 且 ≥热态 5 倍）或先 503 后 200
 *   · 未缩容：第一个请求也是毫秒级（说明实例一直是热的）
 *   · 页面外壳不受影响：`/web/` 由 CDN 应答，必须始终快（这决定「缩容到 0」是否可接受）
 */

const BASE = (process.env.CB_BASE || "https://cloudbase-test-d8gna6iyy14e2ba39-1444240037.ap-shanghai.app.tcloudbase.com").replace(/\/$/, "");
const WAIT_MIN = Number(process.env.WAIT_MIN || 45);
const ROUNDS = Number(process.env.ROUNDS || 2);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(...a) {
  console.log(`[${ts()}]`, ...a);
}

/** 单次请求：返回 {code, ms, upstream, body, timeout} */
async function probe(path, { timeoutMs = 90000, headers = {} } = {}) {
  const started = Date.now();
  try {
    const r = await fetch(BASE + path, {
      headers: Object.assign({ "User-Agent": UA }, headers),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    const body = (await r.text()).slice(0, 200);
    return {
      code: r.status,
      ms: Date.now() - started,
      upstream: r.headers.get("x-cloudbase-upstream-type") || "-",
      upCost: r.headers.get("x-cloudbase-upstream-timecost") || "-",
      body,
      timeout: false,
    };
  } catch (e) {
    return {
      code: 0,
      ms: Date.now() - started,
      upstream: "-",
      upCost: "-",
      body: String(e.cause || e.message).slice(0, 160),
      timeout: e.name === "TimeoutError",
    };
  }
}

function line(tag, r) {
  const flag = r.code === 200 ? "✓" : r.code === 0 ? "✗" : "⚠";
  log(
    `${flag} ${tag.padEnd(26)} code=${String(r.code).padEnd(3)} ${String(r.ms).padStart(6)}ms  ` +
      `upstream=${r.upstream}  upCost=${r.upCost}  ${r.body.slice(0, 80)}`
  );
}

async function probeRound(round) {
  log("");
  log("=".repeat(96));
  log(`第 ${round}/${ROUNDS} 轮：静置 ${WAIT_MIN} 分钟（期间禁止访问该域名！）`);
  log("=".repeat(96));

  // 静置：每 5 分钟打一条进度（只写日志，不发请求）
  const stepMs = 5 * 60000;
  let elapsed = 0;
  while (elapsed < WAIT_MIN * 60000) {
    const chunk = Math.min(stepMs, WAIT_MIN * 60000 - elapsed);
    await new Promise((r) => setTimeout(r, chunk));
    elapsed += chunk;
    if (elapsed < WAIT_MIN * 60000) log(`  … 静置中，已 ${Math.round(elapsed / 60000)}/${WAIT_MIN} 分钟（不发任何请求）`);
  }

  log("");
  log("── 静置结束，开始探测 ──");

  // ① 冷启动第一击：容器路径
  const c1 = await probe("/health");
  line("① 冷启动首击 /health", c1);

  // ② 紧接着第二击：热态基线
  const c2 = await probe("/health");
  line("② 紧随其后 /health", c2);

  // ③ 若首击不是 200，再补三击看恢复过程
  if (c1.code !== 200) {
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      line(`③ 恢复重试 #${i} /health`, await probe("/health"));
    }
  }

  // ④ 页面外壳（CDN 路径）：缩容到 0 时它必须仍然快 —— 这决定方案是否可用
  const s1 = await probe("/web/", { headers: { Accept: "text/html,application/xhtml+xml" } });
  line("④ 页面外壳 /web/ (CDN)", s1);

  // ⑤ 一个真正走容器的业务路径（不存在的路由 → 404，说明请求确实到了容器）
  const a1 = await probe("/llm/definitely-not-a-route");
  line("⑤ 业务路径（应为 404）", a1);

  // ⑥ 连打 5 次确认稳定
  log("");
  log("── 稳定期连打 5 次 /health ──");
  const burst = [];
  for (let i = 0; i < 5; i++) {
    const r = await probe("/health");
    burst.push(r);
    line(`   #${i + 1}`, r);
  }

  const ok = burst.filter((r) => r.code === 200);
  const warm = ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : c2.ms;
  const cold = c1.ms;
  const isCold = c1.code !== 200 || cold > Math.max(warm * 5, 2000);

  log("");
  log("=".repeat(96));
  log(`首击 ${c1.code} / ${cold}ms   次击 ${c2.code} / ${c2.ms}ms   热态基线 ≈ ${warm}ms`);
  if (isCold) {
    log(`⇒ **确实缩容到 0 了**：首击比热态慢 ${(cold / warm).toFixed(1)}×（冷启动开销 ≈ ${cold - warm}ms）`);
  } else {
    log("⇒ **本轮未观察到缩容到 0**：首击与热态同量级 ⇒ 容器仍是热的。");
  }
  log(`页面外壳（CDN）：${s1.code} / ${s1.ms}ms  ⇒ ${s1.ms < 500 ? "缩容到 0 不影响首屏外壳" : "偏慢，需留意"}`);
  log("=".repeat(96));
  return { cold: isCold, c1, c2, warm, s1 };
}

(async () => {
  const t0 = Date.now();
  log("=".repeat(96));
  log(`冷启动探测  BASE=${BASE}`);
  log(`轮数=${ROUNDS}  每轮静置=${WAIT_MIN} 分钟  预计最晚 ${new Date(t0 + ROUNDS * WAIT_MIN * 60000).toLocaleTimeString("zh-CN", { hour12: false })} 结束`);
  log("=".repeat(96));

  for (let r = 1; r <= ROUNDS; r++) {
    const res = await probeRound(r);
    if (res.cold) {
      log("");
      log(`★ 第 ${r} 轮确认缩容到 0，提前结束。`);
      return;
    }
    if (r < ROUNDS) {
      log("");
      log(`… 第 ${r} 轮为热态：可能被平台侧流量重置了 30 分钟窗口，再等一轮。`);
    }
  }
  log("");
  log("★ 全部轮次均为热态 ⇒ 强烈提示「该服务不会缩容到 0」。");
  log("  下一步：用 queryEnv(action=metrics, metricName=TkeInvokeNumService) 复核静置窗口是否真零调用。");
})();
