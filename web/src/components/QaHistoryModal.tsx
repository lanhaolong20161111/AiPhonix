/** 问答记录浮窗 — 展示某会话 scope 下的全部 AI 问答（统一组件，识别结果页 / 文本输入页共用） */

import { useQaStore, scopeQa, relQaLabel } from "../stores/qaStore"
import { useTts } from "../hooks/useTts"
import { TapCharText } from "./TapCharText"

interface QaHistoryModalProps {
  /** 会话 scope（结果页用 sessionId，输入页用 input-时间戳） */
  scope: string
  /** 展示用模块名 */
  moduleLabel: string
  onClose: () => void
}

export function QaHistoryModal({ scope, moduleLabel, onClose }: QaHistoryModalProps) {
  const qa = useQaStore((s) => s.qa)
  const { speaking, speak } = useTts()
  const entries = Object.entries(scopeQa(scope, qa))

  return (
    <div className="qa-modal-mask" onClick={onClose}>
      <div className="qa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qa-modal-head">
          <b>💬 {moduleLabel} 问答记录</b>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="qa-modal-body">
          {entries.length === 0 ? (
            <p className="empty">还没有问答记录，点每个块/题下的「❓ 向 AI 提问」试试。</p>
          ) : (
            entries.map(([key, list]) => (
              <div key={key} className="qa-modal-group">
                <div className="qa-modal-group-label">{relQaLabel(key)}</div>
                {list.map((it, i) => (
                  <div key={i} className="qa-modal-item">
                    <div className="block-qa-q">🙋 {it.q}</div>
                    <div className="block-answer">
                      <div className="block-answer-head">
                        <span className="block-answer-label">🤖 AI 回答</span>
                        <button
                          className="block-speak-btn"
                          disabled={speaking}
                          onClick={() => void speak(it.a)}
                          title="朗读回答"
                        >
                          🔊
                        </button>
                      </div>
                      <div className="block-answer-text">
                        <TapCharText text={it.a} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
