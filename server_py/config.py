"""配置加载 — 从 config.yaml 和环境变量读取

类型由 pydantic 校验：yaml 缺字段用默认值、类型不符启动即报错，
不再有"手工搬运漏字段 → 静默用默认值"的路径。
"""

import os

import yaml
from pydantic import BaseModel, Field


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080  # uvicorn 需要 int；yaml 中写 int 8080


class DeepSeekConfig(BaseModel):
    api_key: str = ""
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-v4-flash"
    # 预算守卫（元 / 字符）
    max_cost_per_call: float = 0.5      # 单次调用费用上限（调用前按最坏情况预估拒绝）
    max_cost_per_day: float = 5.0       # 每日累计费用上限（超限拒绝当日后续调用）
    max_input_chars: int = 20000        # 输入提示词字符数硬上限


class BaiduTTSConfig(BaseModel):
    app_id: str = ""
    api_key: str = ""
    secret_key: str = ""
    cache_dir: str = "cache/tts"


class TencentConfig(BaseModel):
    app_id: str = ""
    secret_id: str = ""
    secret_key: str = ""


class LLMPromptsConfig(BaseModel):
    english_teaching: str = ""
    chinese_teaching: str = ""
    quiz_generate: str = ""
    word_suggestions: str = ""
    sentence_making: str = ""
    default: str = ""


class ArkImageConfig(BaseModel):
    api_key: str = ""
    model: str = "doubao-image-pro-32k"
    endpoint: str = "https://open.volcengineapi.com"


class ArkChatConfig(BaseModel):
    """火山引擎送 token 的免费 LLM（多模态：文本 + 图片）"""
    api_key: str = ""
    model: str = "deepseek-v4-flash-ga-260731"  # 文本分析默认（快稳定）；识图用 MULTIMODAL_MODEL 覆盖


class PPStructureConfig(BaseModel):
    """PaddleOCR AI Studio PP-StructureV3 外部 API（官方 jobs 接口）"""
    token: str = ""
    job_url: str = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
    model: str = "PP-StructureV3"
    poll_interval: float = 5.0  # 轮询间隔（秒）
    max_wait: float = 180.0     # 最长等待结果（秒）
    timeout: float = 30.0       # 单次 HTTP 超时（秒）


class Config(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    deepseek: DeepSeekConfig = Field(default_factory=DeepSeekConfig)
    baidu_tts: BaiduTTSConfig = Field(default_factory=BaiduTTSConfig)
    tencent: TencentConfig = Field(default_factory=TencentConfig)
    llm_prompts: LLMPromptsConfig = Field(default_factory=LLMPromptsConfig)
    ark_image: ArkImageConfig = Field(default_factory=ArkImageConfig)
    ark_chat: ArkChatConfig = Field(default_factory=ArkChatConfig)
    pp_structure: PPStructureConfig = Field(default_factory=PPStructureConfig)


def load_config(path: str = "config.yaml") -> Config:
    """加载配置，环境变量优先"""
    raw: dict = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

    # 兼容旧结构：deepseek.budget 子段提升为平铺字段
    if isinstance(raw.get("deepseek"), dict):
        raw["deepseek"] = {**raw["deepseek"], **raw["deepseek"].get("budget", {})}

    # 一次性校验（缺字段用默认值，未知字段忽略，类型不符抛 ValidationError）
    cfg = Config.model_validate(raw)

    # 环境变量覆盖（所有密钥支持从环境变量读取，容器化部署用）
    if v := os.environ.get("DEEPSEEK_API_KEY"):
        cfg.deepseek.api_key = v
    if v := os.environ.get("DEEPSEEK_BASE_URL"):
        cfg.deepseek.base_url = v
    if v := os.environ.get("DEEPSEEK_MODEL"):
        cfg.deepseek.model = v

    if v := os.environ.get("BAIDU_TTS_APP_ID"):
        cfg.baidu_tts.app_id = v
    if v := os.environ.get("BAIDU_TTS_API_KEY"):
        cfg.baidu_tts.api_key = v
    if v := os.environ.get("BAIDU_TTS_SECRET_KEY"):
        cfg.baidu_tts.secret_key = v

    if v := os.environ.get("TENCENT_APP_ID"):
        cfg.tencent.app_id = v
    if v := os.environ.get("TENCENT_SECRET_ID"):
        cfg.tencent.secret_id = v
    if v := os.environ.get("TENCENT_SECRET_KEY"):
        cfg.tencent.secret_key = v

    if v := os.environ.get("ARK_API_KEY"):
        cfg.ark_image.api_key = v
        cfg.ark_chat.api_key = v  # 免费 LLM 与文生图共用 ARK_API_KEY
    if v := os.environ.get("ARK_MODEL"):
        cfg.ark_image.model = v
    if v := os.environ.get("ARK_CHAT_MODEL"):
        cfg.ark_chat.model = v

    if v := os.environ.get("PP_TOKEN"):
        cfg.pp_structure.token = v

    # 默认提示词
    if not cfg.llm_prompts.english_teaching:
        cfg.llm_prompts.english_teaching = (
            "你是一个儿童英语发音教学专家。你面对的是 6-12 岁的中国儿童。"
            "要求：使用简单、生动、鼓励性的儿童语言；回答不超过 3 句话；"
            "多用 emoji；使用简体中文；指出具体改进方法。"
        )
    if not cfg.llm_prompts.chinese_teaching:
        cfg.llm_prompts.chinese_teaching = "你是一个只输出JSON的语文教学助手。"
    if not cfg.llm_prompts.quiz_generate:
        cfg.llm_prompts.quiz_generate = (
            "你是一个儿童英语教学专家，负责从动画字幕中提取适合中国儿童学习的英语材料。"
        )
    if not cfg.llm_prompts.default:
        cfg.llm_prompts.default = "你是 AiPhonix 教学助手，请用简体中文回答。"

    return cfg
