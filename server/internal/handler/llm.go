package handler

import (
	"net/http"

	"ai-server/config"
	"ai-server/internal/service"

	"github.com/gin-gonic/gin"
)

// LLMChat DeepSeek 聊天代理 — 支持按 mode 切换系统提示词
func LLMChat(cfg *config.Config) gin.HandlerFunc {
	svc := service.NewDeepSeekService(&cfg.DeepSeek)

	return func(c *gin.Context) {
		var req struct {
			Message string `json:"message" binding:"required"`
			Mode    string `json:"mode"`
			Prompt  string `json:"prompt"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 message 字段"})
			return
		}

		systemPrompt := req.Prompt
		if systemPrompt == "" {
			switch req.Mode {
			case "chinese":
				systemPrompt = cfg.LLMPrompts.ChineseTeaching
			case "quiz":
				systemPrompt = cfg.LLMPrompts.QuizGenerate
			case "english":
				systemPrompt = cfg.LLMPrompts.EnglishTeaching
			default:
				systemPrompt = cfg.LLMPrompts.Default
			}
		}

		// 确定调用方标识
		caller := "llm_chat"
		if req.Mode != "" {
			caller = "llm_chat_" + req.Mode
		}

		maxTokens := 2000
		reply, err := svc.Chat(systemPrompt, req.Message, maxTokens, caller)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"reply": reply, "mode": req.Mode})
	}
}

// LLMLogs 返回 LLM 调用日志
func LLMLogs() gin.HandlerFunc {
	return func(c *gin.Context) {
		logs := service.GetCallLogs()
		// 统计
		totalCalls := len(logs)
		totalTokens := 0
		totalCost := 0.0
		successCount := 0
		for _, l := range logs {
			totalTokens += l.TotalTokens
			totalCost += l.CostYuan
			if l.Success {
				successCount++
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"total_calls":  totalCalls,
			"success":      successCount,
			"failed":       totalCalls - successCount,
			"total_tokens": totalTokens,
			"total_cost":   totalCost,
			"logs":         logs,
		})
	}
}
