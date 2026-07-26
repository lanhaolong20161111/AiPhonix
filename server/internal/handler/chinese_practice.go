package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"ai-server/config"
	"ai-server/internal/service"

	"github.com/gin-gonic/gin"
)

// CharInfo 汉字完整信息
type CharInfo struct {
	Char         string   `json:"char"`
	Radical      string   `json:"radical"`
	Decomposition []string `json:"decomposition"`
	StrokeCount  int      `json:"stroke_count"`
	Structure    string   `json:"structure"`
	Words        []string `json:"words"`
}

// WordInfoHandler 汉字信息 — 优先从 char_info.json 静态返回，不调 LLM
func WordInfoHandler(cfg *config.Config) gin.HandlerFunc {
	// 加载 char_info.json
	charMap := loadCharInfo(filepath.Join("data", "char_info.json"))
	// 加载拼音数据
	pinyinMap := loadPinyinMap(filepath.Join("..", "app", "src", "main", "assets", "chinese_wordbank.json"))
	svc := service.NewDeepSeekService(&cfg.DeepSeek)

	return func(c *gin.Context) {
		var req struct {
			Char string `json:"char" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请提供 char 字段"})
			return
		}

		// 1. 查静态数据
		if info, ok := charMap[req.Char]; ok {
			// 生成例句（需要 LLM，因为需要动态造自然句子）
			sentence := ""
			prompt := fmt.Sprintf(`为汉字"%s"造一个不超过12字的简单句子，适合小学生理解。
只输出JSON：{"sentence": "句子"}`, req.Char)
			reply, err := svc.Chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "word_info")
			if err == nil {
				// 尝试解析 JSON
				var res struct {
					Sentence string `json:"sentence"`
				}
				if err := json.Unmarshal([]byte(reply), &res); err == nil {
					sentence = res.Sentence
				}
			}
			if sentence == "" {
				// fallback: 从组词里造一个简单的
				if len(info.Words) > 0 {
					sentence = fmt.Sprintf("我们来学习 %s 这个字。", req.Char)
				} else {
					sentence = fmt.Sprintf("这是汉字 %s。", req.Char)
				}
			}

			// 拼音信息
			var pinyinInfo *service.PinyinInfo
			if raw, ok := pinyinMap[req.Char]; ok {
				pi, err := service.ParsePinyin(raw)
				if err == nil {
					pinyinInfo = pi
				}
			}

			c.JSON(200, gin.H{
				"char":          info.Char,
				"radical":       info.Radical,
				"decomposition":  info.Decomposition,
				"stroke_count":  info.StrokeCount,
				"structure":     info.Structure,
				"words":         info.Words,
				"sentence":      sentence,
				"pinyin":        pinyinInfo,
				"source":        "local",
			})
			return
		}

		// 2. fallback：本地没有 → 调 LLM
		prompt := fmt.Sprintf(`你是一位小学语文教学专家。请为汉字"%s"返回以下信息，只输出JSON：
{
  "char": "%s",
  "radical": "偏旁部首",
  "stroke_count": 笔画数,
  "structure": "结构",
  "words": ["组词1", "组词2", "组词3"],
  "sentence": "包含该字的简单例句(不超过12字)"
}`, req.Char, req.Char)

		reply, err := svc.Chat("你是一个只输出JSON的语文教学助手。", prompt, 2000, "word_info_batch")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"char":   req.Char,
			"raw":    reply,
			"source": "llm",
		})
	}
}

// SentenceGenerateHandler 用指定词造句（优先查缓存，没有再调 LLM）
func SentenceGenerateHandler(cfg *config.Config) gin.HandlerFunc {
	svc := service.NewDeepSeekService(&cfg.DeepSeek)
	sentenceCache := loadSentenceCache()

	return func(c *gin.Context) {
		var req struct {
			Word     string `json:"word" binding:"required"`
			Grade    string `json:"grade"`
			HideWord bool   `json:"hide_word"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请提供 word 字段"})
			return
		}

		// 先查缓存
		if cached, ok := sentenceCache[req.Word]; ok && cached.Sentence != "" {
			reply := fmt.Sprintf(`{"sentence":"%s"}`, cached.Sentence)
			c.JSON(200, gin.H{
				"word":          req.Word,
				"raw":           reply,
				"grade":         cached.Grade,
				"target_hidden": req.HideWord,
				"source":        "cache",
			})
			return
		}

		// 缓存没有，调 LLM
		gradeDesc := req.Grade
		if gradeDesc == "" {
			gradeDesc = "小学"
		}

		hideDesc := ""
		if req.HideWord {
			hideDesc = fmt.Sprintf("注意：句子中不要直接出现\"%s\"这个词，用“___”代替。", req.Word)
		}

		prompt := fmt.Sprintf(`请为%s学生用词语"%s"造一个简单易懂的句子。
要求：
- 句子长度不超过15个字
- 适合%s学生的理解水平
- 句子自然通顺
%s
只输出JSON，格式：{"sentence": "句子"}`,
			gradeDesc, req.Word, gradeDesc, hideDesc)

		reply, err := svc.Chat("你是一个只输出JSON的小学语文造句助手。", prompt, 1000, "sentence_gen")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"word":          req.Word,
			"raw":           reply,
			"grade":         req.Grade,
			"target_hidden": req.HideWord,
			"source":        "llm",
		})
	}
}

// loadCharInfo 从 JSON 文件加载汉字信息
func loadCharInfo(path string) map[string]*CharInfo {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("⚠️ 无法加载 char_info.json: %v", err)
		return map[string]*CharInfo{}
	}

	var list []*CharInfo
	if err := json.Unmarshal(data, &list); err != nil {
		log.Printf("⚠️ 解析 char_info.json 失败: %v", err)
		return map[string]*CharInfo{}
	}

	m := make(map[string]*CharInfo, len(list))
	for _, info := range list {
		m[info.Char] = info
	}
	log.Printf("✅ 已加载 %d 个汉字信息 (char_info.json)", len(list))
	return m
}

// loadPinyinMap 从 chinese_wordbank.json 加载拼音映射
func loadPinyinMap(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("⚠️ 无法加载拼音数据: %v", err)
		return map[string]string{}
	}

	var bank struct {
		Chars []struct {
			Text   string `json:"text"`
			Pinyin string `json:"pinyin"`
		} `json:"chars"`
	}
	if err := json.Unmarshal(data, &bank); err != nil {
		log.Printf("⚠️ 解析拼音数据失败: %v", err)
		return map[string]string{}
	}

	m := make(map[string]string, len(bank.Chars))
	for _, c := range bank.Chars {
		if c.Pinyin != "" {
			m[c.Text] = c.Pinyin
		}
	}
	log.Printf("✅ 已加载 %d 个汉字拼音", len(m))
	return m
}

// PolyphoneData 多音字数据结构
type PolyphoneData struct {
	Version     int    `json:"version"`
	Description string `json:"description"`
	Chars       map[string]PolyphoneChar `json:"chars"`
}

type PolyphoneChar struct {
	Pronunciations []string            `json:"pronunciations"`
	Words          map[string][]string `json:"words"`
	Primary        string              `json:"primary"`
}

// PolyphoneHandler 返回多音字数据
func PolyphoneHandler() gin.HandlerFunc {
	var data *PolyphoneData
	path := filepath.Join("data", "polyphone_chars.json")

	return func(c *gin.Context) {
		if data == nil {
			raw, err := os.ReadFile(path)
			if err != nil {
				log.Printf("⚠️ 无法加载 polyphone_chars.json: %v", err)
				c.JSON(500, gin.H{"error": "多音字数据未就绪"})
				return
			}
			if err := json.Unmarshal(raw, &data); err != nil {
				log.Printf("⚠️ 解析 polyphone_chars.json 失败: %v", err)
				c.JSON(500, gin.H{"error": "多音字数据解析失败"})
				return
			}
			log.Printf("✅ 已加载 %d 个多音字数据", len(data.Chars))
		}
		c.JSON(200, data)
	}
}

// SentenceCacheItem 句子缓存
type SentenceCacheItem struct {
	Sentence string `json:"sentence"`
	Grade    string `json:"grade"`
}

func loadSentenceCache() map[string]SentenceCacheItem {
	data, err := os.ReadFile(filepath.Join("data", "word_sentences.json"))
	if err != nil {
		return map[string]SentenceCacheItem{}
	}
	var cache map[string]SentenceCacheItem
	if err := json.Unmarshal(data, &cache); err != nil {
		log.Printf("⚠️ 解析 word_sentences.json 失败: %v", err)
		return map[string]SentenceCacheItem{}
	}
	log.Printf("✅ 已加载 %d 条句子缓存", len(cache))
	return cache
}

func saveSentenceCache(cache map[string]SentenceCacheItem) {
	data, _ := json.MarshalIndent(cache, "", "  ")
	os.WriteFile(filepath.Join("data", "word_sentences.json"), data, 0644)
}

// SentenceBatchSaveHandler 批量保存句子缓存
func SentenceBatchSaveHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Sentences map[string]SentenceCacheItem `json:"sentences" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请提供 sentences 字段"})
			return
		}
		cache := loadSentenceCache()
		added := 0
		for word, item := range req.Sentences {
			if item.Sentence != "" {
				cache[word] = item
				added++
			}
		}
		saveSentenceCache(cache)
		c.JSON(200, gin.H{"added": added, "total": len(cache)})
	}
}
