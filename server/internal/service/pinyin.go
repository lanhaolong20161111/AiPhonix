package service

import (
	"fmt"
	"strings"
)

// PinyinInfo 拼音拆分结果
type PinyinInfo struct {
	Original  string `json:"original"`  // 原始拼音如 hao3
	Initial   string `json:"initial"`   // 声母 h
	Medial    string `json:"medial"`    // 介母 i/u/ü（如 xiǎo 的 i）
	Final     string `json:"final"`     // 韵母 ao
	Tone      int    `json:"tone"`      // 声调 1-5 (5=轻声)
	Display   string `json:"display"`   // 带声调符号的拼音 hǎo
	IsOverall bool   `json:"is_overall"`// 是否整体认读音节
}

// 声母表
var initials = []string{"zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
	"g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"}

// 整体认读音节
var wholeSyllables = map[string]bool{
	"zhi": true, "chi": true, "shi": true, "ri": true, "zi": true, "ci": true, "si": true,
	"yi": true, "wu": true, "yu": true, "ye": true, "yue": true, "yuan": true,
	"yin": true, "yun": true, "ying": true,
}

// 声调符号映射
var toneMarks = map[string][5]string{
	"a": {"ā", "á", "ǎ", "à", "a"},
	"o": {"ō", "ó", "ǒ", "ò", "o"},
	"e": {"ē", "é", "ě", "è", "e"},
	"i": {"ī", "í", "ǐ", "ì", "i"},
	"u": {"ū", "ú", "ǔ", "ù", "u"},
	"ü": {"ǖ", "ǘ", "ǚ", "ǜ", "ü"},
}

// ParsePinyin 解析拼音字符串
// 输入: pinyin 如 "hao3", "zhong1", "lv4", "yi1"
// 输出: 解析后的 PinyinInfo
func ParsePinyin(pinyin string) (*PinyinInfo, error) {
	pinyin = strings.TrimSpace(strings.ToLower(pinyin))
	if pinyin == "" {
		return nil, fmt.Errorf("空拼音")
	}

	// 分离声调数字
	tone, body := extractTone(pinyin)

	// 检查整体认读音节
	isOverall := wholeSyllables[body]

	// 分离声母、介母、韵母
	init, medial, fin := splitPinyin(body)

	return &PinyinInfo{
		Original:  pinyin,
		Initial:   init,
		Medial:    medial,
		Final:     fin,
		Tone:      tone,
		Display:   applyToneMark(init+medial+fin, tone),
		IsOverall: isOverall,
	}, nil
}

// extractTone 提取声调数字，返回 (tone, body)
func extractTone(pinyin string) (int, string) {
	if len(pinyin) == 0 {
		return 0, pinyin
	}
	last := pinyin[len(pinyin)-1]
	if last >= '1' && last <= '5' {
		return int(last - '0'), pinyin[:len(pinyin)-1]
	}
	return 0, pinyin
}

// splitPinyin 分离声母、介母、韵母
// 例: xiao → x, i, ao | guo → g, u, o | hao → h, "", ao | an → "", "", an
func splitPinyin(body string) (initial, medial, final string) {
	if body == "" {
		return "", "", ""
	}

	// 零声母 y/w + an/ang/ao 等（yan→i+an, wan→u+an, yang→i+ang, wang→u+ang）
	// 范围: y + (a/ao/an/ang) → i + (a/ao/an/ang)
	//       w + (a/o/an/ang/ai/ei/en/eng) → u + (a/o/an/ang/ai/ei/en/eng)
	// 不包含整体认读音节（yi/wu/yu/ye/yue/yuan/yin/yun/ying）
	if !wholeSyllables[body] && len(body) > 1 {
		first := body[0]
		if first == 'y' || first == 'w' {
			converted := "i" + body[1:] // y → i
			if first == 'w' {
				converted = "u" + body[1:] // w → u
			}
			m, f := splitMedial(converted)
			return "", m, f
		}
	}

	// 1. 提取声母
	for _, init := range initials {
		if strings.HasPrefix(body, init) {
			rest := strings.TrimPrefix(body, init)
			if rest == "" {
				return init, "", "" // 仅声母
			}
			// 2. 检查介母
			m, f := splitMedial(rest)
			return init, m, f
		}
	}

	// 零声母：检查介母
	m, f := splitMedial(body)
	return "", m, f
}

// splitMedial 从韵母中分离介母（小学标准规则）
// 三拼音节才有介母：声母 + 介母(i/u/ü) + 韵母
//
// 介母 i 可搭配: a, ao, an, ang, ong  → xia, xiao, xian, xiang, jiong
// 介母 u 可搭配: a, ai, an, ang, o    → hua, huai, huan, huang, huo
// 介母 ü 可搭配: an, ong（仅 j/q/x/y）→ juan, quan, xuan, yong
//
// 不是介母的情况（两拼音节，整体当复韵母）:
//   iu → 复韵母（liu, niu — i 不是介母）
//   ui → 复韵母（gui, hui — u 不是介母）
//   ie, ei, ai, ao, ou → 复韵母，中间字母不算介母
func splitMedial(rest string) (medial, final string) {
	if rest == "" {
		return "", ""
	}
	first := string(rest[0])
	switch first {
	case "i":
		// i + a/ao/an/ang/ong → 三拼音，i 是介母
		if hasPrefix(rest, []string{"iong", "iang", "iao", "ian", "ia"}) {
			return "i", rest[1:]
		}
	case "u":
		// u + a/ai/an/ang/o → 三拼音，u 是介母
		if hasPrefix(rest, []string{"uang", "uai", "uan", "uo", "ua"}) {
			return "u", rest[1:]
		}
	case "v":
		// ü + an/ong → 三拼音（仅 j/q/x/y），ü 是介母
		if hasPrefix(rest, []string{"van", "vong"}) {
			return "v", rest[1:]
		}
	}
	return "", rest
}

// hasPrefix 检查字符串是否以列表中某一项开头（最长匹配优先）
func hasPrefix(s string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

// applyToneMark 在正确的元音上标注声调
func applyToneMark(pinyin string, tone int) string {
	if tone < 1 || tone > 5 {
		return pinyin
	}
	if tone == 5 {
		return pinyin // 轻声不标调
	}

	// 找到标调的元音（优先级: a > o > e > i/u 并列标在后）
	vowelPos := findTonePosition(pinyin)
	if vowelPos < 0 {
		return pinyin
	}

	ch := string(pinyin[vowelPos])
	vowelForTone := ch
	// 处理 ü (出现在 lü, nü)
	if ch == "v" {
		vowelForTone = "ü"
	}

	if marks, ok := toneMarks[vowelForTone]; ok {
		idx := tone - 1
		if idx >= 0 && idx < len(marks) {
			return pinyin[:vowelPos] + marks[idx] + pinyin[vowelPos+1:]
		}
	}
	return pinyin
}

// findTonePosition 找到标调元音的位置
func findTonePosition(pinyin string) int {
	// 元音优先级: a > o > e > (i, u 并列标在后)
	// 先标准化 ü 为 v
	pinyin = strings.ReplaceAll(pinyin, "ü", "v")

	var aPos, oPos, ePos int = -1, -1, -1
	var iPos, uPos int = -1, -1

	for idx, ch := range pinyin {
		switch ch {
		case 'a':
			aPos = idx
		case 'o':
			oPos = idx
		case 'e':
			ePos = idx
		case 'i':
			iPos = idx
		case 'u':
			uPos = idx
		case 'v':
			// ü 按 u 处理
			if uPos < 0 {
				uPos = idx
			}
		}
	}

	// a > o > e
	if aPos >= 0 {
		return aPos
	}
	if oPos >= 0 {
		return oPos
	}
	if ePos >= 0 {
		return ePos
	}
	// i/u 并列标在后
	if iPos >= 0 && uPos >= 0 {
		if uPos > iPos {
			return uPos
		}
		return iPos
	}
	if iPos >= 0 {
		return iPos
	}
	if uPos >= 0 {
		return uPos
	}
	return -1
}
