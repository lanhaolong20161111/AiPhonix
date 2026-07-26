package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

// Config 应用配置
type Config struct {
	Server    ServerConfig    `yaml:"server"`
	DeepSeek  DeepSeekConfig  `yaml:"deepseek"`
	BaiduTTS  BaiduTTSConfig  `yaml:"baidu_tts"`
	Tencent   TencentConfig   `yaml:"tencent"`
	LLMPrompts LLMPromptsConfig `yaml:"llm_prompts"`
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port string `yaml:"port"`
}

type DeepSeekConfig struct {
	APIKey  string `yaml:"api_key"`
	BaseURL string `yaml:"base_url"`
	Model   string `yaml:"model"`
}

type BaiduTTSConfig struct {
	AppID     string `yaml:"app_id"`
	APIKey    string `yaml:"api_key"`
	SecretKey string `yaml:"secret_key"`
	CacheDir  string `yaml:"cache_dir"`
}

type TencentConfig struct {
	AppID     string `yaml:"app_id"`
	SecretID  string `yaml:"secret_id"`
	SecretKey string `yaml:"secret_key"`
}

// LLMPromptsConfig LLM 各模块系统提示词
type LLMPromptsConfig struct {
	EnglishTeaching string `yaml:"english_teaching"`
	ChineseTeaching string `yaml:"chinese_teaching"`
	QuizGenerate    string `yaml:"quiz_generate"`
	WordSuggestions string `yaml:"word_suggestions"`
	SentenceMaking  string `yaml:"sentence_making"`
	Default         string `yaml:"default"`
}

// Load 加载配置文件，环境变量会覆盖 yaml 中的值
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	// 默认值
	if cfg.Server.Host == "" {
		cfg.Server.Host = "0.0.0.0"
	}
	if cfg.Server.Port == "" {
		cfg.Server.Port = "8080"
	}
	if cfg.DeepSeek.BaseURL == "" {
		cfg.DeepSeek.BaseURL = "https://api.deepseek.com"
	}
	if cfg.DeepSeek.Model == "" {
		cfg.DeepSeek.Model = "deepseek-v4-flash"
	}
	// LLM 提示词默认值
	if cfg.LLMPrompts.EnglishTeaching == "" {
		cfg.LLMPrompts.EnglishTeaching = "你是一个儿童英语发音教学专家。你面对的是 6-12 岁的中国儿童。要求：使用简单、生动、鼓励性的儿童语言；回答不超过 3 句话；多用 emoji；使用简体中文；指出具体改进方法。"
	}
	if cfg.LLMPrompts.ChineseTeaching == "" {
		cfg.LLMPrompts.ChineseTeaching = "你是一个只输出JSON的语文教学助手。"
	}
	if cfg.LLMPrompts.QuizGenerate == "" {
		cfg.LLMPrompts.QuizGenerate = "你是一个儿童英语教学专家，负责从动画字幕中提取适合中国儿童学习的英语材料。"
	}
	if cfg.LLMPrompts.Default == "" {
		cfg.LLMPrompts.Default = "你是 AiPhonix 教学助手，请用简体中文回答。"
	}
	return &cfg, nil
}
