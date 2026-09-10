# AiPhonix 项目记忆

> 最后更新：2026-08-20（胖路由拆分第二步 — 清理与验证完成）

## 胖路由拆分进度

### ✅ 已完成
| 步骤 | 文件 | 状态 |
|---|---|---|
| 方案 3 `utils/ai_text_utils.py` | ✅ 新建，16 个文本处理函数完整搬运 | 已验证正确 |
| `routes/ai_chinese.py` import | ✅ 16 个 `as _原名` 导入，原函数改名 `_xxx_MOVED` 后已清理 | ✅ 已完成 |
| `routes/ai_homework.py` import | ✅ 导入 `split_sentences`（语文版，独立于数学版），`_MOVED` 已清理 | ✅ 已完成 |
| `scripts/cleanup_moved_functions.py` | ✅ 新建，AST 精确定位删除 `_MOVED` 函数 | 已执行 |
| **死代码清理** | `ai_chinese.py` 0 个（已提前清理），`ai_homework.py` 删除 1 个 `_split_sentences_MOVED` | ✅ 2026-08-20 |
| **语法验证** | `py_compile routes/ai_chinese.py routes/ai_homework.py utils/ai_text_utils.py` | ✅ 零错误通过 |

### 📋 验证结果
- `cleanup_moved_functions.py` 执行成功
  - `ai_chinese.py`：0 个 `_MOVED` 函数（上一轮已清理）
  - `ai_homework.py`：删除 `_split_sentences_MOVED`（1 个）
- `python -m py_compile` 三个文件：**全部通过，零语法错误**

### ❌ 不可行 / 已放弃
| 方案 | 原因 |
|---|---|
| 方案 4 `utils/ai_pinyin_utils.py` | 拼音函数依赖 8 个模块级常量 + `PinyinPart`，工程量大 |
| 方案 5 `utils/ai_homework_utils.py` | `_parse_blocks`/`_parse` 是嵌套局部函数，非模块级 |

### 待验证
- **功能验证**：手机访问 AI 语文/数学拍照识题，确认识别→排版→评测链路正常（需服务端运行状态）

## 代码规范
- `CONVENTIONS.md` — 服务端代码规范（类型检查、端点定义、数据模型、异常处理等）
- 必须通过 `python -m mypy .` 零错误

## 关键约束
- `ai_homework` 的 `_clean_ocr_text` / `_split_questions` 是数学版（多了 LaTeX/markdown/HTML 清理），与语文版不同，**不抽不共享**
- `_unit_key` 是 `chinese_outline` 内的**局部函数**，不抽
- 原函数定义改名为 `_MOVED`（而非直接删除），因为 str_replace 多行匹配在 Windows `\r\n` 文件上失效

## 待办事项
- [x] 清理 `_MOVED` 死代码
- [x] 语法验证（`py_compile` 零错误）
- [ ] 功能验证：手机访问 AI 语文/数学拍照识题，确认识别→排版→评测链路正常（需服务端运行）
- [ ] 方案 4/5 可行性重新评估（若日后拼音模块稳定）
- [ ] 新增工具函数时优先放 `utils/` 对应模块