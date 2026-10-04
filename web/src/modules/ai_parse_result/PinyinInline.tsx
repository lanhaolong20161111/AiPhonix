/** 内联拼音部件点读 — 识别文本中的拼音音节，点击拆出 声母/介母/韵母/整体认读音节 逐个发音 */

import { useMemo, useState } from "react"
import { normalizePinyin, pinyinChips, splitRunPinyin } from "../../lib/pinyin"
import { API_BASE } from "../../services/config"
import { audioManager } from "../../lib/audioManager"

/** 点击音节：展开部件 chips 并自动按 声母→介母→韵母 顺序朗读；每个部件可单独再点
 * @param playOnly 行内 ruby 紧凑模式：点击只按顺序播放部件，不展开 chips（避免挤乱正文排版） */
export function PinyinInline({ syllable, playOnly }: { syllable: string; playOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  const chips = useMemo(() => {
    // 文本渲染会去除空格（拼音行对齐汉字），连写串需按拼音表贪心切分
    const syls = splitRunPinyin(normalizePinyin(syllable))
    return syls.flatMap(function (s) {
      return pinyinChips(s, API_BASE).flat()
    })
  }, [syllable])

  const playSeq = async () => {
    for (const c of chips) {
      const ok = audioManager.playUrl(c.audioUrl)
      if (ok) await audioManager.waitFinish()
    }
  }

  if (playOnly) {
    return (
      <span className="pinyin-inline">
        <span
          className="pinyin-inline-syl"
          title="点击播放声母/韵母/介母"
          onClick={(e) => {
            e.stopPropagation()
            void playSeq()
          }}
        >
          {syllable}
        </span>
      </span>
    )
  }

  return (
    <span className="pinyin-inline">
      <span
        className="pinyin-inline-syl"
        title="点击拆分声母/韵母发音"
        onClick={() => {
          setOpen(function (v) {
            return !v
          })
          if (!open) void playSeq()
        }}
      >
        {syllable}
      </span>
      {open && chips.length > 0 && (
        <span className="pinyin-inline-chips">
          {chips.map(function (c, i) {
            return (
              <span
                key={i}
                className="pinyin-inline-chip"
                title={c.mnemonic || c.label}
                onClick={function () {
                  audioManager.playUrl(c.audioUrl)
                }}
              >
                {c.label}
              </span>
            )
          })}
        </span>
      )}
    </span>
  )
}
