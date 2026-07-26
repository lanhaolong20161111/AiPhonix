package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

type WordBankEntry struct {
	Text   string   `json:"text"`
	Tags   []string `json:"tags"`
	Type   string   `json:"type"`
	Pinyin string   `json:"pinyin"`
}

type WordBank struct {
	Version int             `json:"version"`
	Chars   []WordBankEntry `json:"chars"`
	Words   []WordBankEntry `json:"words"`
}

type WordBankHandler struct {
	mu   sync.RWMutex
	bank *WordBank
	path string
}

func NewWordBankHandler(dataDir string) *WordBankHandler {
	h := &WordBankHandler{
		path: filepath.Join(dataDir, "wordbank.json"),
	}
	h.load()
	return h
}

func (h *WordBankHandler) load() {
	h.mu.Lock()
	defer h.mu.Unlock()

	data, err := os.ReadFile(h.path)
	if err != nil {
		h.bank = &WordBank{Version: 1}
		return
	}
	var bank WordBank
	if err := json.Unmarshal(data, &bank); err != nil {
		h.bank = &WordBank{Version: 1}
		return
	}
	h.bank = &bank
}

func (h *WordBankHandler) allEntries() []WordBankEntry {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.bank == nil {
		return nil
	}
	total := len(h.bank.Chars) + len(h.bank.Words)
	result := make([]WordBankEntry, 0, total)
	result = append(result, h.bank.Chars...)
	result = append(result, h.bank.Words...)
	return result
}

// GET /api/v1/wordbank/stats
func (h *WordBankHandler) Stats(c *gin.Context) {
	entries := h.allEntries()
	counts := make(map[string]int)
	for _, e := range entries {
		for _, tag := range e.Tags {
			counts[tag]++
		}
	}

	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	stats := make([]gin.H, 0, len(keys))
	for _, k := range keys {
		stats = append(stats, gin.H{"tag": k, "count": counts[k]})
	}

	chars := 0
	words := 0
	if h.bank != nil {
		chars = len(h.bank.Chars)
		words = len(h.bank.Words)
	}

	c.JSON(http.StatusOK, gin.H{
		"total_chars": chars,
		"total_words": words,
		"stats":       stats,
	})
}

// GET /api/v1/wordbank/query?grade=二年级&semester=下&type=识字&limit=50
func (h *WordBankHandler) Query(c *gin.Context) {
	grade := c.Query("grade")
	semester := c.Query("semester")
	typ := c.Query("type")
	limit := parseInt(c.DefaultQuery("limit", "100"), 100)

	entries := h.allEntries()
	var filtered []WordBankEntry

	for _, e := range entries {
		ok := true
		if grade != "" && semester != "" {
			tag := grade + semester
			if !hasTag(e.Tags, tag) {
				ok = false
			}
		}
		if typ != "" && !hasTag(e.Tags, typ) {
			ok = false
		}
		if ok {
			filtered = append(filtered, e)
		}
	}

	if len(filtered) > limit {
		filtered = filtered[:limit]
	}

	c.JSON(http.StatusOK, gin.H{
		"total": len(filtered),
		"items": filtered,
	})
}

// GET /api/v1/wordbank/search?q=花
func (h *WordBankHandler) Search(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing q parameter"})
		return
	}

	entries := h.allEntries()
	var results []WordBankEntry
	for _, e := range entries {
		if strings.Contains(e.Text, query) {
			results = append(results, e)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"query": query,
		"total": len(results),
		"items": results,
	})
}

func hasTag(tags []string, tag string) bool {
	for _, t := range tags {
		if t == tag {
			return true
		}
	}
	return false
}

// POST /api/v1/wordbank/add-word — 保存 LLM 生成的词语到词库
func (h *WordBankHandler) AddWord(c *gin.Context) {
	var req struct {
		Char  string   `json:"char"`
		Words []string `json:"words"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 char 和 words"})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	added := 0
	for _, w := range req.Words {
		if len(w) < 2 {
			continue
		}
		exists := false
		for _, existing := range h.bank.Words {
			if existing.Text == w {
				exists = true
				break
			}
		}
		if !exists {
			h.bank.Words = append(h.bank.Words, WordBankEntry{
				Text:   w,
				Tags:   []string{"LLM生成", "词语"},
				Type:   "word",
				Pinyin: "",
			})
			added++
		}
	}

	if added > 0 {
		data, _ := json.MarshalIndent(h.bank, "", "  ")
		os.WriteFile(h.path, data, 0644)
		// 同步到客户端的 chinese_wordbank.json
		clientPath := filepath.Join("..", "app", "src", "main", "assets", "chinese_wordbank.json")
		if raw, err := os.ReadFile(clientPath); err == nil {
			var clientBank WordBank
			if json.Unmarshal(raw, &clientBank) == nil {
				for _, w := range req.Words {
					if len(w) < 2 {
						continue
					}
					exists := false
					for _, existing := range clientBank.Words {
						if existing.Text == w {
							exists = true
							break
						}
					}
					if !exists {
						clientBank.Words = append(clientBank.Words, WordBankEntry{
							Text:   w,
							Tags:   []string{"LLM生成", "词语"},
							Type:   "word",
							Pinyin: "",
						})
					}
				}
				clientData, _ := json.MarshalIndent(clientBank, "", "  ")
				os.WriteFile(clientPath, clientData, 0644)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"added": added, "total_words": len(h.bank.Words)})
}

func parseInt(s string, defaultVal int) int {
	if s == "" {
		return defaultVal
	}
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return defaultVal
		}
		n = n*10 + int(c-'0')
	}
	return n
}
