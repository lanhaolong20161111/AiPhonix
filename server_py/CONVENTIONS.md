# AiPhonix 服务端代码规范（server_py）

> 供人类与 AI 代码生成器共同遵守。新增/修改代码必须符合本规范，mypy 检查通过是硬性要求。

## 类型检查

```bash
python -m mypy .          # 必须 0 错误（当前 48 源文件全绿）
```

配置：`pyproject.toml`（check_untyped_defs + pydantic/sqlalchemy plugin + warn_unused_ignores）。
新增第三方库若缺 stubs，优先装 `types-*` 包；确实没有的才依赖 `ignore_missing_imports`。

## 端点定义

- **所有端点必须声明 `response_model`**（输出契约与客户端 kotlinx.serialization 逐字段一致；字段名/类型改动 = 客户端不兼容，需两端同步）
- 请求体用 Pydantic `BaseModel`，字段加约束：`Field(min_length=..., max_length=..., ge=..., le=...)`、枚举用 `Literal[...]`
- 禁止返回裸 dict（新增字段/改字段名时 mypy 无法发现客户端断裂）
- query 参数 `limit` 必须带上界（`Query(default=100, ge=1, le=1000)`）

## 数据模型

- **JSON 数据文件加载必须过 pydantic 模型**：`Model.model_validate(...)` 而非 `json.load` → `**dict` 展开（2026-08-07 的 203 词全丢事故根因）
- 未知字段用 `extra="ignore"`（兼容新旧格式并存是常态）；历史脏数据（如 `null` 值）用 `model_validator(mode='before')` 归一默认值，**不要因个别坏数据崩整个加载**
- LLM 自由 JSON 输出：定义 `BaseModel` 用 `model_validate_json` 解析，`ValidationError` 时**降级**（默认值/空列表 + warning 日志），禁止 500 或静默吞异常
- SQLAlchemy 字段类型必须与列约束一致：`nullable=True` 的列写 `Mapped[int | None]`（sqlalchemy mypy plugin 对赋值目标按注解校验）

## 全局变量与初始化

- 模块级 `cfg`/`svc`/`handler` 用 `Optional[X] = None` + `init()` 注入；使用前 `assert` 非 None
- 禁止新增 `# type: ignore`（现有 4 处为历史遗留，warn_unused_ignores 已开启保证无冗余）

## 异常处理

- 禁止 `except Exception: pass`（吞异常 = 静默失败，2026-08-07 事故教训）
- 预算守卫 `BudgetExceededError` 向上传播（main.py 全局 429 handler）
- 外部服务失败抛 `HTTPException(502/503)`，**不要把原始异常字符串拼进 detail 暴露给客户端**

## 业务约定

- `type_` 是路由参数名（`type` 会遮蔽内置，仅 wordbank query 历史遗留）
- 响应字段与客户端契约逐字段一致；改动契约前先查 `app/src/main/java/com/example/ai/data/` 对应 Repository
