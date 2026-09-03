/** 汉字四角信息客户端 — 从静态资源加载汉字属性（结构/笔画/部首）
 *
 * 数据源：shared/data/char_info.json（web/public/char_info.json），
 * 每条形如 {"char":"一","radical":"一","stroke_count":1,"structure":"独体"}。
 * 音序（拼音首字母）由调用方按字的拼音推导。
 */

export interface CharInfo {
  char: string
  radical: string
  stroke_count: number
  structure: string
}

type CharInfoMap = Record<string, CharInfo>

let infoPromise: Promise<CharInfoMap> | null = null

function loadCharInfoMap(): Promise<CharInfoMap> {
  if (infoPromise) return infoPromise
  infoPromise = fetch("/web/char_info.json").then((r) => {
    if (!r.ok) throw new Error(`字库属性加载失败 HTTP ${r.status}`)
    return r.json() as Promise<CharInfo[]>
  }).then((list) => {
    const map: CharInfoMap = {}
    for (const item of list) map[item.char] = item
    return map
  })
  return infoPromise
}

/** 查询某个字的结构/笔画/部首（字不在库中返回 null） */
export async function getCharInfo(char: string): Promise<CharInfo | null> {
  const map = await loadCharInfoMap()
  return map[char] ?? null
}

/** 拼音 → 音序（拼音首字母大写；tone 数字忽略，ü 记作 v→V） */
export function pinyinInitial(pinyin: string): string {
  const m = (pinyin || "").trim().match(/[a-z]/i)
  return m ? m[0].toUpperCase() : ""
}
