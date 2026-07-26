package service

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// BaiduTTSService 百度在线 TTS 服务（带服务端缓存）
type BaiduTTSService struct {
	appID     string
	apiKey    string
	secretKey string
	client    *http.Client
	token     string
	tokenExp  time.Time
	cacheDir  string
}

// NewBaiduTTSService 创建 TTS 服务
// cacheDir 指定服务端磁盘缓存目录，为空则不缓存
func NewBaiduTTSService(appID, apiKey, secretKey, cacheDir string) *BaiduTTSService {
	if cacheDir != "" {
		os.MkdirAll(cacheDir, 0755)
	}
	return &BaiduTTSService{
		appID:     appID,
		apiKey:    apiKey,
		secretKey: secretKey,
		client:    &http.Client{Timeout: 30 * time.Second},
		cacheDir:  cacheDir,
	}
}

func (s *BaiduTTSService) getAccessToken() (string, error) {
	if s.token != "" && time.Now().Before(s.tokenExp) {
		return s.token, nil
	}
	u := fmt.Sprintf("https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=%s&client_secret=%s",
		s.apiKey, s.secretKey)
	resp, err := s.client.Get(u)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	// 用 JSON 解析代替脆弱的 Sscanf
	var tokenResp struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("解析 token 响应失败: %w, body=%s", err, string(body))
	}
	if tokenResp.Error != "" {
		return "", fmt.Errorf("获取 token 失败: %s, body=%s", tokenResp.Error, string(body))
	}
	if tokenResp.AccessToken == "" {
		return "", fmt.Errorf("获取百度 token 失败: %s", string(body))
	}
	s.token = tokenResp.AccessToken
	s.tokenExp = time.Now().Add(25 * time.Hour)
	return s.token, nil
}

// Synthesize 文字转语音，返回 MP3 音频字节
// 内部自动使用服务端磁盘缓存：相同 text+speaker+speed 只调百度一次
func (s *BaiduTTSService) Synthesize(text, speaker string, speed int) ([]byte, error) {
	// 1. 尝试服务端缓存
	if s.cacheDir != "" {
		cacheKey := s.cacheKey(text, speaker, speed)
		cacheFile := filepath.Join(s.cacheDir, cacheKey+".mp3")
		if data, err := os.ReadFile(cacheFile); err == nil {
			return data, nil
		}
	}

	// 2. 调百度 API
	token, err := s.getAccessToken()
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("tex", text)
	form.Set("tok", token)
	form.Set("cuid", "aiphonix-server")
	form.Set("ctp", "1")
	form.Set("lan", "zh")
	if speaker == "" {
		speaker = "0"
	}
	form.Set("per", speaker)
	if speed <= 0 {
		speed = 5
	}
	form.Set("spd", fmt.Sprintf("%d", speed))
	form.Set("pit", "5")
	form.Set("vol", "5")
	form.Set("aue", "3") // MP3

	signStr := s.apiKey + form.Encode() + s.secretKey
	hash := md5.Sum([]byte(signStr))
	form.Set("sign", hex.EncodeToString(hash[:]))

	resp, err := s.client.Post("https://tsn.baidu.com/text2audio",
		"application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	audio, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	ct := resp.Header.Get("Content-Type")
	if strings.Contains(ct, "json") {
		return nil, fmt.Errorf("百度 TTS 返回错误: %s", string(audio))
	}

	// 3. 写入服务端缓存
	if s.cacheDir != "" && len(audio) > 100 {
		cacheKey := s.cacheKey(text, speaker, speed)
		cacheFile := filepath.Join(s.cacheDir, cacheKey+".mp3")
		os.WriteFile(cacheFile, audio, 0644)
	}

	return audio, nil
}

// cacheKey 生成缓存文件名的 MD5 摘要
func (s *BaiduTTSService) cacheKey(text, speaker string, speed int) string {
	data := fmt.Sprintf("%s|%s|%d", text, speaker, speed)
	h := md5.Sum([]byte(data))
	return hex.EncodeToString(h[:])
}
