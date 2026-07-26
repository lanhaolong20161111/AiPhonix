package main

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

func main() {
	appID := "YOUR_TENCENT_APP_ID"
	secretID := "YOUR_TENCENT_SECRET_ID"
	secretKey := "YOUR_TENCENT_SECRET_KEY"
	refText := "hello"

	voiceID := uuid.New().String()
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	expired := strconv.FormatInt(time.Now().Unix()+86400, 10)

	// Build query params (sorted)
	params := map[string]string{
		"secretid":              secretID,
		"timestamp":             ts,
		"expired":               expired,
		"nonce":                 ts,
		"voice_id":              voiceID,
		"voice_format":          "1",
		"text_mode":             "0",
		"ref_text":              refText,
		"keyword":               "",
		"eval_mode":             "0",
		"score_coeff":           "1.0",
		"server_engine_type":    "16k_en",
		"sentence_info_enabled": "0",
		"rec_mode":              "1",
	}

	var keys []string
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(params[k])
		b.WriteString("&")
	}
	rawQ := strings.TrimSuffix(b.String(), "&")

	// URL to sign
	signURL := fmt.Sprintf("soe.cloud.tencent.com/soe/api/%s?%s", appID, rawQ)
	log.Printf("signURL: %s", signURL)

	// Signature = base64(HMAC-SHA1(signURL, secretKey))
	mac := hmac.New(sha1.New, []byte(secretKey))
	mac.Write([]byte(signURL))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	log.Printf("signature: %s", sig)

	// METHOD 2: Build URL WITHOUT the leading ? hack
	// Encode each value individually and assemble a standard query string
	uv := url.Values{}
	for _, k := range keys {
		uv.Set(k, params[k])
	}
	stdQuery := uv.Encode()
	finalURL := fmt.Sprintf("wss://soe.cloud.tencent.com/soe/api/%s?%s&signature=%s",
		appID, stdQuery, url.QueryEscape(sig))
	log.Printf("Method2 URL: %s", finalURL[:300])

	conn, _, err := websocket.DefaultDialer.Dial(finalURL, nil)
	if err != nil {
		log.Printf("Method2 Dial failed: %v", err)
	} else {
		defer conn.Close()
		_, data, _ := conn.ReadMessage()
		var msg struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		json.Unmarshal(data, &msg)
		log.Printf("Method2 Result: code=%d msg=%s", msg.Code, msg.Message)
	}

	// METHOD 3: Don't url-encode at all (raw query)
	rawURL := fmt.Sprintf("wss://soe.cloud.tencent.com/soe/api/%s?%s&signature=%s",
		appID, rawQ, url.QueryEscape(sig))
	log.Printf("Method3 URL: %s", rawURL[:300])

	conn2, _, err2 := websocket.DefaultDialer.Dial(rawURL, nil)
	if err2 != nil {
		log.Printf("Method3 Dial failed: %v", err2)
	} else {
		defer conn2.Close()
		_, data, _ := conn2.ReadMessage()
		var msg struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		json.Unmarshal(data, &msg)
		log.Printf("Method3 Result: code=%d msg=%s", msg.Code, msg.Message)
	}
}
