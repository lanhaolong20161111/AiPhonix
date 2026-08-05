# 📥 导入学习内容模块 — 功能与架构说明

> 2026-08-03 整理（P0 已落地 + 消费端合并 + 我的导入页 + 401 自动刷新 + 快速失败超时）

## 一、模块定位

让用户把**自己的学习资料**（课文段落、生字表、词汇表、照片等）导入 App，转成结构化学习数据（生字/词语/句子/文章/题目），自动合并进现有练习（认字、默写、词语练习）。**核心价值：用户自己的内容，不用等内置词库。**

## 二、核心设计：LLM 费用外移 💰

这是整个模块最重要的架构决策（为什么这么设计节省 LLM 调用费用）：

```
传统做法（贵）：   App → 服务端 LLM 解析 → 返回结构化数据（每次导入都花服务端预算）
本模块做法（零成本）：
  App 生成提示词 → 用户复制 → 用户自己的 LLM（免费/自费）→ 粘贴结果回 App
  → App 本地规则加工（纯解析/校验/去重/规范化，零 LLM 调用）→ 确认 → 保存
```

- **Why**：导入是低频操作，不值得养服务端付费 LLM 链路；服务端 `/api/v1/llm/chat` 有日预算守卫（5 元/天），绕开即可零成本
- **原则**（已沉淀为项目规范）：新功能优先问"能否外移 LLM 成本"；加工层必须纯本地规则，不调 LLM

## 三、四阶段使用流程（ImportScreen 单页四阶段）

```
SELECT（选模板） → PROMPT（填槽位/复制提示词） → CONFIRM（确认） → DONE（完成）
```

| 阶段 | 功能 |
|---|---|
| **SELECT** | 展示 6 个模板卡片（文本→词汇表 / 文本→文章 / 文本→句子 / 图片→题目 / 图片→文章 / 图片→答案） |
| **PROMPT** | ① 填槽位（年级/语言/模式等下拉）② 文本类粘贴原文 ③ 一键复制生成好的提示词 ④ **图片类默认弹"⚠️ 敏感图片勿发"提示**（`privacyNotice` 服务端下发）⑤ 粘贴 LLM 返回结果 |
| **CONFIRM** | 本地解析结果预览：每条显示 text/拼音/释义/标签，标注 `NEW`（新增）/`DUPLICATE`（重复）/`INVALID`（无效及原因），可勾选 → "保存导入" / "放弃" |
| **DONE** | 完成页；返回键/顶部返回退出 |

**返回键行为**：PROMPT/CONFIRM 阶段按系统返回键 → 回 SELECT，不直接退首页；SELECT/DONE 阶段返回 → 退出（`BackHandler` 拦截，2026-08 修复）。

## 四、模板体系（服务端下发）

**文件**：`server_py/data/import_templates.json`（6 个模板，约 7.7KB）
**结构**：`{id, group, inputType, contentType, name, description, params[槽位], promptTemplate, privacyNotice, version}`

| 模板 id | 输入 | 产出 | 槽位 |
|---|---|---|---|
| `text_to_vocab` | 文本粘贴 | 词汇表（char/word）| 语言、年级、提取模式（提取/补全）|
| `text_to_article` | 文本粘贴 | 文章 | 年级、科目 |
| `text_to_sentence` | 文本粘贴 | 句子/句型 | 年级、语言 |
| `image_to_quiz` | 图片拍照 | 题目 | 年级、科目、题数 |
| `image_to_article` | 图片拍照 | 文章 | 年级 |
| `image_to_answer` | 图片拍照 | 答案+批改 | 年级、科目 |

**模板分类体系（两维，P1/P2 未做）**：输入形态 `text/image/data` × 内容类型 `A1词汇/A2文章/A3题目/A5句子/B1~B3图片类/C1出题/D1生图prompt/E1作文`。模板→解析器按 `contentType` 分组复用（B 组与对应 A 组共用解析器）。

## 五、本地加工层（ImportProcessor — 纯本地规则）

**文件**：`app/src/main/java/com/example/ai/data/userimport/ImportProcessor.kt`（约 14.8KB，**零 LLM 调用**）

- `generatePrompt()`：替换 `{{grade}}` / `{{mode_note}}`（补全模式注入）/ `{{input_text}}` 占位符
- `parseJsonArray/Object()`：容错解析——容忍 markdown 代码块、前后说明文字、宽松 JSON
- `buildCandidates()`：按 `contentType` 分派 5 个解析器（词汇/文章/句子/题目/答案）
- `normalizePinyin()`：声调符号转数字并追加音节末尾（`yī→yi1`、`xiǎng→xiang3`、`lǜ→lv4`）
- `normalizeTags()`：原 tags 非空保留，仅空时补默认年级
- 校验：缺字段标 `INVALID`，与已有数据同 kind+text 标 `DUPLICATE`

## 六、数据模型与存储

**本地模型** `UserImportItem`：
```
{id, kind(word|char|article|sentence|quiz|answer), text, pinyin, meaning,
 tags[], payload(JSON字符串), status(active), createdAt}
```

**客户端存储** `UserImportStore`：`files/user_imports.json`（**刻意不用 Room**——项目 `AppDatabase.kt` 明确注释避免 Room 依赖、APK 大小敏感，同 QuizRepository 缓存先例；家庭量级几百条足够）。API：`load() / upsertAll()（按 kind+text 去重）/ remove(id)`，内存缓存。

**服务端存储** `user_imports` 表：`id, user_id(FK), kind, text, pinyin, meaning, tags(JSON), payload(JSON), status, created_at`。

## 七、服务端 API（server_py/）

| 端点 | 说明 |
|---|---|
| `GET /api/v1/import-templates?id=` | 模板下发（**按需拉取单模板**，L2 防静态逆向） |
| `POST /api/v1/user-imports/batch` | 批量 upsert（按 user+kind+text） |
| `GET /api/v1/user-imports?kind=` | 按用户拉取 |
| `DELETE /api/v1/user-imports/{id}` | 删除 |

**安全**：`user_id` 一律从 JWT `get_current_user` 取，绝不信任客户端传值；401 时全局拦截器自动 refresh token 重放，access 过期无感续期（`NetworkModule.AuthInterceptor`，2026-08 实现）。

## 八、消费端合并（练习页可见用户数据）

**文件**：`app/src/main/java/com/example/ai/data/wordbank/UserImportMerge.kt`（纯函数 `mergeUserEntries`）+ `WordBankRepository` 注入 `UserImportStore`

| 导入 kind | 合并到 | 规则 |
|---|---|---|
| `char` | 认字 + 默写练习 | 自动补 `["识字","写字"]` 标签 |
| `word` | 词语练习 | 自动补 `["词语"]` 标签 |
| — | — | 与内置同 type 同 text **去重**；非 `active` 跳过；用户条目内部去重 |

`queryChars / queryWords / queryByGrade / getTagStats / search` 全部合并（`load()` 有内存缓存，开销可忽略）。

## 九、"我的导入"管理页

首页 → **📋 我的导入**（`MyImportsScreen`）：按类型分组展示全部导入内容（生字/词语/句子/文章/题目/答案），显示拼音/释义/标签/导入时间，支持 🗑️ 删除，空态引导去导入。

## 十、相关基础设施（2026-08 全局加固）

- **快速失败超时**：`NetworkModule` connect 全局 30s→5s（write 30s→15s，read 120s 保留给 LLM 长生成）；sherpa `OpenAIProvider` connect 15s→5s；账户页/反馈页本已 4s/6s。连不上服务器 5 秒内报错。
- **401 自动刷新**：全局拦截器收到 401 → 用 refresh token（30 天）换新 access（2 小时）→ 重放一次；`@Synchronized` 并发单飞 + 独立纯净 client 防递归 + 排除 `/api/v1/auth/` 路径防死循环。覆盖全部 13 个使用 `NetworkModule.httpClient` 的调用方。

## 十一、测试与构建

- `ImportProcessorTest` 15 个 + `UserImportMergeTest` 9 个，项目共 **68 单测全绿**
- 构建：`gradlew :app:assembleDebug`；服务端语法校验：`python -m py_compile`

## 十二、安全设计（提示词防泄露）

1. **L1**：模板零打包进 APK（只存服务端）
2. **L2**：按需拉取单模板（已实现）
3. **L3**：AES-GCM 下发加密（**未做**，后续加固项）
4. 结论：对终端用户无法加密（提示词必须明文复制），只能防静态逆向批量提取；护城河 = 提示词 + schema + 本地解析器耦合

## 十三、遗留 TODO

- article/sentence/quiz 消费端未接（文章→口述作文素材、句子→句子练习、题目→考试素材）
- 同步失败手动重试入口缺失
- L3 加密加固
- 导入页 `LocalClipboardManager` deprecated 警告待迁移
- 现有 `upload_records` 表无 `user_id` 字段；词库/练习 JSON 均无用户隔离
