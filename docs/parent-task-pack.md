# 家长训练任务包（客户端先行版）

> 状态：**已落地（2026-08-04）**。是 [[dynamic-app-design.md]]（服务端 Topic/Block 编排）在客户端的**简化先行实现**：
> 家长先能在 App 内"决定学生练什么"，等 Server-Driven 编排成熟后再升级为服务端下发配置（M5/M6 定制化路线）。

## 1. 需求与设计决策（用户确认）

- **问题**：App 入口/页面过多（35+ 路由），学生面对选择过载，家长无法控制孩子练什么。
- **方向**（用户 ask 确认）：
  - 配置来源：**App 内家长设置 + 本地存储**（非服务端下发/热更新）
  - 训练形态：**任务包制**（家长勾选功能组成"今日任务"）
  - 学生身份：沿用现有登录，家长区加 **PIN**（SHA-256+盐，SharedPreferences）
- **简化版调整**（用户二次确认"任务包简化版"）：
  - **去掉目标量**：原设计"认字 20 个"只是展示字段，页面不按目标出题 → 半成品，移除。
  - **保留轻打卡**：从首页任务卡进入页面并返回 = 自动完成（幂等，语义明确标注"轻"）。
- **导入功能归属**（用户确认）：`导入学习内容` / `我的导入` 是**家长管理功能**，不进学生任务，
  固定显示在家长设置页的"内容管理"区。理由：导入是家长的配置动作（"先准备什么"），
  任务是学生的训练动作（"练什么"），职责分离；学生乱导入也没意义。

## 2. 核心抽象与文件

| 抽象 | 说明 | 位置 |
|---|---|---|
| `FeatureId` | 功能目录枚举 11 项；`isTraining=false` 表示家长管理功能（导入/我的导入）；`trainableEntries` 供任务勾选 | `data/training/FeatureCatalog.kt` |
| `TrainingPlan` / `PlanItem` | 任务包数据模型（items + done/doneAt 打卡态） | `data/training/TrainingPlan.kt` |
| `TrainingPlanStore` | files JSON 持久化 + StateFlow；save/reset/markDone/PIN | `data/training/TrainingPlanStore.kt` |
| `ParentSettingsScreen` | PIN 门禁（Setup/Verify/Ready 状态机）→ 任务编辑页 + 内容管理区 | `ui/parent/ParentSettingsScreen.kt` |
| `HomeScreen`（任务驱动） | 空态引导 / 今日任务卡片 / 全部完成祝贺 / 🔒 家长入口；只渲染 `isTraining` 项 | `ui/home/HomeScreen.kt` |
| `Navigation.kt` | `activePlanItemId` 打卡：backStack.size==1（回首页）时 `markDoneAsync`；ParentSettings 路由注册 | `Navigation.kt` |

### FeatureId 映射关系

- 训练目录 9 个：认字/默写/词语/口述作文/看图识字/英语/视频跟读/每日一练/我的学习 → `toNavKey()` 映射路由。
- 家长管理 2 个：`import_center`、`my_imports` → 内容管理区两个固定入口卡片（跳 `ImportCenter` / `MyImports` 路由）。

## 3. 关键实现细节

- **旧数据兼容**：`Json { ignoreUnknownKeys = true }` —— 含已删除 `target` 字段的旧 JSON 正常读取。
  旧 `import_center` 任务项：`featureId?.isTraining == false` → 首页不渲染、编辑页 draft 初始化时过滤掉，保存后从存储清除。
- **打卡幂等**：`markDone(itemId)` 内 `!it.done` 守卫；Navigation 层 `LaunchedEffect(backStack.size)` 触发，天然幂等。
- **打卡落盘**：`markDoneAsync` 用 `withContext(Dispatchers.IO)`，避免主线程写盘。
- **PIN 门禁状态机**：`Setup → Ready` / `Verify → Ready`；错误 PIN 拒绝并提示。
- **完成计数**：首页 `items.count { it.done } / items.size` 按**过滤后**的可训练项计算，防止旧管理项干扰"全部完成"判定。

## 4. 与 Server-Driven 编排（dynamic-app-design.md）的衔接

| 本实现（已落地） | 长线设计（未来） |
|---|---|
| 家长在 App 内勾选功能（FeatureId 集合） | 家长在服务端/App 选 Topic/Block，配置下发 |
| 本地 JSON 存储 | 服务端 `GET /topics/daily` + 缓存版本 |
| 页面 = 现有路由（NavKey） | 页面 = 内置组件渲染器（Block 序列） |
| 打卡 = 进入返回 | `practice_sessions` 结果回传 + 报告 |

升级路径：任务包的 `PlanItem.feature` 可平滑替换为 `BlockSpec[]`（TopicConfig 的 blocks），
入口/家长控制/PIN 门禁可原样复用——本次实现是编排系统的**外壳与心智模型**。

## 5. 测试

- `TrainingPlanTest.kt`（含 FeatureCatalogTest + TrainingPlanStoreLogicTest）：86 用例全过
  - 目录唯一性/fromId 往返/未知 id 容错
  - **训练目录 = 9，导入功能 isTraining=false 且不在 trainableEntries**
  - markDone 幂等、doneCount、hasFeature
