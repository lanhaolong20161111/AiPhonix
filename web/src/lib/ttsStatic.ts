/** 发音库静态直连路径（2026-09-20）
 *
 * ## 为什么要把「点读」从容器挪到静态托管
 *
 * 原路径：点读 → `GET /api/v1/tts/char/:char` → 云托管容器 → 容器再读自己的静态资源。
 * 每次点击的成本（CloudBase 实测单价）：
 *   - 网关调用 `0.003 点/次`
 *   - 容器出流量 ~12KB × `800 点/GB` ≈ `0.009 点`
 *   ⇒ **≈ 0.012 点/次**，而且必须把容器从 0 唤醒（`MinNum=0` 下首个请求还要等 30s 冷启动）。
 *
 * 而服务端在**不带 `pinyin`** 时返回的**就是这个静态文件**——
 * 见 `server_cf/src/lib/preGeneratedTts.ts` 的 `lookupPreGenerated()`
 * （单汉字 → `data/tts_char/{字}.mp3`，随 Worker Assets / 静态托管原子部署）。
 * 走静态托管 CDN 只需 CDN 出流量（`210 点/GB`，约为容器的 1/3.8），
 * 且实测响应头是 `public, max-age=300, s-maxage=600`
 * ⇒ **5 分钟内重复点读同一个字 `transferSize = 0`（零流量、零网关调用）**。
 *
 * ## 只在「单个汉字 + 未指定拼音」时尝试
 *
 * 带 `pinyin` 时必须走容器：服务端要用百度注音语法 `字(pinyin)` 锁定读音，
 * 而静态文件名**只按原字保存**，无法区分多音字（服务端注释口径一致）。
 * 只对**单个汉字**尝试，是因为静态库里只有汉字——字母/数字/拼音音节没有对应文件，
 * 盲目探测会白拿一次 404（那也是一次网关调用）。
 *
 * ⚠️ 静态库覆盖约 6489 个常用字；未覆盖的字第一次会 404，之后由
 * `markTtsStaticMiss()` 记住，不再重复探测。
 */

/** 与 server_cf `isSingleHanzi()` 同口径 */
const SINGLE_HANZI = /^[\u4e00-\u9fff]$/

/** 静态库确认没有的字（探测到 404 的字），避免每次点读都白探一次 */
const STATIC_MISSES = new Set<string>()

/** 静态发音库路径。不适用（非单个汉字）时返回 `null`。 */
export function staticCharAudioPath(char: string): string | null {
  if (!SINGLE_HANZI.test(char)) return null
  return `/tts-cache/data/tts_char/${encodeURIComponent(char)}.mp3`
}

/** 记下这个字静态库没有（CDN 404），后续直接走容器 */
export function markTtsStaticMiss(char: string): void {
  STATIC_MISSES.add(char)
}

/** 这个字是否已知不在静态库里 */
export function isTtsStaticMiss(char: string): boolean {
  return STATIC_MISSES.has(char)
}

/** 单测用：清空已记录的 miss */
export function __resetTtsStaticMisses(): void {
  STATIC_MISSES.clear()
}
