"""百度 TTS 服务 — HTTP API + 服务端磁盘缓存"""

import hashlib
import json
import os
import time
from urllib.parse import urlencode

import httpx


class BaiduTTSService:
    """百度在线 TTS（带服务端磁盘缓存）"""

    TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
    TTS_URL = "https://tsn.baidu.com/text2audio"

    def __init__(self, app_id: str, api_key: str, secret_key: str, cache_dir: str = ""):
        self.app_id = app_id
        self.api_key = api_key
        self.secret_key = secret_key
        self.client = httpx.Client(timeout=30.0)
        self._token: str = ""
        self._token_exp: float = 0  # unix timestamp
        self.cache_dir = cache_dir
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

    def _get_access_token(self) -> str:
        if self._token and time.time() < self._token_exp:
            return self._token

        params = {
            "grant_type": "client_credentials",
            "client_id": self.api_key,
            "client_secret": self.secret_key,
        }
        resp = self.client.get(self.TOKEN_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

        if "error" in data:
            raise RuntimeError(f"获取百度 token 失败: {data['error']} - {data}")

        token = data.get("access_token", "")
        if not token:
            raise RuntimeError(f"获取百度 token 失败: {data}")

        self._token = token
        self._token_exp = time.time() + 25 * 3600  # 25小时
        return token

    def _cache_key(self, text: str, speaker: str, speed: int) -> str:
        raw = f"{text}|{speaker}|{speed}"
        return hashlib.md5(raw.encode()).hexdigest()

    def synthesize(self, text: str, speaker: str = "0", speed: int = 5) -> bytes:
        """文字转语音，返回 MP3 字节，带磁盘缓存"""

        # 1. 查缓存
        if self.cache_dir:
            key = self._cache_key(text, speaker, speed)
            cache_file = os.path.join(self.cache_dir, f"{key}.mp3")
            if os.path.exists(cache_file):
                with open(cache_file, "rb") as f:
                    return f.read()

        # 2. 调百度 API
        token = self._get_access_token()

        form = {
            "tex": text,
            "tok": token,
            "cuid": "aiphonix-server",
            "ctp": "1",
            "lan": "zh",
            "per": speaker or "0",
            "spd": str(max(speed, 1) if speed > 0 else 5),
            "pit": "5",
            "vol": "5",
            "aue": "3",  # MP3
        }

        # 签名
        sign_str = self.api_key + urlencode(form) + self.secret_key
        sign = hashlib.md5(sign_str.encode()).hexdigest()
        form["sign"] = sign

        resp = self.client.post(self.TTS_URL, data=form)
        content_type = resp.headers.get("content-type", "")

        if "audio/" in content_type:
            audio = resp.content
            # 写缓存
            if self.cache_dir and len(audio) > 100:
                key = self._cache_key(text, speaker, speed)
                cache_file = os.path.join(self.cache_dir, f"{key}.mp3")
                with open(cache_file, "wb") as f:
                    f.write(audio)
            return audio
        else:
            # 错误响应
            body = resp.text
            raise RuntimeError(f"百度 TTS 合成失败: {body}")

    def close(self):
        self.client.close()
