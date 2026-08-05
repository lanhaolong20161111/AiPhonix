# 动态 App 设计（第 1 层：Server-Driven 练习编排）

> 目标：家长在 App 端表达需求 → 服务端下发"练习配置" → 客户端用**内置组件**渲染出页面。
> 边界：服务端只生成**配置与内容**，不生成代码。功能是"组合出来的"，不是"凭空生成的"。

---

## 1. 三个核心抽象

| 抽象 | 含义 | 对应物 |
|---|---|---|
| **Topic（主题）** | 一次练习会话的完整配置（页面 = 块序列 + 参数） | 现有"每日一练三板块"容器 |
| **Block（练习块）** | 客户端内置的**练习单元**（`type` + `params` + 行为绑定），由原子组合而成 | 现有 16 个 ui 页面中可复用的部分 |
| **Material（素材）** | 字卡 / 题目 / 文本 / 图片 / 音频 | `upload_records`（素材池）+ `char_image_index.json` + SRT 字幕 |

关系：`Topic` 包含有序 `Block[]`；每个 `Block` 是 **L1 原子的组合 + 判分行为**；通过 `params` 引用 `Material` 或内嵌内容。

---

## 2. 三层粒度模型（L1 原子 → L2 练习块 → L3 页面）

```
L3 页面（Topic） = L2 练习块的序列 + 参数        ← 客户最终看到并定制的东西
L2 练习块        = L1 原子的常见组合 + 行为绑定    ← 预置模板（现有 8 类页面套壳）
L1 原子组件      = 不可再拆的渲染/交互原语         ← 封闭集合（约 12 个）
```

### L1 原子清单草案（约 12 个，封闭集合）

**展示原子（无状态）**：`title` 标题 / `text` 文本 / `image` 图片 / `audio` 音频 / `video` 视频 / `progress` 进度条 / `badge` 结果徽章（对/错/星）

**交互原子（有状态，产生事件）**：`choice` 选项选择 / `tap_image` 点图选择 / `input` 填空 / `record` 录音 / `submit` 提交 / `next` 下一步

### L2 练习块 = 原子组合 + 行为绑定

| 现有页面 | L2 块 | = L1 原子组合 | 行为绑定（预定义模式） |
|---|---|---|---|
| 看图识字 | `image_card` | image + tap_image + badge + next | 点图→判对错→徽章→下一步 |
| 听写 | `dictation` | audio(TTS) + input + submit + badge | 听→写→判分→徽章 |
| 逐词填空 | `word_fill` | text + input×N + submit + badge | 填→提交判分→徽章 |
| 发音评测 | `pronunciation` | text + record + badge | 读→评测→徽章 |
| 视频跟读 | `video_follow` | video + record + progress | 看→跟读→进度 |
| TTS 朗读 | `tts_read` | text + audio + next | 听/读→下一步 |

### 自由组合的可行性边界（关键约束）

**"自由组合"≠ 任意逻辑代码**，而是**在页面编排模型（状态机框架）内组合**：

```
页面 = { 块序列, 每块参数 }
行为绑定（预定义模式集合，不支持任意逻辑）：
  - 选择/输入/录音 → 判断对错 → 显示反馈 → 下一步
  - 多个原子共享一个"答案状态"（如 record 和 input 判同一题）
```

客户可定制：**顺序、数量、内容、参数、跳转**。不可定制：**判分逻辑本身**（判分是封闭模式）。这样才能"自由但可落地"。

### 客户定制分两层（先后落地）

- **A. 块级组合（先做）**：客户在服务端网页（复用现有 `web/`）选块、排序、填参数 → 生成 Topic JSON → App 渲染。覆盖 90% 真实需求。
- **B. 原子级可视化编辑器（后置）**：拖拽 L1 原子拼页面（迷你低代码平台工作量）。等 A 跑通、确认客户真有拼页需求再做。

> 现状红利：L1 原子已在 Compose 代码里存在（现有页面内部全是 title/text/image/button 组合）。"细粒度化"不是重写，而是把反复出现的交互模式抽成可参数化的 L2 块。

---

## 3. 主题配置 JSON Schema

```jsonc
{
  "id": "topic_20260803_cn_g2",        // 唯一 ID（日期+科目+年级）
  "title": "二年级语文 · 每日一练",
  "grade": "二年级",
  "subject": "语文",                   // 语文 / 数学 / 英语
  "config_version": 3,                 // 版本号：客户端缓存对比用，变了才重拉
  "generated_by": "template:cn_daily_g2",  // 生成来源（模板 or AI，见 §7）
  "blocks": [
    { "type": "image_card", "params": { "grade": "二年级", "semester": "上", "type_": "认", "count": 20 } },
    { "type": "tts_read",  "params": { "items": [ { "text": "春天", "lang": "zh" } ], "count": 10 } },
    { "type": "dictation", "params": { "words": [ "春天", "花朵", "太阳" ], "count": 5 } }
  ],
  "report": { "collect": true }        // 是否回传练习结果（onResult 落库）
}
```

**规则**：
- `blocks` 顺序即页面渲染顺序（从上到下）。
- `params` 是宽松 JSON 对象（`JsonObject`），由各块**自己**解析成类型化参数——新增参数不破坏 schema。
- 预留 `container` 块类型可嵌套（每日一练三板块 = 顶层 container，内部再放各科目 topic）。
- 未知 `type`：客户端显示占位卡"此练习暂不支持"，**不崩溃、不阻塞后续块**（向前兼容）。

---

## 4. L2 练习块注册表 v1（全部映射现有页面）

| type | 名称 | 关键 params | 复用现有 | 数据源 |
|---|---|---|---|---|
| `image_card` | 看图识字/字卡 | grade, semester, type_（认/写/词/英词/英句）, count | CharImageScreen | char_image_index.json |
| `tts_read` | TTS 朗读 | items[{text,lang}], count, speed | TtsEngine + /tts/synthesize | 内嵌文本 |
| `dictation` | 听写 | words[], tts:true | DictationScreen + TTS | 内嵌词表 |
| `word_fill` | 逐词填空 | items[{cn,word}], roundCount | QuizScreen（无视频版） | 内嵌题目（LLM 生成） |
| `video_follow` | 视频跟读 | videoName, srtPath | VideoPracticeScreen + Quiz | SRT + MP4 |
| `pronunciation` | 发音评测 | wordIds[] | PronunciationScreen + /soe/evaluate | 词库 |
| `oral_write` | 口述作文 | title, prompts[] | OralWritingScreen（6 端点） | 内嵌 |
| `container` | 容器（嵌套） | children: Block[] | DailyPracticeScreen 三板块 | — |

**新增块 = 把现有页面包一层标准壳**：`type 常量 + params 解析器 + 行为绑定 + onResult 回传`，不动页面内部逻辑。
**未来拆原子（B 层）**：从块中抽出原子序列 + 行为绑定，块变为"原子模板"——接口不变，实现层变化。

---

## 5. 客户端渲染器接口（Kotlin）

```kotlin
// ── 配置模型（kotlinx.serialization）──
@Serializable
data class TopicConfig(
    val id: String,
    val title: String,
    val grade: String = "",
    val subject: String = "",
    val configVersion: Int = 1,
    val generatedBy: String = "",
    val blocks: List<BlockSpec> = emptyList(),
    val report: ReportOption = ReportOption(collect = false),
)

@Serializable
data class BlockSpec(
    val type: String,
    val params: JsonObject = JsonObject(emptyMap()),
)

// ── 渲染器：顺序渲染 + 递归容器 + 容错 ──
@Composable
fun TopicRenderer(config: TopicConfig, onResult: (BlockResult) -> Unit) {
    Column {
        config.blocks.forEach { spec ->
            when (spec.type) {
                "image_card"     -> ImageCardBlock(spec.params, onResult)
                "tts_read"       -> TtsReadBlock(spec.params, onResult)
                "dictation"      -> DictationBlock(spec.params, onResult)
                "word_fill"      -> WordFillBlock(spec.params, onResult)
                "video_follow"   -> VideoFollowBlock(spec.params, onResult)
                "pronunciation"  -> PronunciationBlock(spec.params, onResult)
                "oral_write"     -> OralWriteBlock(spec.params, onResult)
                "container"      -> { /* 递归 TopicRenderer(子配置) */ }
                else             -> UnsupportedBlock(spec.type) // 占位，不崩溃
            }
        }
    }
}

// 每个块：解析 params → 渲染 → 完成时回传结果
@Composable
fun ImageCardBlock(params: JsonObject, onResult: (BlockResult) -> Unit) {
    val p = remember { params.asImageCardParams() }   // 解析失败 → 显示"配置错误"并 return
    // ... 复用 CharImageScreen 的现有实现
}

// ── 结果回传（测量层，为专注力/报告铺路）──
data class BlockResult(
    val blockType: String,
    val correct: Int,
    val total: Int,
    val durationMs: Long,
    val details: String = "",   // 明细 JSON（复用 speech_eval_records 的 details 模式）
)
```

**组件内部分层**（遵循 AGENTS.md）：`TopicRenderer(UI) → TopicViewModel → TopicRepository(拉配置) → HTTP`；LLM 调用只出现在服务端。

---

## 6. 客户端缓存与版本

- 进入"每日一练"时 `GET /api/v1/topics/daily?grade=&subject=` → 与本地 `config_version` 对比，变化才更新。
- 拉取失败 → 用上次缓存的配置（离线可练）。
- 每日换素材 → 新鲜感；缓存保证断网不空。

---

## 7. 服务端端点

| 端点 | 用途 | 状态 |
|---|---|---|
| `GET /api/v1/topics/daily?grade=&subject=` | 今日主题配置（模板引擎生成 + 素材随机轮换） | **M1 实现** |
| `GET /api/v1/topics` | 模板/历史主题列表 | M1 |
| `POST /api/v1/practice/sessions` | 练习结果回传（onResult 批量落库 `practice_sessions` 表） | M3 |
| `GET /api/v1/materials?origin=&kind=&limit=` | 素材池查询（源自 upload_records：origin 溯源正好作为选材键） | M1 |
| `POST /api/v1/topics/generate` | 需求文本 → LLM 生成主题配置（第 2 层） | M4 预留 |

**模板引擎（M1）**：`templates/` 目录存静态模板（如 `cn_daily_g2.json` 挖空素材槽位），服务端每次拉取时**从素材池随机填充** → 同模板不同内容。
**生成来源标识**：`generated_by = "template:xxx"` 或 `"ai:xxx"`，客户端不区分（接口一致）。

---

## 8. 素材池契约（Material）

| 块需要 | 来源 | 访问 |
|---|---|---|
| 图片（字卡） | char_image_index.json（现有） | 现有 imageUrl |
| 图片（上传的素材） | upload_records.file_name | `GET /api/v1/uploads/file/{name}` |
| 文本（上传素材） | upload_records.content / ocr_text | `GET /api/v1/uploads` |
| 音频 | /tts/synthesize（实时合成） | 现有 |
| 字幕/视频 | SRT + MP4（assets） | 现有 |

选材策略（M1）：`origin` 精确匹配优先 → 随机取 N 条；M4 由 LLM 按需求选。

---

## 9. 落地顺序（块级组合先行，原子编辑器后置）

| 里程碑 | 内容 | 验证 |
|---|---|---|
| **M1** | schema + `templates/` 2 个模板（语文/英语）+ `/topics/daily` + `/materials` | curl 拿配置 JSON |
| **M2** | 客户端渲染器 + 2 个块（image_card、tts_read）+ 缓存/版本 | 每日一练页显示真实内容 |
| **M3** | 其余 6 块 + `practice_sessions` 落库 + 报告页 | 全块跑通 + 结果可查 |
| **M4** | 需求表单 → `/topics/generate`（LLM 组合配置） | 自然语言出练习 |
| **M5（可选）** | Web 端块级选择/排序界面（客户自助组页 = 定制化 A 层） | 客户拼页生成 Topic |
| **M6（远期）** | L1 原子拆解 + 可视化编辑器（定制化 B 层，按需启动） | 拖拽拼原子页面 |

---

## 10. 待确认的决策点

1. **v1 块范围**：先做 4 个核心（image_card / tts_read / dictation / video_follow，已覆盖语数英）还是 8 个全做？→ 推荐 4 个起步。
2. **每日轮换策略**：固定模板 + 素材随机（推荐）vs 模板内配置变体。
3. **素材选材**：M1 按 origin 过滤 + 随机（推荐）；家长手选素材池在 M4 与 AI 并行提供。
4. **原子拆解时机**：等客户真实拼页需求（推荐）vs 提前拆（成本高，收益未知）。
