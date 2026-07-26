package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"ai-server/config"
)

const (
	costPerMInput  = 0.5
	costPerMOutput = 2.0
)

type DeepSeekMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type DeepSeekRequest struct {
	Model       string            `json:"model"`
	Messages    []DeepSeekMessage `json:"messages"`
	MaxTokens   int               `json:"max_tokens,omitempty"`
	Temperature float64           `json:"temperature,omitempty"`
}

type DeepSeekChoice struct {
	Message struct {
		Content          string `json:"content"`
		ReasoningContent string `json:"reasoning_content,omitempty"`
	} `json:"message"`
}

type DeepSeekUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type DeepSeekResponse struct {
	Choices []DeepSeekChoice `json:"choices"`
	Usage   *DeepSeekUsage   `json:"usage,omitempty"`
}

type LLMCallLog struct {
	Time         string  `json:"time"`
	Caller       string  `json:"caller"`
	Model        string  `json:"model"`
	SystemPrompt string  `json:"system_prompt"`
	UserPrompt   string  `json:"user_prompt"`
	PromptTokens int     `json:"prompt_tokens"`
	CompTokens   int     `json:"comp_tokens"`
	TotalTokens  int     `json:"total_tokens"`
	CostYuan     float64 `json:"cost_yuan"`
	DurationMs   int64   `json:"duration_ms"`
	Success      bool    `json:"success"`
	Error        string  `json:"error,omitempty"`
}

var (
	callLogsMu   sync.RWMutex
	callLogs     []LLMCallLog
	maxLogs      = 100000
	logFilePath  = "data/llm_call_logs.json"
)

func init() {
	if data, err := os.ReadFile(logFilePath); err == nil {
		var saved []LLMCallLog
		if json.Unmarshal(data, &saved) == nil {
			callLogs = saved
		}
	}
}

func GetCallLogs() []LLMCallLog {
	callLogsMu.RLock()
	defer callLogsMu.RUnlock()
	result := make([]LLMCallLog, len(callLogs))
	copy(result, callLogs)
	return result
}

func ClearCallLogs() {
	callLogsMu.Lock()
	defer callLogsMu.Unlock()
	callLogs = nil
	os.WriteFile(logFilePath, []byte("[]"), 0644)
}

func appendLog(log LLMCallLog) {
	callLogsMu.Lock()
	defer callLogsMu.Unlock()
	callLogs = append(callLogs, log)
	if len(callLogs) > maxLogs {
		callLogs = callLogs[len(callLogs)-maxLogs:]
	}
	go func() {
		data, _ := json.MarshalIndent(callLogs, "", "  ")
		os.WriteFile(logFilePath, data, 0644)
	}()
}

type DeepSeekService struct {
	config *config.DeepSeekConfig
	client *http.Client
	caller string
}

func NewDeepSeekService(cfg *config.DeepSeekConfig) *DeepSeekService {
	return &DeepSeekService{
		config: cfg,
		client: &http.Client{Timeout: 120 * time.Second},
	}
}

func (s *DeepSeekService) WithCaller(name string) *DeepSeekService {
	s.caller = name
	return s
}

func (s *DeepSeekService) Chat(systemPrompt, userPrompt string, maxTokens int, caller ...string) (string, error) {
	if len(caller) > 0 {
		s.caller = caller[0]
	}
	if maxTokens <= 0 {
		maxTokens = 2000
	}
	reqBody := DeepSeekRequest{
		Model: s.config.Model,
		Messages: []DeepSeekMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		MaxTokens:   maxTokens,
		Temperature: 0.7,
	}
	return s.callAPI(reqBody, systemPrompt, userPrompt)
}

func (s *DeepSeekService) callAPI(reqBody DeepSeekRequest, systemPrompt, userPrompt string) (string, error) {
	start := time.Now()

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("serialize failed: %w", err)
	}

	httpReq, err := http.NewRequest("POST", s.config.BaseURL+"/v1/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("create request failed: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+s.config.APIKey)

	resp, err := s.client.Do(httpReq)
	duration := time.Since(start).Milliseconds()

	log := LLMCallLog{
		Time:   time.Now().Format("2006-01-02 15:04:05"),
		Caller: s.caller,
		Model:  s.config.Model,
	}
	if len(systemPrompt) > 200 {
		log.SystemPrompt = systemPrompt[:200] + "..."
	} else {
		log.SystemPrompt = systemPrompt
	}
	if len(userPrompt) > 300 {
		log.UserPrompt = userPrompt[:300] + "..."
	} else {
		log.UserPrompt = userPrompt
	}
	log.DurationMs = duration

	if err != nil {
		log.Success = false
		log.Error = err.Error()
		appendLog(log)
		return "", fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Success = false
		log.Error = err.Error()
		appendLog(log)
		return "", fmt.Errorf("read resp failed: %w", err)
	}

	if resp.StatusCode != 200 {
		log.Success = false
		log.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBytes))
		appendLog(log)
		return "", fmt.Errorf("API error %d: %s", resp.StatusCode, string(respBytes))
	}

	var dsResp DeepSeekResponse
	if err := json.Unmarshal(respBytes, &dsResp); err != nil {
		log.Success = false
		log.Error = fmt.Sprintf("parse failed: %v", err)
		appendLog(log)
		return "", fmt.Errorf("parse resp failed: %w", err)
	}

	if len(dsResp.Choices) == 0 {
		log.Success = false
		log.Error = "empty choices"
		appendLog(log)
		return "", fmt.Errorf("empty choices")
	}

	if dsResp.Usage != nil {
		log.PromptTokens = dsResp.Usage.PromptTokens
		log.CompTokens = dsResp.Usage.CompletionTokens
		log.TotalTokens = dsResp.Usage.TotalTokens
		log.CostYuan = float64(dsResp.Usage.PromptTokens)/1000000*costPerMInput +
			float64(dsResp.Usage.CompletionTokens)/1000000*costPerMOutput
	}

	msg := dsResp.Choices[0].Message
	content := ""
	if msg.Content != "" {
		content = msg.Content
	} else if msg.ReasoningContent != "" {
		content = msg.ReasoningContent
	}

	if content == "" {
		log.Success = false
		log.Error = "empty content"
		appendLog(log)
		return "", fmt.Errorf("empty content")
	}

	log.Success = true
	appendLog(log)
	return content, nil
}
