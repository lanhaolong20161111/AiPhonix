/** AI 英语页 —— 实现见 `components/AiUploadPage`（语文 / 英语 / 数学三页共用同一套流程）。
 *
 * 英语暂用语文识别通道，服务端按 `module=english` 跳过多音字 / 中文去噪。
 */

import { AiUploadPage } from "../../components/AiUploadPage"

export function AiEnglishPage() {
  return (
    <AiUploadPage
      mode="english"
      title="📚 AI 英语"
      hint="拍照识别英语课文（可一次选多张，第 1 张先出结果），或在框内输入问题/内容，点「提问」让 AI 直接回答。"
    />
  )
}
