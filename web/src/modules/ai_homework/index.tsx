/** AI 数学作业页 —— 实现见 `components/AiUploadPage`（语文 / 英语 / 数学三页共用同一套流程）。
 *
 * 数学整图识别沿用扁平口径（`omitStructured`：不落 blocks/crops），展示退回题目列表。
 */

import { AiUploadPage } from "../../components/AiUploadPage"

export function AiHomeworkPage() {
  return (
    <AiUploadPage
      mode="math"
      title="🧮 AI 数学"
      hint="拍照识别题目（可一次选多张，第 1 张先出结果）或输入文字，点「提问」让 AI 直接解答/讲解。"
      omitStructured
    />
  )
}
