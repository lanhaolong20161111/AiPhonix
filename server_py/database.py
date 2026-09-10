"""数据库模块 — SQLAlchemy 异步引擎 + 模型"""
import os
from collections.abc import AsyncIterator
from datetime import datetime
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Integer, Float, Text, Boolean, DateTime, func, select, text, UniqueConstraint

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
    source: Mapped[str] = mapped_column(String(255), default="")  # 来源字卡/词（取自评测上下文 char），用于历史跳转定位
    engine: Mapped[str] = mapped_column(String(32), default="")  # 16k_zh / 16k_en
    total_accuracy: Mapped[float] = mapped_column(Float, default=0.0)
    total_fluency: Mapped[float] = mapped_column(Float, default=0.0)
    total_completion: Mapped[float] = mapped_column(Float, default=0.0)
    suggested_score: Mapped[float] = mapped_column(Float, default=0.0)
    details: Mapped[str] = mapped_column(Text, default="")  # JSON: units 明细
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


# ── 学生画像表（跨会话长期记忆，按 user_id + module 一条）──
class StudentProfile(Base):
    """AI 语数英多轮对话的学生画像：记录会话次数、最近主题、常错点、已掌握主题。
    按 (user_id, module) 唯一，每次对话后 upsert 更新，供下次注入 prompt 个性化。"""

    __tablename__ = "student_profiles"
    __table_args__ = (UniqueConstraint("user_id", "module", name="uq_student_profile_user_module"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    module: Mapped[str] = mapped_column(String(16), default="chinese")  # chinese / math / english
    session_count: Mapped[int] = mapped_column(Integer, default=0)
    last_content: Mapped[str] = mapped_column(Text, default="")  # 最近讨论主题
    mistakes: Mapped[str] = mapped_column(Text, default="[]")  # JSON 数组：常错点
    mastered: Mapped[str] = mapped_column(Text, default="[]")  # JSON 数组：已掌握主题
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── AI 语数英对话会话表（后端口径状态，断点续聊） ──
class AiChatSession(Base):
    """一次语数英对话会话：messages 存对话历史（JSON 数组 [{role, content}]）。
    前端保留 session_id（localStorage），续聊时带回来即可断点续聊。"""

    __tablename__ = "ai_chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    module: Mapped[str] = mapped_column(String(16), default="chinese")
    messages: Mapped[str] = mapped_column(Text, default="[]")  # JSON 数组
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


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
    correct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
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


# ── 认读画像：字被点击发音次数（点击越多 → 越不会认读） ──
class CharClickRow(Base):
    """逐字点读统计：按 (user_id, char) 累加点击次数，用于刻画学生认读画像。"""

    __tablename__ = "char_click_stats"
    __table_args__ = (
        UniqueConstraint("user_id", "char", name="uq_char_click_user_char"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    char: Mapped[str] = mapped_column(String(8), nullable=False)  # 单个汉字
    click_count: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── 生字标记：学生主动标记"不会认的字"（区别于点击画像，是显式标记） ──
class CharUnknownMarkRow(Base):
    """学生标记的不会认的生字：按 (user_id, char) 幂等，可重复标记（updated_at 刷新）。"""

    __tablename__ = "char_unknown_marks"
    __table_args__ = (
        UniqueConstraint("user_id", "char", name="uq_char_unknown_user_char"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    char: Mapped[str] = mapped_column(String(8), nullable=False)  # 单个汉字
    lesson: Mapped[str] = mapped_column(String(64), default="")  # 所属课文/块来源（可选）
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── 闯关会话：大模型现场生成分步引导计划（引导完全由 LLM 读题发挥） ──
class QuestSessionRow(Base):
    """一次闯关：LLM 现场生成的分步计划 + 学生作答进度。

    plan_json: LLM 生成的步骤列表（问题/选项/答案/讲解/概念解释）
    history_json: 学生每步作答记录（供答错时 LLM 生成针对性引导）
    """

    __tablename__ = "quest_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, default="")
    plan_json: Mapped[str] = mapped_column(Text, default="")
    history_json: Mapped[str] = mapped_column(Text, default="")
    step_index: Mapped[int] = mapped_column(Integer, default=0)  # 当前步骤下标
    sub_json: Mapped[str] = mapped_column(Text, default="")  # 答错降解出的简化子问题（含答案）
    sub_level: Mapped[int] = mapped_column(Integer, default=0)  # 降解级数（越大越简单）
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | done
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── 语文单元知识库：扫描的练习/知识清单/写作指导/学习任务，按单元·课文·类型归档 ──
class ChineseUnitKnowledgeRow(Base):
    """一张语文练习/知识页的结构化归档：供客户端与 LLM 按单元/课文/类型索引查询。"""

    __tablename__ = "chinese_unit_knowledge"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    unit: Mapped[str] = mapped_column(String(32), default="", index=True)  # 如 第一单元
    lesson: Mapped[str] = mapped_column(String(64), default="", index=True)  # 课文，如 《大青树下的小学》
    category: Mapped[str] = mapped_column(String(32), default="", index=True)  # 单元知识清单/写作指导/单元学习任务/课文作业
    page: Mapped[str] = mapped_column(String(16), default="")  # 页码
    content: Mapped[str] = mapped_column(Text, default="")  # 识别原文
    knowledge_points: Mapped[str] = mapped_column(Text, default="")  # JSON 知识点列表
    question_types: Mapped[str] = mapped_column(Text, default="")  # JSON 题型列表（考题方式）
    image_path: Mapped[str] = mapped_column(String(256), default="")  # 对应原图路径
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 语文阅读理解题索引：从练习页提取的阅读题（短文+题目+题型+参考答案） ──
class ChineseReadingItemRow(Base):
    """阅读理解题目结构化索引：供客户端/LLM 按单元·课文·题型查询出题。"""

    __tablename__ = "chinese_reading_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    unit: Mapped[str] = mapped_column(String(32), default="", index=True)
    lesson: Mapped[str] = mapped_column(String(64), default="", index=True)
    category: Mapped[str] = mapped_column(String(32), default="")
    page: Mapped[str] = mapped_column(String(16), default="")
    passage: Mapped[str] = mapped_column(Text, default="")  # 短文原文（无则空）
    question: Mapped[str] = mapped_column(Text, default="")  # 题目文本（含小题）
    question_type: Mapped[str] = mapped_column(String(32), default="", index=True)  # 概括主要内容/理解词句/修辞手法/信息提取/字词理解/拓展运用
    answer: Mapped[str] = mapped_column(Text, default="")  # 参考答案（LLM 生成，供讲解）
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 语文题目索引：练习页逐题提取(scanned) + LLM 相似生成(generated) ──
class ChineseQuestionItemRow(Base):
    """语文考题索引：真实题（从练习页提取）与 LLM 相似生成题，按类别·单元·课文查询。"""

    __tablename__ = "chinese_question_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(32), default="", index=True)  # 字音/字词书写/词语运用/句子/积累背诵/阅读理解/写作表达/单元任务/综合
    question: Mapped[str] = mapped_column(Text, default="")  # 题目原文
    answer: Mapped[str] = mapped_column(Text, default="")  # 答案/参考答案
    unit: Mapped[str] = mapped_column(String(32), default="", index=True)
    lesson: Mapped[str] = mapped_column(String(64), default="", index=True)
    page: Mapped[str] = mapped_column(String(16), default="")
    source: Mapped[str] = mapped_column(String(16), default="scanned", index=True)  # scanned / generated
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 语文背诵索引：日积月累/读读背背的古诗、名言警句 ──
class ChineseRecitationItemRow(Base):
    """背诵内容索引（日积月累/读读背背）：古诗、名言警句，按单元·类型·出处查询。

    kind: poem(古诗) / saying(名言警句)
    """

    __tablename__ = "chinese_recitation_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    unit: Mapped[str] = mapped_column(String(32), default="", index=True)
    title: Mapped[str] = mapped_column(String(64), default="", index=True)  # 篇名（如《所见》）
    author: Mapped[str] = mapped_column(String(32), default="")  # 作者（清·袁枚）
    kind: Mapped[str] = mapped_column(String(16), default="poem", index=True)  # poem / saying
    content: Mapped[str] = mapped_column(Text, default="")  # 全文
    source_ref: Mapped[str] = mapped_column(String(64), default="")  # 出处（如《论语》）
    page: Mapped[str] = mapped_column(String(16), default="")
    image_path: Mapped[str] = mapped_column(String(256), default="")  # 来源原图
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 作文知识库：三年级同步作文（范文+讲解）索引 ──
class ChineseEssayKnowledgeRow(Base):
    """同步作文知识页：题目/单元/要求/指导要点/习作目标，供练习作文时查询参考。"""

    __tablename__ = "chinese_essay_knowledge"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    unit: Mapped[str] = mapped_column(String(32), default="", index=True)
    title: Mapped[str] = mapped_column(String(64), default="", index=True)  # 作文题目
    topic: Mapped[str] = mapped_column(String(128), default="")  # 写作对象/主题
    requirement: Mapped[str] = mapped_column(Text, default="")  # 习作要求原文
    guide: Mapped[str] = mapped_column(Text, default="")  # 讲解/指导要点（JSON 列表）
    goals: Mapped[str] = mapped_column(Text, default="")  # 习作目标（JSON 列表）
    page: Mapped[str] = mapped_column(String(16), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # 识别原文
    model_essay: Mapped[str] = mapped_column(Text, default="")  # 范文正文
    good_words: Mapped[str] = mapped_column(Text, default="")  # 好词好句（JSON 列表）
    image_path: Mapped[str] = mapped_column(String(256), default="")  # 对应原图路径
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 语文课本页索引：三年级上册课本逐页（含元信息：页码/单元/课文/页面类型） ──
class ChineseTextbookPageRow(Base):
    """语文课本逐页：页码/单元/课文/页面类型/全文，供按页码、单元、课文索引。"""

    __tablename__ = "chinese_textbook_pages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    page: Mapped[str] = mapped_column(String(16), default="", index=True)  # 课本页码
    unit: Mapped[str] = mapped_column(String(32), default="", index=True)
    lesson: Mapped[str] = mapped_column(String(64), default="", index=True)  # 课文标题
    page_type: Mapped[str] = mapped_column(String(32), default="", index=True)  # 课文正文/生字表/词语表/语文园地/口语交际/习作/单元页/目录/课后练习/其他
    content: Mapped[str] = mapped_column(Text, default="")  # 页面全文
    knowledge_points: Mapped[str] = mapped_column(Text, default="")  # 知识点（JSON 列表，可选）
    image_path: Mapped[str] = mapped_column(String(256), default="")  # 对应原图路径（来源链：记录→图片）
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── LLM-Wiki 知识词条：可链接、可编辑、随问答进化的专属学习百科 ──
class WikiPageRow(Base):
    """一条 Wiki 词条：标题/类型/正文(markdown)/来源/关联链接。

    page_type: concept(概念/知识点) / lesson(课文知识) / essay(作文) / example(例题) / mistake(错题)
    source_ref: 来源引用（如"课本页5-6/题id/作文id"，JSON 或文本）
    links: 关联词条 id 列表（JSON），概念↔例题↔错题 双向链接
    """

    __tablename__ = "wiki_pages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(128), default="", index=True)
    page_type: Mapped[str] = mapped_column(String(16), default="concept", index=True)
    content: Mapped[str] = mapped_column(Text, default="")  # markdown 正文
    unit: Mapped[str] = mapped_column(String(32), default="", index=True)
    lesson: Mapped[str] = mapped_column(String(64), default="", index=True)
    source_ref: Mapped[str] = mapped_column(Text, default="")  # 来源引用
    links: Mapped[str] = mapped_column(Text, default="")  # 关联词条 id 列表 JSON
    status: Mapped[str] = mapped_column(String(16), default="active")  # active / draft
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── 知识关系：typed 关系（wiki 词条之间） ──
class KnowledgeRelationRow(Base):
    """知识图谱关系边：from_id -relation-> to_id（均为 wiki_pages.id）。

    relation 取值：covers(课文涵盖知识点) / part_of(属于) / related(相关) / used_with(搭配) /
                   calculated_by(由...算出) / tests(考查) / example_of(示例)
    """

    __tablename__ = "knowledge_relations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    from_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    relation: Mapped[str] = mapped_column(String(24), default="related", index=True)
    to_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── 数据库初始化 ──
async def init_db():
    """创建所有表（如不存在）+ 轻量列迁移（SQLite ALTER TABLE 幂等）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # FTS5 全文索引（trigram 分词，支持中文子串搜索）；src_type/src_id 标记来源
        await conn.execute(text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chinese_fts USING fts5(content, src_type UNINDEXED, src_id UNINDEXED, tokenize='trigram')"
        ))
        # quest_sessions.sub_json / sub_level：旧库无此列时补列（列已存在会抛错，忽略即可）
        try:
            await conn.execute(text("ALTER TABLE quest_sessions ADD COLUMN sub_json TEXT DEFAULT ''"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE quest_sessions ADD COLUMN sub_level INTEGER DEFAULT 0"))
        except Exception:
            pass
        # chinese_essay_knowledge.model_essay / good_words：旧库补列
        try:
            await conn.execute(text("ALTER TABLE chinese_essay_knowledge ADD COLUMN model_essay TEXT DEFAULT ''"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE chinese_essay_knowledge ADD COLUMN good_words TEXT DEFAULT ''"))
        except Exception:
            pass
        # 来源链：三张语文表补 image_path（记录→原图）
        try:
            await conn.execute(text("ALTER TABLE chinese_textbook_pages ADD COLUMN image_path TEXT DEFAULT ''"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE chinese_unit_knowledge ADD COLUMN image_path TEXT DEFAULT ''"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE chinese_essay_knowledge ADD COLUMN image_path TEXT DEFAULT ''"))
        except Exception:
            pass


async def get_session() -> AsyncIterator[AsyncSession]:
    """获取数据库会话（用于依赖注入）"""
    async with async_session() as session:
        yield session
