package main

import (
	"log"
	"os"

	"ai-server/config"
	"ai-server/internal/handler"
	"ai-server/internal/middleware"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	// 从环境变量读取 API Key
	if v := os.Getenv("DEEPSEEK_API_KEY"); v != "" {
		cfg.DeepSeek.APIKey = v
	}

	r := gin.Default()
	r.Use(middleware.CORS())

	api := r.Group("/api/v1")
	{
		api.POST("/llm/chat", handler.LLMChat(cfg))
		api.GET("/llm/logs", handler.LLMLogs())
		api.POST("/llm/quiz", handler.LLMQuiz(cfg))
		api.POST("/llm/quiz-generate", handler.LLMQuizGenerate(cfg))
		api.POST("/tts/synthesize", handler.TTSSynthesize(cfg))
		api.POST("/soe/evaluate", handler.SOEEvaluate(cfg))

		// 语文练习模块
		api.POST("/llm/word-info", handler.WordInfoHandler(cfg))
		api.POST("/llm/sentence-generate", handler.SentenceGenerateHandler(cfg))
		api.POST("/llm/sentence-batch-save", handler.SentenceBatchSaveHandler())

		// 练习记录
		ph := handler.NewPracticeHandler("data")
		api.POST("/practice/submit", ph.SubmitPractice)
		api.GET("/practice/stats", ph.GetPracticeStats)
		api.GET("/practice/history", ph.GetPracticeHistory)

		// 字词库
		wh := handler.NewWordBankHandler("data")
		api.GET("/wordbank/stats", wh.Stats)
		api.GET("/wordbank/query", wh.Query)
		api.GET("/wordbank/search", wh.Search)
		api.POST("/wordbank/add-word", wh.AddWord)

		// 练习追踪
		th := handler.NewPracticeTrackerHandler(cfg)
		api.POST("/practice/char-record", th.RecordCharResult)
		api.POST("/practice/char-weights", th.GetCharWeights)

		// 多音字数据
		api.GET("/chinese/polyphone", handler.PolyphoneHandler())

		// 字词联想（LLM + 缓存）
		api.POST("/llm/word-suggestions", handler.WordSuggestionsHandler(cfg))

		// 英语词汇与句子
		api.GET("/english/vocabulary", handler.EnglishVocabularyHandler())
		api.GET("/english/sentences", handler.EnglishSentencesHandler())
	}

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "model": cfg.DeepSeek.Model})
	})

	addr := cfg.Server.Host + ":" + cfg.Server.Port
	log.Printf("AiPhonix 服务器启动: %s (模型: %s)", addr, cfg.DeepSeek.Model)
	r.Run(addr)
}
