package handler

import (
	"ai-server/config"
	"ai-server/internal/service"

	"github.com/gin-gonic/gin"
)

// PracticeTrackerHandler 练习追踪
type PracticeTrackerHandler struct {
	tracker *service.PracticeTracker
}

func NewPracticeTrackerHandler(cfg *config.Config) *PracticeTrackerHandler {
	return &PracticeTrackerHandler{
		tracker: service.NewPracticeTracker("data"),
	}
}

// RecordCharResult 记录单字练习结果（type: "pinyin" / "pronunciation"）
func (h *PracticeTrackerHandler) RecordCharResult(c *gin.Context) {
	var req struct {
		Char    string `json:"char" binding:"required"`
		Correct bool   `json:"correct"`
		Type    string `json:"type"` // "pinyin" / "pronunciation"
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "请提供 char 字段"})
		return
	}
	recordType := req.Type
	if recordType == "" {
		recordType = "pinyin" // 默认拼音
	}
	h.tracker.RecordResult(req.Char, recordType, req.Correct)
	c.JSON(200, gin.H{"status": "ok"})
}

// GetCharWeights 获取字的选择权重
func (h *PracticeTrackerHandler) GetCharWeights(c *gin.Context) {
	var req struct {
		Chars []string `json:"chars" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "请提供 chars 数组"})
		return
	}
	weights := h.tracker.GetAllWeights(req.Chars)
	c.JSON(200, gin.H{"weights": weights})
}
