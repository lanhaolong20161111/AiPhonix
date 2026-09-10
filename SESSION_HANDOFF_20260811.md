# SESSION_HANDOFF_20260811

> 新会话先读这个文件。完整记忆见 `memory-export-20260811.md`（含操作日志补充 41-68 全量）。
> 上一份交接：`SESSION_HANDOFF_20260809.md`。

## 当前状态（2026-08-11）

- **服务端**：运行中（后台任务托管，`server_py`，uvicorn 8080，`python -X utf8 -m uvicorn main:app --host 0.0.0.0 --port 8080`）。health OK。**启动方式：必须用 `bash(run_in_background=true)` 或开机自启 VBS（前台 bash/Start-Process 会被会话清理杀掉——见补充 57/67）。**
- **Android 客户端**：包 com.example.ai，Compose + Navigation 3。构建：`.\gradlew.bat :app:assembleDebug`；单测：`:app:testDebugUnitTest`（gradle daemon 会消失，冷启动 2 分钟+，前台易超时 → 用 run_in_background + wait）。
- **设备**：4HPJM7W48XNR9XLV（无线 adb mDNS 残留导致多设备 → 一律 `adb -s 4HPJM7W48XNR9XLV`）。
- **电脑 IP**：192.168.1.10（DHCP 动态！App serverBase 与 network_security_config 白名单两处要同步；根治=路由器 MAC 绑定，未做）。
- **模型**（config.yaml ark_chat 段）：文本 `deepseek-v4-flash-ga-260731`（**深度推理模型**，analyze 必须 max_tokens 8192，4096 必空——补充 64）；识图 `doubao-seed-evolving`（MULTIMODAL_MODEL override，**图片 token 按张数固定 1351，不按分辨率**——压缩只省传输——补充 63/65）；免费账号是白名单（换不了其他模型）。

## 数学模块现状（本会话 8-09 大量改造）

**信息流**：识别页（拍照/输入 → 关键句列表可点击 + 问题列表 + 完整解题线段图）→ 练习页（句子朗读 + 问题列表 + 解题线段图 + 倒推挑战）→ 倒推挑战（四步闯关：需要什么→从哪来→怎么算→填答案）。

**服务端端点**（`server_py/routes/ai_homework.py`）：
- `POST /ai-homework/parse-image`：识图（Ark evolving 优先，OCR 回退；压缩 1600px/q85；磁盘缓存 parse_<hash>.json）
- `POST /ai-homework/analyze`：核心分析（marks/quantities/relations，**无 questions**；max_tokens 8192；缓存 analyze_<hash>.json）
- `POST /ai-homework/questions`：轻量问题提取（text/target/needs/hint；2-4s；缓存 questions_<hash>.json）
- `POST /ai-homework/steps`：分步解题链（每步 purpose/formula/result/result_unit/explain/**draw{label,value,unit,color,note}/source**；缓存 steps_<hash>.json）
- `POST /ai-homework/evaluate`：思路评判

**客户端文件**（`app/src/main/java/com/example/ai/ui/aihomework/`）：
- `AiHomeworkScreen.kt` / `AiHomeworkViewModel.kt`：识别页（analyze 后异步补 questions + steps；关键句卡片点击 → 线段图回放）
- `AiHomeworkPracticeScreen.kt` / `AiHomeworkPracticeViewModel.kt`：练习页（init 即 loadSteps；倒推挑战；同样点击回放）
- `SegmentDiagram.kt` / `SegmentDiagramLogic.kt`：旧线段图（**已隐藏**，保留代码）
- `RelationGraph.kt`：圆圈图（**已隐藏**，保留代码；拖拽/高亮能力在）
- `QuestionList.kt`：问题列表 + highlightNamesFor
- `ReverseGuide.kt`：倒推引导（StepClimbGuide 闯关 + StepGraph 解题线段图 + playTargetStepFor/needsFor/checkAnswer 等纯函数）
- `AiHomeworkRepository.kt`：QuestionItem/SolutionStep/SolutionStepDraw/QuantityItem/QuantityRelation 等 data class + fetchQuestions/fetchSteps

**测试**：`SegmentDiagramLogicTest.kt` + `ReverseGuideLogicTest.kt`（aihomework.* 共 43 个全过）。全套 146 个仅剩 2 个既有无关失败（WordPhonemeRulesTest apple 音素、FeatureCatalogTest 功能目录 11→12）。

## 本会话完成（08-09 后半段 + 08-11）

1. **面向问题改造**（补充 61）：LLM 提取所有问题（text/target/needs/hint，多问自动依赖链）+ 问题列表 + 高亮子图 + 四步倒推引导。
2. **分步闯关 + 解题线段图**（补充 62/66/67）：steps 端点（draw 绘制指令）；倒推挑战闯关式（先想后看）；解题线段图 StepGraph 直接显示在识别页+练习页。
3. **点击关键信息 → 线段图动画回放**（补充 68）：steps 每步 source 关联关键句；playTargetStepFor 累积全链；400ms 逐条动画；两页可点。
4. **解析慢修复**（补充 64/65）：4096 必空 → analyze 8192 + prompt 精简 + 拆任务（questions 独立端点）。
5. **隐藏数量关系图/圆圈图**（补充 66）：问题多，先隐藏，解题思路收敛到 StepGraph。

## 坑（新踩，反复出现）

- **gradle daemon 消失** → 冷启动慢：构建/测试用 `run_in_background=true` + `wait`，否则 2 分钟前台超时（工具会报 WaitDelay 误判，看日志确认）。
- **前台 bash 启动的服务端进程被会话清理** → 服务端必须 run_in_background 或开机自启 VBS。
- **adb 多设备**（无线 mDNS 残留 offline 项）→ 必须 `adb -s 4HPJM7W48XNR9XLV`。
- **改 prompt/模型后清缓存**：`data/ai_homework_cache/analyze_*.json`、`steps_*.json`、`questions_*.json`（旧缓存绕过新逻辑）。
- **Python 关键字不能作字段名**：`from` → `source`。
- **remember 更新日志必须带全量 body**（补充 60 起曾因只传单条覆盖丢失 41-59，已重建为 41-68）。

## 待办（按用户明确提出的方向）

1. **🔴 搭积木学习（重大新功能，已讨论未实施）**：学生自己用"组件"搭线段图和圆圈图 → 提交大模型审核是否满足题目要求。双向学习：正向=学生自己搭，反向=大模型给解题步骤和关键条件。**用户提出的技术问题：组件是当场实时画出来成为组件，还是内置好？** 我的建议：内置一套基础积木（线段/数值标签/关系线/节点圆）+ 允许从 LLM 生成的新积木动态加入，两全。**等待用户确认后开始设计实施。**
2. **FeatureCatalogTest 11→12**：确认 12 个功能项是否有意加入，更新测试（既有失败）。
3. **路由器 MAC 绑定**根治 IP 变更（现 192.168.1.10）。
4. **识别页/练习页现有隐藏图**（SegmentDiagram/RelationGraph）是否最终移除或保留作对照，等搭积木方案确定。
