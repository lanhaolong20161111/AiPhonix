"""数据库模块 — SQLAlchemy 异步引擎 + 模型"""
import os
from datetime import datetime
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Integer, Float, Text, Boolean, DateTime, func, select, UniqueConstraint

# ── 数据库连接 ──
# 环境变量 DATABASE_URL 优先，否则使用 SQLite 本地文件
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./data/app.db"
)

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# ── 用户表 ──
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    nickname: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="student")  # student | parent | teacher | admin
    grade: Mapped[str] = mapped_column(String(16), default="")
    age: Mapped[int] = mapped_column(Integer, default=0)
    learning_level: Mapped[str] = mapped_column(String(16), default="")  # beginner | intermediate | advanced
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── Refresh Token 表 ──
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    device_info: Mapped[str] = mapped_column(String(256), default="")
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 作文表 ──
class Essay(Base):
    __tablename__ = "essays"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    topic: Mapped[str] = mapped_column(String(256), default="")
    audio_url: Mapped[str] = mapped_column(String(512), default="")
    text_original: Mapped[str] = mapped_column(Text, default="")
    text_ai_modified: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float] = mapped_column(Float, default=0.0)
    feedback: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 语音评测记录表 ──
class SpeechEvalRecord(Base):
    """一次语音评测的完整明细快照，供 AI 优化学习方案。

    details 为 JSON 数组（存于 Text 列），结构：
    [{ "unit": "猫|cat", "score": 92.0, "match_tag": 0, "tone": {"ref": 1, "hyp": 1} | null,
       "phones": [{"phone": "m", "reference_phone": "m", "score": 95.0, "match_tag": 0}] }]
    - 中文（zh）：unit = 字或拼音；tone 为声调（ref 正确/hyp 读出）
    - 英文（en）：unit = 单词；phones 为音素
    """

    __tablename__ = "speech_eval_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, default=0, index=True)  # 0 = 未登录评测
    language: Mapped[str] = mapped_column(String(8), default="en", index=True)  # zh / en
    eval_type: Mapped[str] = mapped_column(String(16), default="word", index=True)  # word / sentence
    ref_text: Mapped[str] = mapped_column(Text, default="")
    engine: Mapped[str] = mapped_column(String(32), default="")  # 16k_zh / 16k_en
    total_accuracy: Mapped[float] = mapped_column(Float, default=0.0)
    total_fluency: Mapped[float] = mapped_column(Float, default=0.0)
    total_completion: Mapped[float] = mapped_column(Float, default=0.0)
    suggested_score: Mapped[float] = mapped_column(Float, default=0.0)
    details: Mapped[str] = mapped_column(Text, default="")  # JSON: units 明细
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


# ── 上传记录表（移动端采集：图片/文本）──
class UploadRecord(Base):
    """移动端网页上传的图片或文本，供后续练习内容使用。

    - 图片：file_name 存 data/uploads/{file_name}，ocr_text 为 EasyOCR 识别结果（备用）
    - 文本：ocr_text 即上传文本本身（content 为空）
    """

    __tablename__ = "upload_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(8), default="photo")  # photo / text
    file_name: Mapped[str] = mapped_column(String(256), default="")  # 图片文件名（photo 用）
    content: Mapped[str] = mapped_column(Text, default="")  # 文本内容（text 用）
    ocr_text: Mapped[str] = mapped_column(Text, default="")  # OCR 识别结果（photo 时备用）
    note: Mapped[str] = mapped_column(String(512), default="")  # 自由备注
    source: Mapped[str] = mapped_column(String(16), default="web", index=True)  # 渠道：web / app / manual
    uploader: Mapped[str] = mapped_column(String(64), default="")  # 上传者：用户或设备标识
    origin: Mapped[str] = mapped_column(String(256), default="")  # 出处：如"二年级语文上册 P23"
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


# ── 用户导入表（App 内"复制提示词 → 用户 LLM → 粘贴回 App"导入的数据）──
class UserImport(Base):
    """用户通过导入管道录入的学习数据（词汇/字/文章/句子/题目/答案）。

    客户端本地加工（ImportProcessor）后先存本地，再同步到此表（按用户隔离）。
    - kind：word / char / article / sentence / quiz / answer
    - tags：JSON 数组字符串，如 ["二年级上","识字"]
    - payload：JSON 字符串，article 存 {title, content, paragraphs}，quiz 存题目明细
    - 同一 user_id + kind + text 视为同一条目（批量上传时 upsert）
    """

    __tablename__ = "user_imports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), default="word", index=True)  # word/char/article/sentence/quiz/answer
    text: Mapped[str] = mapped_column(String(256), default="", index=True)
    pinyin: Mapped[str] = mapped_column(String(128), default="")
    meaning: Mapped[str] = mapped_column(String(512), default="")
    tags: Mapped[str] = mapped_column(String(256), default="")  # JSON 数组字符串
    payload: Mapped[str] = mapped_column(Text, default="")  # JSON 扩展（文章正文/题目明细）
    status: Mapped[str] = mapped_column(String(16), default="active")  # active / deleted
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── 训练任务配置表（方向 3：家长配置服务端下发）──
class TrainingPlanRow(Base):
    """家长配置的训练任务包，按用户一份（跨设备同步）。

    items_json 为客户端 TrainingPlan JSON 全量透传（含 items/lastResult），
    服务端不解析细节，与导入模块"元信息透传"先例一致。
    """

    __tablename__ = "training_plans"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(64), default="今日任务")
    items_json: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── 每日完成度记录表（方向 2：真实完成度回传）──
class PracticeSessionRow(Base):
    """每任务每日一条真实完成度（upsert by user_id + plan_item_id + date）。

    - correct/score 可空（无对错/评分概念的页面只报 count/duration）
    - metrics_json 透传客户端 PlanResult 全量
    """

    __tablename__ = "practice_sessions"
    __table_args__ = (
        # 同一任务同一天多次上报 → 覆盖
        UniqueConstraint("user_id", "plan_item_id", "date", name="uq_practice_session_user_item_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    plan_item_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    feature: Mapped[str] = mapped_column(String(32), default="", index=True)
    date: Mapped[str] = mapped_column(String(10), default="", index=True)  # YYYY-MM-DD
    status: Mapped[str] = mapped_column(String(16), default="done")  # done
    count: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, nullable=True)
    score: Mapped[float] = mapped_column(Float, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    metrics_json: Mapped[str] = mapped_column(Text, default="")  # PlanResult JSON 透传
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── ai陪我练：会话表 ──
class AiPracticeSessionRow(Base):
    """ai陪我练会话：一个导入主题（字/词/句/文章）一次多轮练习。

    - plan_json：LangGraph planner 生成的引导计划（步骤+目标）
    - status: active | done
    """

    __tablename__ = "ai_practice_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(16), default="sentence")  # char|word|sentence|article
    content: Mapped[str] = mapped_column(Text, default="")  # 导入的主题文本
    task: Mapped[str] = mapped_column(String(32), default="")  # 任务类型：认读/造句/问答/翻译/考题
    plan_json: Mapped[str] = mapped_column(Text, default="")  # LangGraph planner 输出
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── ai陪我练：对话轮次表 ──
class AiPracticeTurnRow(Base):
    """ai陪我练单条对话：学生回答 或 AI 回复（含纠正/表扬）。"""

    __tablename__ = "ai_practice_turns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(8), default="ai")  # ai | user
    text: Mapped[str] = mapped_column(Text, default="")
    correction: Mapped[str] = mapped_column(Text, default="")  # 学生回答的纠正（空=无需纠正）
    praise: Mapped[str] = mapped_column(Text, default="")  # 表扬语（纠正为空时）
    audio_path: Mapped[str] = mapped_column(String(256), default="")  # 学生录音保存路径
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 数据库初始化 ──
async def init_db():
    """创建所有表（如不存在）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    """获取数据库会话（用于依赖注入）"""
    async with async_session() as session:
        yield session
