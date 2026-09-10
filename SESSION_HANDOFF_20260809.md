# SESSION_HANDOFF_20260809

> 新会话先读这个文件。完整记忆见 `memory-export-20260809.md`（2026-08-09 导出，48 条记忆全文）。
> 上一份交接：`SESSION_HANDOFF_20260808.md`。

## 当前状态（2026-08-09 17:20）

- **服务端**：运行中（`AiPhonix/server_py`，uvicorn 端口 8080，`python -X utf8 -m uvicorn main:app --host 0.0.0.0 --port 8080`）。`/health` 200，模型 deepseek-v4-flash（health 显示的是 DeepSeek 配置名，实际 Ark 免费模型已分工）。
- **Android 客户端**：包 com.example.ai，Compose + Navigation 3。`.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest`。
- **设备**：已连接（4HPJM7W48XNR9XLV），App 已装最新 APK（16:31 版本，含线段图分步演示+圆圈关系图）。
- **电脑 IP**：`192.168.1.10`（DHCP 动态！App 的 serverBase 和 `network_security_config.xml` 明文白名单两处都要改，根治=路由器 MAC 绑定，未做）。

## 本会话完成（08-09）

1. **返回选择题列表**：`selectQuestion` 不再清空 `recognizedQuestions`——练习页返回仍见多题列表。
2. **0 个关键条件根因**：deepseek-v4-flash 推理模型 max_tokens 被推理耗光（content 空）→ 空内容重试 + max_tokens 4096 + markdown 剥离。
3. **线段图**：链式推算（effectiveValue 防环）、times 双向视角、分步演示三按钮、差值实体行（贵的金额=蓝基准段+红差值段+?，不剧透）、已知量 times 基准方不切分。
4. **单元测试 17 个**：`SegmentDiagramLogicTest.kt` 全过（逻辑已提取到 SegmentDiagramLogic.kt，internal 无 Compose）。
5. **圆圈关系图**：`RelationGraph.kt` 新组件，识别页显示（圆圈+连线+运算标注），线段图保留在识别页下方+练习页。
6. **识图提速**：44s OCR 回退 → 3.4s doubao-seed-evolving（多模态）。**模型分工**：识图=evolving，文本=deepseek-v4-flash-ga。

## 坑（新踩）

- **模型切换是全局的**：ark_chat.model 同时服务识图+文本。切纯文本模型（deepseek-v4-flash-ga）会让识图 400 → 回退 OCR 44s。识图必须 override 多模态模型（`ai_homework.MULTIMODAL_MODEL = "doubao-seed-evolving"`，free_llm.chat 的 model_override 参数）。
- **doubao-seed-evolving 复杂 JSON 提取不稳定**：首次空内容、放宽后要 2 分多钟——所以文本分析用 deepseek-v4-flash-ga，不用 evolving。
- **推理模型 max_tokens 陷阱**：deepseek-v4-flash 系推理 token 与输出共享配额，复杂题推理耗光后 content 空，不是模型"不识别"。
- **drawCircle 不支持 pathEffect 虚线**：虚线圆用 8 段 drawArc 分段。
- **全套测试 2 个既有失败**（与线段图无关）：WordPhonemeRulesTest（apple 音素数据）、FeatureCatalogTest（功能目录 11→12，疑似加数学作业时漏更新）。

## 待办

1. **「我的导入」列表点 kind=problem 进练习页**（user_imports kind=problem 已有数据，如儿童票题 id=5 带 quantities/relations）。
2. **路由器 MAC 绑定**根治 IP 变更（现在 192.168.1.10，App 两处硬编码要同步）。
3. **FeatureCatalogTest 11→12**：确认 12 个功能项是否都有意加入，更新测试。
4. **圆圈图验收**：用户还没在真机确认圆圈图效果（识别页新增），需要反馈。
5. **线段图差值实体**（贵的金额行）：用户要求"基准段+红段+?"已实现，待真机确认。
