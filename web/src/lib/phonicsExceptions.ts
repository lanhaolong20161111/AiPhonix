/** 拼读着色的**例外词表** —— 规则算不出来的词，人工逐个写死切分。
 *
 * 为什么要有这张表：英语拼读的例外密度极高（have / one / said / people…），
 * 用规则去"凑"这些词只会让规则互相打架、连带把规则内的词也弄错。
 * 所以原则是——**规则只负责规整的模式，例外全部落到这里**，每一条都肉眼可核对。
 *
 * ## 格式
 *
 * `"单词": "块 块 块"`，每个块写成 `<字母>:<类别>`，用空格分开。类别码：
 *
 * | 码 | 类型 | 说明 |
 * |---|---|---|
 * | `c` | consonant | 普通辅音 |
 * | `v` | vowel-single | 单字母元音（短音） |
 * | `V` | vowel-long | 长元音 |
 * | `t` | vowel-team | 组合元音 / 成音节 |
 * | `d` | digraph | 辅音组合 |
 * | `s` | silent | 不发音 |
 * | `o` | other | 非字母 |
 *
 * 例：`"have": "h:c a:v v:c e:s"` —— h 辅音、a **短元音**、v 辅音、e 不发音。
 * （规则引擎会把 have 判成 magic-e 的长音 a，这是错的，所以它必须在表里。）
 *
 * ⚠️ 各块的字母拼起来必须**恰好等于单词本身**（只按大小写不敏感比较）。
 * 对不上时 `phonics.ts` 会自动退回规则引擎，不会渲染出错误文本。
 */

import type { PhonicChunk, PhonicType } from "./phonics"

const CODES: Record<string, PhonicType> = {
  c: "consonant",
  v: "vowel-single",
  V: "vowel-long",
  t: "vowel-team",
  d: "digraph",
  s: "silent",
  o: "other",
}

/** word → 紧凑切分串 */
const RAW: Record<string, string> = {
  // ── magic-e 例外：尾 e 结构在，但前面的元音读短音 ──
  have: "h:c a:v v:c e:s",
  give: "g:c i:v v:c e:s",
  live: "l:c i:v v:c e:s",
  come: "c:c o:v m:c e:s",
  some: "s:c o:v m:c e:s",
  done: "d:c o:v n:c e:s",
  none: "n:c o:v n:c e:s",
  love: "l:c o:v v:c e:s",
  above: "a:v b:c o:v v:c e:s",
  one: "o:v n:c e:s",
  once: "o:v n:c c:c e:s",
  gone: "g:c o:v n:c e:s",

  // ── 词尾 -ere / -are / -ure：尾 e 前的元音不读长音 ──
  are: "ar:t e:s",
  were: "w:c er:t e:s",
  there: "th:d er:t e:s",
  where: "wh:d er:t e:s",
  here: "h:c er:t e:s",
  sure: "s:d ur:t e:s",

  // ── ea 读短音 /e/（规则按长音组合处理）──
  head: "h:c ea:t d:c",
  bread: "b:c r:c ea:t d:c",
  dead: "d:c ea:t d:c",
  ready: "r:c ea:t d:c y:v",
  heavy: "h:c ea:t v:c y:v",
  weather: "w:c ea:t th:d er:t",
  feather: "f:c ea:t th:d er:t",
  leather: "l:c ea:t th:d er:t",
  health: "h:c ea:t l:c th:d",
  death: "d:c ea:t th:d",
  breath: "b:c r:c ea:t th:d",
  sweat: "s:c w:c ea:t t:c",
  threat: "th:d r:c ea:t t:c",
  weapon: "w:c ea:t p:c o:v n:c",
  pleasure: "p:c l:c ea:t s:c ur:t e:s",
  treasure: "t:c r:c ea:t s:c ur:t e:s",
  measure: "m:c ea:t s:c ur:t e:s",

  // ── ai / ie / ay 的例外读音 ──
  said: "s:c ai:t d:c",
  says: "s:c ay:t s:c",
  friend: "f:c r:c ie:t n:c d:c",
  friends: "f:c r:c ie:t n:c d:c s:c",

  // ── 其他高频不规则（块数会被规则算错）──
  eye: "eye:t",
  people: "p:c eo:t p:c le:t",
  busy: "b:c u:v s:c y:v",
  business: "b:c u:v s:c i:s n:c e:v ss:d",
  build: "b:c ui:v l:c d:c",
  built: "b:c ui:v l:c t:c",
  two: "t:c w:s o:v",
  who: "wh:d o:v",
  whose: "wh:d o:v s:c e:s",
  hour: "h:s ou:t r:t",
  our: "ou:t r:t",
  flour: "fl:d ou:t r:t",
  science: "s:c c:c i:v e:v n:c c:c e:s",
  quiet: "qu:d i:v e:v t:c",
  diet: "d:c i:v e:v t:c",
  create: "c:c r:c e:v a:v t:c e:s",
  evening: "e:v v:c e:s n:c i:v ng:d",
  minute: "m:c i:v n:c u:v t:c e:s",
  animal: "a:v n:c i:v m:c al:t",
  beautiful: "b:c eau:t t:c i:v f:c ul:t",
  useful: "u:v s:c e:s f:c ul:t",
  onion: "o:v n:c io:t n:c",
  union: "u:v n:c io:t n:c",
  opinion: "o:v p:c i:v n:c io:t n:c",
  million: "m:c i:v ll:d io:t n:c",

  // ── 自有音素词库（105 词，人工校对 IPA）里规则仍会错的 ──
  eight: "eigh:V t:c",
  colour: "c:c o:v l:c our:t",
}

/** 解析成 `Map<小写单词, 切分块[]>`；格式不合法的条目一律丢弃并告警一次 */
function parse(): Map<string, PhonicChunk[]> {
  const map = new Map<string, PhonicChunk[]>()
  for (const [w, spec] of Object.entries(RAW)) {
    const chunks: PhonicChunk[] = []
    let ok = true
    for (const tok of spec.trim().split(/\s+/)) {
      const idx = tok.lastIndexOf(":")
      const letters = tok.slice(0, idx)
      const code = tok.slice(idx + 1)
      if (!letters || !CODES[code]) {
        ok = false
        break
      }
      chunks.push({ text: letters, type: CODES[code] })
    }
    // 各块拼起来必须正好是单词本身，否则这条数据是坏的 —— 宁可不生效也不能渲染错文本
    if (!ok || chunks.map((c) => c.text).join("") !== w) {
      console.warn(`[phonics] 例外表条目无效，已忽略：${w} → ${spec}`)
      continue
    }
    map.set(w, chunks)
  }
  return map
}

export const POLYPHONE_EXCEPTIONS = parse()
