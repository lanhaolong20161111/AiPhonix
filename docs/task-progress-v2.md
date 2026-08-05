# 训练任务包 V2 — 服务端下发配置 + 真实完成度回传

> 衔接 `parent-task-pack.md`（V1 本地版）与 `dynamic-app-design.md`（Server-Driven 编排）。
> 方向 3（配置服务端下发）+ 方向 2（真实完成度回传）一起做；**有真实结果才算完成**（V1 的"回首页即打勾"废弃）。

## 数据流总览

```
家长设置页保存 → TrainingPlanStore.savePlan（本地）→ TrainingPlanSync.pushPlan（PUT /training/plan）
学生首页/登录后  → TrainingPlanSync.pullPlan（GET /training/plan → 服务端为准覆盖本地）
学生点任务卡片   → ActiveTrainingSession.itemId = itemId（HomeScreen onStartItem）
页面练习产生进展 → 页面实时 SessionResultStore.record(itemId, PlanResult)（幂等覆盖，每次进展都写）
返回首页         → Navigation 打卡逻辑 consume(itemId)：
                    有结果 → markDone(itemId, result) + reportProgress（POST /training/progress）
                    无结果 → 不标完成（done 保持 false）
```

## 完成标准（每页"什么算有真实结果"）

| 功能 | 上报点 | PlanResult |
|---|---|---|
| 认字 | 20 题做完（finished） | count=20, correct=答对数 |
| 默写 | 用户提交结果 | count=题数, correct=用户标✓数 |
| 词语 | 用户提交结果 | count=题数, correct=答对数 |
| 看图识字 | 每字反馈实时 record（覆盖） | count=本轮浏览字数, correct=认识数；浏览≥3 字才算完成 |
| 视频跟读 | 每次 SOE 评测完成实时 record | count=评测句数, score=平均分；评测≥1 句 |
| 口述作文 | 写作完成进入结果页 | count=段落数, duration=耗时 |
| 英语 | 页内"✅ 完成本次学习"按钮 | count=1（显式确认，导航中心无隐含完成点） |
| 我的学习 | 页内"✅ 完成本次学习"按钮 | count=1（聚合页，子练习自身已报 practice） |
| 每日一练 | 10 题全部判定完成 | count=10, correct=认识数 |

未达标准（如看图识字只看了 1 字、视频没评测就退出）→ 不 record → 返回首页不标记完成。

## 数据模型

### 客户端
- `PlanItem` 增加 `lastResult: PlanResult? = null`（本地持久化，家长页可见）
- `PlanResult(count, correct?, score?, durationMs, doneAt)`
- `SessionResultStore`（AppContainer 单例）：`record/consume/clear` + StateFlow；record 幂等覆盖
- `ActiveTrainingSession`（object）：`itemId`（HomeScreen 进入时设置，回首页打卡后清空）
- `TrainingPlanSync`：`pullPlan/pushPlan/reportProgress`，复用 `NetworkModule.httpClient` 自动鉴权

### 服务端（SQLite 新表）
- `training_plans`：user_id（唯一，一人一计划）、items_json（透传客户端 TrainingPlan 全量 JSON）
- `practice_sessions`：user_id + plan_item_id + date（唯一约束），feature/count/correct/score/duration_ms/metrics_json

### 接口（均挂 `get_current_user`，Bearer JWT）
| 接口 | 说明 |
|---|---|
| GET  /api/v1/training/plan | 拉配置（无则 plan=null） |
| PUT  /api/v1/training/plan | 保存配置（家长端，upsert） |
| POST /api/v1/training/progress | 上报完成度（upsert by plan_item_id+date） |
| GET  /api/v1/training/progress | 家长查询（?date= / ?start=&end=） |

## 与 V1 差异
- 打卡语义：回首页**无真实结果不再打勾**（HomeScreen "今日任务"进度、庆祝横幅逻辑不变，只是 done 只在有结果时置 true）
- 配置跨设备：同账号服务端为准，启动/登录后拉取覆盖本地；家长保存即推送
- 每日一练从占位页变成真功能：从用户词库/导入数据随机抽 10 字做"认识检测"
