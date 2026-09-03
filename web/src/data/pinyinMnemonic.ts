/** 拼音助记表 — 每个声母/韵母/整体认读音节配一个"一声汉字"助记，方便学生速记。
 * 课件音频：声母 {b}.mp3 / 韵母 {a}.mp3 / 整体认读 {zhi}.mp3
 * 这里只存 助记汉字段 与 拼音标识 的映射。
 */

/** 声母（23）→ 助记字 */
export const SHENGMU_MNEMONIC: Record<string, string> = {
  b: "波",
  p: "泼",
  m: "摸",
  f: "佛",
  d: "的",
  t: "特",
  n: "呢",
  l: "了",
  g: "哥",
  k: "蝌",
  h: "喝",
  j: "鸡",
  q: "七",
  x: "西",
  zh: "知",
  ch: "吃",
  sh: "师",
  r: "日",
  z: "资",
  c: "疵",
  s: "思",
  y: "一",
  w: "乌",
}

/** 韵母（24）→ 助记字（key 用无调拼音，ü 用 v） */
export const YUNMU_MNEMONIC: Record<string, string> = {
  a: "啊",
  o: "哦",
  e: "鹅",
  i: "一",
  u: "乌",
  v: "淤",
  ai: "哀",
  ei: "诶",
  ui: "威",
  ao: "凹",
  ou: "鸥",
  iu: "优",
  ie: "椰",
  ve: "约",
  er: "耳",
  an: "安",
  en: "恩",
  in: "因",
  un: "温",
  vn: "晕",
  ian: "烟", // 三拼音节 i+an 整体（如 tiān 天、nián 年）
  uan: "弯", // 一般声母 + uan 读"弯"（如 nuan/luan/tuan）
  van: "渊", // üan：j/q/x + uan 读"渊"
  ang: "昂",
  eng: "嗯",
  ing: "英",
  ong: "翁",
}

/** 整体认读音节（16）→ 助记字 */
export const ZHENGTI_MNEMONIC: Record<string, string> = {
  zhi: "知",
  chi: "吃",
  shi: "师",
  ri: "日",
  zi: "资",
  ci: "疵",
  si: "思",
  yi: "一",
  wu: "乌",
  yu: "淤",
  ye: "椰",
  yue: "约",
  yuan: "渊",
  yin: "因",
  yun: "晕",
  ying: "英",
}
