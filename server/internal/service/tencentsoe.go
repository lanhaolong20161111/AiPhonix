package service

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// TencentSOEService 腾讯云智聆 SOE 语音评测（直接 WebSocket 实现，绕过 SDK URL 编码 BUG）
type TencentSOEService struct {
	appID     string
	secretID  string
	secretKey string
}

func NewTencentSOEService(appID, secretID, secretKey string) *TencentSOEService {
	return &TencentSOEService{appID: appID, secretID: secretID, secretKey: secretKey}
}

// SOEResult 评测结果
type SOEResult struct {
	PronAccuracy   float64      `json:"pron_accuracy"`
	PronFluency    float64      `json:"pron_fluency"`
	PronCompletion float64      `json:"pron_completion"`
	SuggestedScore float64      `json:"suggested_score"`
	Words          []WordResult `json:"words"`
}

type WordResult struct {
	Word       string        `json:"word"`
	Accuracy   float64       `json:"accuracy"`
	MatchTag   int64         `json:"match_tag"`
	PhoneInfos []PhoneResult `json:"phone_infos,omitempty"`
}

type PhoneResult struct {
	Phone    string  `json:"phone"`
	Accuracy float64 `json:"accuracy"`
}

// Evaluate 语音评测
// engine: "16k_en"(默认) / "16k_zh"
func (s *TencentSOEService) Evaluate(refText string, audioBase64 string, engine string) (*SOEResult, error) {
	audioData, err := base64.StdEncoding.DecodeString(audioBase64)
	if err != nil {
		return nil, fmt.Errorf("解码音频失败: %w", err)
	}

	// 默认引擎：根据 refText 是否含中文字符自动选择
	if engine == "" {
		engine = "16k_en"
		for _, r := range refText {
			if r >= 0x4E00 && r <= 0x9FFF {
				engine = "16k_zh"
				break
			}
		}
	}
	log.Printf("[SOE] engine=%s (auto-detected from refText)", engine)

	// 截断 refText 防止超过腾讯云限制（16k_en 最大约 200 字符）
	const maxRefLen = 180
	if len(refText) > maxRefLen {
		refText = refText[:maxRefLen]
		log.Printf("[SOE] refText 超过 %d 字符，已截断", maxRefLen)
	}

	// 根据 refText 自动选择评测模式：句子含空格用句子模式，单词用词模式
	evalMode := "0"
	if strings.Contains(refText, " ") {
		evalMode = "1"
	}

	log.Printf("[SOE] appID=%s refText=%s audioLen=%d evalMode=%s",
		s.appID, refText, len(audioData), evalMode)

	// 构建 WebSocket URL
	wsURL, err := s.buildWsURL(refText, evalMode, engine)
	if err != nil {
		return nil, fmt.Errorf("构建URL失败: %w", err)
	}

	// 连接
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("WebSocket 连接失败: %w", err)
	}
	defer conn.Close()

	// 读握手响应
	_, msgData, err := conn.ReadMessage()
	if err != nil {
		return nil, fmt.Errorf("读握手响应失败: %w", err)
	}
	var handshake struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(msgData, &handshake); err != nil {
		return nil, fmt.Errorf("解析握手响应失败: %w", err)
	}
	if handshake.Code != 0 {
		return nil, fmt.Errorf("握手失败: code=%d msg=%s", handshake.Code, handshake.Message)
	}
	log.Printf("[SOE] 握手成功")

	// 发送音频数据
	if err := conn.WriteMessage(websocket.BinaryMessage, audioData); err != nil {
		return nil, fmt.Errorf("发送音频失败: %w", err)
	}
	log.Printf("[SOE] 音频已发送 (%d bytes)", len(audioData))

	// 发送结束标记
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"end"}`)); err != nil {
		return nil, fmt.Errorf("发送结束标记失败: %w", err)
	}
	log.Printf("[SOE] 结束标记已发送，等待结果...")

	// 读取结果
	var finalResult *soeResponse
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return nil, fmt.Errorf("读结果失败: %w", err)
		}
		var resp soeResponse
		if err := json.Unmarshal(data, &resp); err != nil {
			return nil, fmt.Errorf("解析结果失败: %w", err)
		}
		if resp.Code != 0 {
			return nil, fmt.Errorf("SOE 服务端错误: code=%d msg=%s", resp.Code, resp.Message)
		}
		if resp.Final == 1 {
			finalResult = &resp
			break
		}
		// 中间结果忽略
	}

	if finalResult == nil {
		return nil, fmt.Errorf("未收到最终评测结果")
	}

	return convertResult(&finalResult.Result), nil
}

type soeResponse struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Final   int             `json:"final"`
	Result  soeSentenceInfo `json:"result"`
}

type soeSentenceInfo struct {
	SuggestedScore float64     `json:"SuggestedScore"`
	PronAccuracy   float64     `json:"PronAccuracy"`
	PronFluency    float64     `json:"PronFluency"`
	PronCompletion float64     `json:"PronCompletion"`
	Words          []soeWordRsp `json:"Words"`
}

type soeWordRsp struct {
	ReferenceWord string          `json:"ReferenceWord"`
	PronAccuracy  float64         `json:"PronAccuracy"`
	Tag           int64           `json:"MatchTag"`
	PhoneInfo     []soePhoneInfo  `json:"PhoneInfos"`
}

type soePhoneInfo struct {
	Phone       string  `json:"Phone"`
	PronAccuracy float64 `json:"PronAccuracy"`
}

// buildWsURL 构建标准 WebSocket URL
func (s *TencentSOEService) buildWsURL(refText string, evalMode string, engine string) (string, error) {
	voiceID := uuid.New().String()
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	expired := strconv.FormatInt(time.Now().Unix()+86400, 10)

	params := map[string]string{
		"secretid":              s.secretID,
		"timestamp":             ts,
		"expired":               expired,
		"nonce":                 ts,
		"voice_id":              voiceID,
		"voice_format":          "1",
		"text_mode":             "0",
		"ref_text":              refText,
		"keyword":               "",
		"eval_mode":             evalMode,
		"score_coeff":           "1.0",
		"server_engine_type":    engine,
		"sentence_info_enabled": "0",
		"rec_mode":              "1",
	}

	var keys []string
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// 构建原始查询字符串（用于签名）
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(params[k])
		b.WriteString("&")
	}
	rawQuery := strings.TrimSuffix(b.String(), "&")

	// 签名字符串
	signStr := fmt.Sprintf("soe.cloud.tencent.com/soe/api/%s?%s", s.appID, rawQuery)

	// HMAC-SHA1
	mac := hmac.New(sha1.New, []byte(s.secretKey))
	mac.Write([]byte(signStr))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	// 用 url.Values 构建标准查询字符串（每个值独立编码）
	uv := url.Values{}
	for _, k := range keys {
		uv.Set(k, params[k])
	}
	stdQuery := uv.Encode()

	wsURL := fmt.Sprintf("wss://soe.cloud.tencent.com/soe/api/%s?%s&signature=%s",
		s.appID, stdQuery, url.QueryEscape(sig))
	return wsURL, nil
}

// convertResult 转换 SDK 结果格式为对外 SOEResult
func convertResult(s *soeSentenceInfo) *SOEResult {
	if s == nil {
		return &SOEResult{}
	}
	words := make([]WordResult, 0, len(s.Words))
	for _, w := range s.Words {
		phones := make([]PhoneResult, 0, len(w.PhoneInfo))
		for _, p := range w.PhoneInfo {
			phones = append(phones, PhoneResult{Phone: p.Phone, Accuracy: p.PronAccuracy})
		}
		words = append(words, WordResult{
			Word: w.ReferenceWord, Accuracy: w.PronAccuracy,
			MatchTag: w.Tag, PhoneInfos: phones,
		})
	}
	return &SOEResult{
		PronAccuracy: s.PronAccuracy, PronFluency: s.PronFluency,
		PronCompletion: s.PronCompletion, SuggestedScore: s.SuggestedScore,
		Words: words,
	}
}
