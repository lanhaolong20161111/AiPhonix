package handler

import (
	"net/http"

	"ai-server/config"
	"ai-server/internal/service"

	"github.com/gin-gonic/gin"
)

// TTSSynthesize 百度 TTS 语音合成代理（带服务端缓存）
func TTSSynthesize(cfg *config.Config) gin.HandlerFunc {
	svc := service.NewBaiduTTSService(
		cfg.BaiduTTS.AppID,
		cfg.BaiduTTS.APIKey,
		cfg.BaiduTTS.SecretKey,
		cfg.BaiduTTS.CacheDir,
	)

	return func(c *gin.Context) {
		var req struct {
			Text    string `json:"text" binding:"required"`
			Speaker string `json:"speaker"`
			Speed   int    `json:"speed"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 text 字段"})
			return
		}

		audio, err := svc.Synthesize(req.Text, req.Speaker, req.Speed)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "TTS 合成失败: " + err.Error()})
			return
		}

		c.Data(http.StatusOK, "audio/mpeg", audio)
	}
}
