package service

import (
	"encoding/json"
	"log"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// CharRecord 单个字的练习记录
type CharRecord struct {
	Char                   string    `json:"char"`
	PinyinCorrect         int       `json:"pinyin_correct"`      // 拼音正确次数
	PinyinWrong           int       `json:"pinyin_wrong"`        // 拼音错误次数
	PronunciationCorrect  int       `json:"pronunciation_correct"` // 读音正确次数
	PronunciationWrong    int       `json:"pronunciation_wrong"`   // 读音错误次数
	ConsecutiveCorrect    int       `json:"consecutive_correct"`   // 连续完全正确次数
	LastSeen              time.Time `json:"last_seen"`
	LastCorrect           bool      `json:"last_correct"`
}

// PracticeTracker 练习追踪器
type PracticeTracker struct {
	mu       sync.RWMutex
	records  map[string]*CharRecord
	filePath string
}

// NewPracticeTracker 创建追踪器，从磁盘加载已有记录
func NewPracticeTracker(dataDir string) *PracticeTracker {
	path := filepath.Join(dataDir, "char_practice.json")
	t := &PracticeTracker{
		records:  make(map[string]*CharRecord),
		filePath: path,
	}
	t.load()
	return t
}

func (t *PracticeTracker) load() {
	data, err := os.ReadFile(t.filePath)
	if err != nil {
		log.Printf("[PracticeTracker] 无历史记录文件: %v", err)
		return
	}
	var list []*CharRecord
	if err := json.Unmarshal(data, &list); err != nil {
		log.Printf("[PracticeTracker] 解析失败: %v", err)
		return
	}
	for _, r := range list {
		t.records[r.Char] = r
	}
	log.Printf("[PracticeTracker] 已加载 %d 条练习记录", len(list))
}

func (t *PracticeTracker) save() {
	os.MkdirAll(filepath.Dir(t.filePath), 0755)
	list := make([]*CharRecord, 0, len(t.records))
	for _, r := range t.records {
		list = append(list, r)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		log.Printf("[PracticeTracker] 序列化失败: %v", err)
		return
	}
	if err := os.WriteFile(t.filePath, data, 0644); err != nil {
		log.Printf("[PracticeTracker] 保存失败: %v", err)
	}
}

// RecordResult 记录一次练习结果（type: "pinyin" / "pronunciation"）
func (t *PracticeTracker) RecordResult(char, recordType string, correct bool) {
	t.mu.Lock()
	defer t.mu.Unlock()

	r := t.records[char]
	if r == nil {
		r = &CharRecord{Char: char}
		t.records[char] = r
	}

	r.LastSeen = time.Now()
	if correct {
		switch recordType {
		case "pinyin":
			r.PinyinCorrect++
		case "pronunciation":
			r.PronunciationCorrect++
		}
	} else {
		switch recordType {
		case "pinyin":
			r.PinyinWrong++
		case "pronunciation":
			r.PronunciationWrong++
		}
	}
	// 只有两项都正确才算连续正确
	r.LastCorrect = (r.PinyinCorrect+r.PronunciationCorrect > r.PinyinWrong+r.PronunciationWrong)
	if r.LastCorrect {
		r.ConsecutiveCorrect++
	} else {
		r.ConsecutiveCorrect = 0
	}
	t.save()
}

// GetWeight 计算一个字的选择权重
// 错误越多权重越高，正确次数多且连续正确则权重降低
func (t *PracticeTracker) GetWeight(char string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()

	r, ok := t.records[char]
	if !ok {
		return 1.0 // 新字：中等权重
	}

	// 基础权重
	weight := 1.0

	// 每次错误 +0.3（拼音+读音合计）
	totalWrong := r.PinyinWrong + r.PronunciationWrong
	weight += float64(totalWrong) * 0.3

	// 连续正确降低权重
	if r.ConsecutiveCorrect > 0 {
		weight -= math.Min(float64(r.ConsecutiveCorrect)*0.15, 0.7)
	}

	// 长时间没出现增加权重（超过7天）
	daysSinceLastSeen := time.Since(r.LastSeen).Hours() / 24
	if daysSinceLastSeen > 7 {
		weight += math.Min(daysSinceLastSeen*0.02, 0.5)
	}

	return math.Max(weight, 0.1)
}

// GetAllWeights 获取所有字的权重映射
func (t *PracticeTracker) GetAllWeights(chars []string) map[string]float64 {
	result := make(map[string]float64, len(chars))
	for _, c := range chars {
		result[c] = t.GetWeight(c)
	}
	return result
}
