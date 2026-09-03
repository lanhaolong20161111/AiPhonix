/** 助记词显隐切换按钮 — 放在各模块页 module-header 右侧，状态存 localStorage */

export function MnemonicToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      className={`mnemonic-toggle${visible ? "" : " off"}`}
      onClick={onToggle}
      aria-pressed={visible}
      title="显示/隐藏助记词"
    >
      {visible ? "隐藏助记" : "显示助记"}
    </button>
  )
}
