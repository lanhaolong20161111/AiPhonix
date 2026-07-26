package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"ai-server/config"
	"ai-server/internal/service"

	"github.com/gin-gonic/gin"
)

// WordSuggestion 字词联想
type WordSuggestion struct {
	Char   string   `json:"char"`
	Words  []string `json:"words"`
}

// WordSuggestionCache 缓存
type WordSuggestionCache struct {
	mu   sync.Mutex
	data map[string][]string // char → words
	path string
}

func NewWordSuggestionCache(dataDir string) *WordSuggestionCache {
	c := &WordSuggestionCache{
		data: make(map[string][]string),
		path: filepath.Join(dataDir, "word_suggestions.json"),
	}
	c.load()
	return c
}

func (c *WordSuggestionCache) load() {
	b, err := os.ReadFile(c.path)
	if err != nil {
		log.Printf("[WordCache] 无缓存文件: %v", err)
		return
	}
	var list []WordSuggestion
	if err := json.Unmarshal(b, &list); err != nil {
		return
	}
	for _, s := range list {
		c.data[s.Char] = s.Words
	}
	log.Printf("[WordCache] 已加载 %d 条字词联想缓存", len(list))
}

func (c *WordSuggestionCache) save() {
	os.MkdirAll(filepath.Dir(c.path), 0755)
	var list []WordSuggestion
	for ch, words := range c.data {
		list = append(list, WordSuggestion{Char: ch, Words: words})
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	os.WriteFile(c.path, b, 0644)
}

func (c *WordSuggestionCache) Get(char string) ([]string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	w, ok := c.data[char]
	return w, ok
}

func (c *WordSuggestionCache) Set(char string, words []string) {
	c.mu.Lock()
	c.data[char] = words
	c.mu.Unlock()
	c.save() // save 不持锁
}

// WordSuggestionsHandler 字词联想（LLM 生成，服务端缓存）
func WordSuggestionsHandler(cfg *config.Config) gin.HandlerFunc {
	svc := service.NewDeepSeekService(&cfg.DeepSeek)
	cache := NewWordSuggestionCache("data")

	return func(c *gin.Context) {
		var req struct {
			Char string `json:"char" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请提供 char 字段"})
			return
		}

		// 查缓存
		if words, ok := cache.Get(req.Char); ok {
			c.JSON(200, gin.H{"char": req.Char, "words": words, "source": "cache"})
			return
		}

		// 优先从静态数据取组词（秒回，不调 LLM）
		words := getFallbackWords(req.Char)
		if len(words) < 3 {
			// 词不够才调 LLM 补充
			prompt := fmt.Sprintf(`为小学一年级学生生成汉字"%s"的常用词语，要求：
- 只输出3-5个最常见、最简单的词语
- 每个词不超过4个字
- 直接输出JSON数组，不要其他文字
["词1","词2","词3"]`, req.Char)

			reply, err := svc.Chat("你是一个只输出JSON的小学语文助手。", prompt, 500, "word_suggestions")
			if err == nil {
				var llmWords []string
				if err := json.Unmarshal([]byte(reply), &llmWords); err == nil && len(llmWords) > 0 {
					words = llmWords
				}
			}
		}

		if len(words) > 5 {
			words = words[:5]
		}

		cache.Set(req.Char, words)
		source := "local"
		if len(words) == 0 {
			words = []string{req.Char}
		}
		c.JSON(200, gin.H{"char": req.Char, "words": words, "source": source})
	}
}

// getFallbackWords 从静态 char_info 读取组词
func getFallbackWords(char string) []string {
	data, err := os.ReadFile(filepath.Join("data", "char_info.json"))
	if err != nil {
		return []string{char}
	}
	var list []struct {
		Char  string   `json:"char"`
		Words []string `json:"words"`
	}
	json.Unmarshal(data, &list)
	for _, item := range list {
		if item.Char == char {
			if len(item.Words) > 5 {
				return item.Words[:5]
			}
			return item.Words
		}
	}
	return []string{char}
}
