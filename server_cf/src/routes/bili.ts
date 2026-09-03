/** B站搜索代理 — GET /api/v1/bili/search?keyword=&page=
 * 浏览器直接请求 api.bilibili.com 会被 CORS 拦截，且裸请求会被风控(-412)。
 * 服务端代搜：带 UA/Referer + buvid3 cookie（首次访问主站获取并复用），实测可通。
 * Cloudflare 版：纯 fetch 逻辑，与 server_ts 逐字一致（Workers 支持 AbortSignal.timeout / getSetCookie）。
 */
import { Hono } from "hono"

const router = new Hono()

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

let buvidCookie = ""

async function ensureCookie(): Promise<string> {
  if (buvidCookie) return buvidCookie
  try {
    const r = await fetch("https://www.bilibili.com/", { headers: { "User-Agent": UA }, redirect: "manual" })
    const setCookies: string[] =
      typeof r.headers.getSetCookie === "function" ? (r.headers.getSetCookie() as string[]) : []
    const keep = setCookies.map((c) => c.split(";")[0] ?? "").filter((c) => c.startsWith("buvid"))
    if (keep.length) buvidCookie = keep.join("; ")
  } catch {
    /* 无 cookie 也试一次 */
  }
  return buvidCookie
}

router.get("/bili/search", async (c) => {
  const keyword = (c.req.query("keyword") ?? "").trim()
  const page = Number(c.req.query("page") ?? "1") || 1
  if (!keyword) return c.json({ detail: "缺少 keyword 参数" }, 422)
  const cookie = await ensureCookie()
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}`
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: "https://search.bilibili.com/",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(10000),
    })
    const j: any = await resp.json().catch(() => null)
    if (!j || j.code !== 0) {
      return c.json({ detail: `B站搜索失败(code=${j?.code ?? "?"} ${j?.message ?? ""})`, code: j?.code ?? -1 }, 502)
    }
    const items = (j.data?.result ?? [])
      .map((it: any) => ({
        bvid: it.bvid ?? "",
        title: String(it.title ?? "").replace(/<[^>]+>/g, ""),
        author: it.author ?? "",
        duration: typeof it.duration === "string" ? it.duration : "",
      }))
      .filter((x: { bvid: string }) => x.bvid)
    return c.json({ total: j.data?.numResults ?? items.length, items })
  } catch (e) {
    return c.json({ detail: `B站搜索请求失败: ${(e as Error).message}` }, 502)
  }
})

export default router
