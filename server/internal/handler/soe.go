package handler

import (
	"net/http"

	"ai-server/config"
	"ai-server/internal/service"

	"github.com/gin-gonic/gin"
)

// SOEEvaluate 腾讯云智聆 SOE 语音评测代理（非流式）
func SOEEvaluate(cfg *config.Config) gin.HandlerFunc {
	svc := service.NewTencentSOEService(
		cfg.Tencent.AppID,
		cfg.Tencent.SecretID,
		cfg.Tencent.SecretKey,
	)

	return func(c *gin.Context) {
		var req struct {
			RefText     string `json:"ref_text" binding:"required"`
			AudioBase64 string `json:"audio_base64" binding:"required"`
			Engine      string `json:"engine"` // 可选: 16k_en(默认) / 16k_zh
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 ref_text 和 audio_base64"})
			return
		}

		result, err := svc.Evaluate(req.RefText, req.AudioBase64, req.Engine)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "SOE 评测失败: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, result)
	}
}
