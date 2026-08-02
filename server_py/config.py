"""配置加载 — 从 config.yaml 和环境变量读取"""

import os
from dataclasses import dataclass, field
from typing import Optional

import yaml


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: str = "8080"


@dataclass
class DeepSeekConfig:
    api_key: str = ""
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-v4-flash"
    # 预算守卫（元 / 字符）
    max_cost_per_call: float = 0.5      # 单次调用费用上限（调用前按最坏情况预估拒绝）
    max_cost_per_day: float = 5.0       # 每日累计费用上限（超限拒绝当日后续调用）
    max_input_chars: int = 20000        # 输入提示词字符数硬上限


@dataclass
class BaiduTTSConfig:
    app_id: str = ""
    api_key: str = ""
    secret_key: str = ""
    cache_dir: str = "cache/tts"


@dataclass
class TencentConfig:
    app_id: str = ""
    secret_id: str = ""
    secret_key: str = ""


@dataclass
class LLMPromptsConfig:
    english_teaching: str = ""
    chinese_teaching: str = ""
    quiz_generate: str = ""
    word_suggestions: str = ""
    sentence_making: str = ""
    default: str = ""


@dataclass
class ArkImageConfig:
    api_key: str = ""
    model: str = "doubao-image-pro-32k"
    endpoint: str = "https://open.volcengineapi.com"


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    deepseek: DeepSeekConfig = field(default_factory=DeepSeekConfig)
    baidu_tts: BaiduTTSConfig = field(default_factory=BaiduTTSConfig)
    tencent: TencentConfig = field(default_factory=TencentConfig)
    llm_prompts: LLMPromptsConfig = field(default_factory=LLMPromptsConfig)
    ark_image: ArkImageConfig = field(default_factory=ArkImageConfig)


def load_config(path: str = "config.yaml") -> Config:
    """加载配置，环境变量优先"""
    cfg = Config()

    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

        if "server" in raw:
            cfg.server.host = raw["server"].get("host", cfg.server.host)
            cfg.server.port = raw["server"].get("port", cfg.server.port)

        if "deepseek" in raw:
            cfg.deepseek.api_key = raw["deepseek"].get("api_key", "")
            cfg.deepseek.base_url = raw["deepseek"].get("base_url", cfg.deepseek.base_url)
            cfg.deepseek.model = raw["deepseek"].get("model", cfg.deepseek.model)
            if "budget" in raw["deepseek"]:
                b = raw["deepseek"]["budget"]
                cfg.deepseek.max_cost_per_call = float(b.get("max_cost_per_call", cfg.deepseek.max_cost_per_call))
                cfg.deepseek.max_cost_per_day = float(b.get("max_cost_per_day", cfg.deepseek.max_cost_per_day))
                cfg.deepseek.max_input_chars = int(b.get("max_input_chars", cfg.deepseek.max_input_chars))

        if "baidu_tts" in raw:
            b = raw["baidu_tts"]
            cfg.baidu_tts.app_id = b.get("app_id", "")
            cfg.baidu_tts.api_key = b.get("api_key", "")
            cfg.baidu_tts.secret_key = b.get("secret_key", "")
            cfg.baidu_tts.cache_dir = b.get("cache_dir", cfg.baidu_tts.cache_dir)

        if "tencent" in raw:
            t = raw["tencent"]
            cfg.tencent.app_id = t.get("app_id", "")
            cfg.tencent.secret_id = t.get("secret_id", "")
            cfg.tencent.secret_key = t.get("secret_key", "")

        if "llm_prompts" in raw:
            p = raw["llm_prompts"]
            cfg.llm_prompts.english_teaching = p.get("english_teaching", "")
            cfg.llm_prompts.chinese_teaching = p.get("chinese_teaching", "")
            cfg.llm_prompts.quiz_generate = p.get("quiz_generate", "")
            cfg.llm_prompts.word_suggestions = p.get("word_suggestions", "")
            cfg.llm_prompts.sentence_making = p.get("sentence_making", "")
            cfg.llm_prompts.default = p.get("default", "")

        if "ark_image" in raw:
            a = raw["ark_image"]
            cfg.ark_image.api_key = a.get("api_key", "")
            cfg.ark_image.model = a.get("model", cfg.ark_image.model)

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
    if v := os.environ.get("ARK_MODEL"):
        cfg.ark_image.model = v

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
