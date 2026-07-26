package handler

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// PracticeRecord 单次练习记录
type PracticeRecord struct {
	Char           string `json:"char"`                      // 字/词
	Module         string `json:"module"`                    // recognition / dictation / word
	AttemptCount   int    `json:"attempt_count"`              // 尝试次数
	FirstTryCorrect bool  `json:"first_try_correct"`          // 一次过
	HintUsed       bool   `json:"hint_used"`                  // 是否用了提示
	Correct        bool   `json:"correct"`                    // 最终是否正确
	Timestamp      string `json:"timestamp"`                  // ISO8601
	Date           string `json:"date"`                       // YYYY-MM-DD
	Grade          string `json:"grade,omitempty"`            // 年级（可选）
}

// PracticeSession 一次练习会话（20题）
type PracticeSession struct {
	Module       string           `json:"module"`
	Grade        string           `json:"grade,omitempty"`
	Records      []PracticeRecord `json:"records"`
	TotalScore   int              `json:"total_score"`
	MaxScore     int              `json:"max_score"`
	Timestamp    string           `json:"timestamp"`
	Date         string           `json:"date"`
}

// PracticeStats 汇总统计
type PracticeStats struct {
	TotalSessions   int            `json:"total_sessions"`
	TotalChars      int            `json:"total_chars"`
	FirstTryCorrect int            `json:"first_try_correct"`
	TotalCorrect    int            `json:"total_correct"`
	PerChar         map[string]int `json:"per_char"` // char -> first_try_correct count
	PerCharAttempts map[string]int `json:"per_char_attempts"` // char -> total attempts
}

// PracticeHandler 练习记录处理器
type PracticeHandler struct {
	mu       sync.RWMutex
	dataDir  string
	sessions []PracticeSession
}

func NewPracticeHandler(dataDir string) *PracticeHandler {
	h := &PracticeHandler{
		dataDir: filepath.Join(dataDir, "practice"),
	}
	os.MkdirAll(h.dataDir, 0755)
	h.load()
	return h
}

func (h *PracticeHandler) load() {
	files, _ := filepath.Glob(filepath.Join(h.dataDir, "*.json"))
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var s PracticeSession
		if err := json.Unmarshal(data, &s); err == nil {
			h.sessions = append(h.sessions, s)
		}
	}
}

func (h *PracticeHandler) save(session PracticeSession) error {
	// 按日期分文件，避免单个文件过大
	filename := fmt.Sprintf("practice_%s_%d.json", session.Date, time.Now().UnixMilli())
	path := filepath.Join(h.dataDir, filename)
	data, _ := json.MarshalIndent(session, "", "  ")
	return os.WriteFile(path, data, 0644)
}

// SubmitPractice POST /api/v1/practice/submit
func (h *PracticeHandler) SubmitPractice(c *gin.Context) {
	var session PracticeSession
	if err := c.ShouldBindJSON(&session); err != nil {
		c.JSON(400, gin.H{"error": "请求格式错误"})
		return
	}

	now := time.Now()
	session.Timestamp = now.Format(time.RFC3339)
	session.Date = now.Format("2006-01-02")

	// 计算分数
	correct := 0
	for _, r := range session.Records {
		if r.Correct {
			correct++
		}
	}
	session.TotalScore = correct
	session.MaxScore = len(session.Records)

	h.mu.Lock()
	h.sessions = append(h.sessions, session)
	if err := h.save(session); err != nil {
		h.mu.Unlock()
		c.JSON(500, gin.H{"error": "保存失败"})
		return
	}
	h.mu.Unlock()

	c.JSON(200, gin.H{
		"status":     "ok",
		"score":      correct,
		"max_score":  len(session.Records),
		"session_id": session.Date,
	})
}

// GetPracticeStats GET /api/v1/practice/stats
func (h *PracticeHandler) GetPracticeStats(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	stats := PracticeStats{
		PerChar:         make(map[string]int),
		PerCharAttempts: make(map[string]int),
	}

	for _, s := range h.sessions {
		stats.TotalSessions++
		for _, r := range s.Records {
			stats.TotalChars++
			if r.FirstTryCorrect {
				stats.FirstTryCorrect++
			}
			if r.Correct {
				stats.TotalCorrect++
				stats.PerChar[r.Char]++
			}
			stats.PerCharAttempts[r.Char]++
		}
	}

	c.JSON(200, stats)
}

// GetPracticeHistory GET /api/v1/practice/history?module=dictation&limit=10
func (h *PracticeHandler) GetPracticeHistory(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	module := c.Query("module")
	limit := 10
	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}

	var result []PracticeSession
	for i := len(h.sessions) - 1; i >= 0 && len(result) < limit; i-- {
		s := h.sessions[i]
		if module != "" && s.Module != module {
			continue
		}
		result = append(result, s)
	}

	c.JSON(200, gin.H{
		"total":    len(h.sessions),
		"sessions": result,
	})
}
