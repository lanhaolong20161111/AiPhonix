package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"ai-server/config"
	"ai-server/internal/service"

	"github.com/gin-gonic/gin"
)

// LLMQuiz 根据字幕生成题库（带缓存）
func LLMQuiz(cfg *config.Config) gin.HandlerFunc {
	svc := service.NewDeepSeekService(&cfg.DeepSeek)

	return func(c *gin.Context) {
		var req struct {
			SubtitleText string `json:"subtitle_text" binding:"required"`
			VideoName    string `json:"video_name" binding:"required"`
			Count        int    `json:"count"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 subtitle_text 和 video_name"})
			return
		}
		if req.Count <= 0 {
			req.Count = 30
		}

		// 检查缓存
		cachePath := fmt.Sprintf("data/quiz_cache_%s.json", req.VideoName)
		if data, err := os.ReadFile(cachePath); err == nil {
			if json.Valid(data) {
				c.JSON(http.StatusOK, gin.H{"source": "cache", "items": json.RawMessage(data)})
				return
			}
			log.Printf("[警告] quiz 缓存损坏，重新生成: %s", req.VideoName)
		}

		// 精简体幕：去时间戳、序号、空行，保留全部有效文本
		cleaned := cleanSubtitle(req.SubtitleText)
		// 如果清理后仍然很长，取前 4000 字（平衡 token 消耗和信息量）
		if len(cleaned) > 4000 {
			cleaned = cleaned[:4000]
		}

		systemPrompt := cfg.LLMPrompts.QuizGenerate
		userPrompt := fmt.Sprintf(`从字幕中提取%d条英语填空题，适合中国儿童学习。
要求：日常实用、含中英文、难度1-5、按易到难排列。
只输出JSON数组：
[{"english":"原句","chinese":"中文","difficulty":1-5,"display":"用___填空","blankAnswer":"答案"}]

字幕：
%s`, req.Count, cleaned)

		reply, err := svc.Chat(systemPrompt, userPrompt, 4096, "quiz_generate")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 调用失败: " + err.Error()})
			return
		}

		// 验证 JSON 有效性
		reply = extractJSONArray(reply)
		if !json.Valid([]byte(reply)) {
			// 重试一次
			reply2, err2 := svc.Chat(systemPrompt, userPrompt+"\n务必只输出JSON数组，不要其他文字。", 4096, "quiz_generate_retry")
			if err2 != nil || !json.Valid([]byte(extractJSONArray(reply2))) {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 返回格式错误"})
				return
			}
			reply = extractJSONArray(reply2)
		}

		// 写入缓存
		if err := os.WriteFile(cachePath, []byte(reply), 0644); err != nil {
			log.Printf("[警告] 写入缓存失败: %v", err)
		}

		c.JSON(http.StatusOK, gin.H{"source": "llm", "items": json.RawMessage(reply)})
	}
}

// LLMQuizGenerate 强制重新生成题库（忽略缓存）
func LLMQuizGenerate(cfg *config.Config) gin.HandlerFunc {
	svc := service.NewDeepSeekService(&cfg.DeepSeek)

	return func(c *gin.Context) {
		var req struct {
			SubtitleText string `json:"subtitle_text" binding:"required"`
			VideoName    string `json:"video_name" binding:"required"`
			Count        int    `json:"count"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 subtitle_text 和 video_name"})
			return
		}
		if req.Count <= 0 {
			req.Count = 30
		}

		cleaned := cleanSubtitle(req.SubtitleText)
		if len(cleaned) > 4000 {
			cleaned = cleaned[:4000]
		}

		systemPrompt := cfg.LLMPrompts.QuizGenerate
		userPrompt := fmt.Sprintf(`从字幕中提取%d条英语填空题，适合中国儿童学习。
要求：日常实用、含中英文、难度1-5、按易到难排列。
只输出JSON数组。

字幕：
%s`, req.Count, cleaned)

		reply, err := svc.Chat(systemPrompt, userPrompt, 4096, "quiz_generate_cached")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "LLM 调用失败: " + err.Error()})
			return
		}

		reply = extractJSONArray(reply)
		c.JSON(http.StatusOK, gin.H{"items": json.RawMessage(reply)})
	}
}

// cleanSubtitle 精简字幕：去时间戳、序号、空行，只保留对话文本
func cleanSubtitle(text string) string {
	lines := strings.Split(text, "\n")
	var result []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// 跳过空行、时间戳行、纯数字行
		if line == "" || strings.Contains(line, "-->") || isNumeric(line) {
			continue
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

func isNumeric(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(s) > 0
}

// extractJSONArray 从 LLM 回复中提取 JSON 数组
func extractJSONArray(reply string) string {
	start := strings.Index(reply, "[")
	end := strings.LastIndex(reply, "]")
	if start >= 0 && end > start {
		return reply[start : end+1]
	}
	return reply
}
