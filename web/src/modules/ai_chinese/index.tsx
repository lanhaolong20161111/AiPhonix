/** AI 语文页 —— 实现见 `components/AiUploadPage`（语文 / 英语 / 数学三页共用同一套流程）。
 *
 * 三页此前是逐行复制的三份实现，差异只有 mode / 标题 / 提示文案与下面三个开关，
 * 折叠后这里只负责声明「我是语文那一档」。
 */

import { AiUploadPage } from "../../components/AiUploadPage"

export function AiChinesePage() {
  return (
    <AiUploadPage
      mode="chinese"
      title="📖 AI 语文"
      hint="拍照识别课文（可一次选多张，第 1 张先出结果），或在框内输入问题/内容，点「提问」让 AI 直接回答。"
      polyPatch
      plainStatus
    />
  )
}
