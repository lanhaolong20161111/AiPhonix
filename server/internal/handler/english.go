package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// EnglishVocabularyHandler 返回英语词汇表
func EnglishVocabularyHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := os.ReadFile(filepath.Join("data", "english_vocabulary.json"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "词汇数据未找到"})
			return
		}
		var obj interface{}
		if err := json.Unmarshal(data, &obj); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析失败"})
			return
		}
		c.JSON(http.StatusOK, obj)
	}
}

// EnglishSentencesHandler 返回英语句子
func EnglishSentencesHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := os.ReadFile(filepath.Join("data", "english_sentences.json"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "句子数据未找到"})
			return
		}
		var obj interface{}
		if err := json.Unmarshal(data, &obj); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析失败"})
			return
		}
		c.JSON(http.StatusOK, obj)
	}
}
