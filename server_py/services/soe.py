"""腾讯云智聆 SOE 语音评测 — 原生 WebSocket 实现（与 Go 版对齐）"""

import hashlib
import hmac
import json
import logging
import base64
import os
import time
import urllib.parse
import uuid

import websocket

logger = logging.getLogger(__name__)


class TencentSOEService:
    """腾讯云智聆 SOE 语音评测（WebSocket 直连，与 Go 版签名算法一致）"""

    def __init__(self, app_id: str, secret_id: str, secret_key: str):
        self.app_id = app_id
        self.secret_id = secret_id
        self.secret_key = secret_key

    def evaluate(self, ref_text: str, audio_base64: str, engine: str = "") -> dict:
        """语音评测，返回与 Go 版一致的 JSON 结构"""

        # --- 参数准备 ---
        if not engine:
            engine = "16k_zh" if any("\u4e00" <= c <= "\u9fff" for c in ref_text) else "16k_en"
        logger.info("[SOE] engine=%s app_id=%s secret_id=%s", engine, self.app_id, self.secret_id[:12] + "...")

        max_ref_len = 180
        if len(ref_text) > max_ref_len:
            ref_text = ref_text[:max_ref_len]
            logger.info("[SOE] refText 截断至 %d 字符", max_ref_len)

        eval_mode = "0"
        if " " in ref_text:
            eval_mode = "1"

        voice_id = str(uuid.uuid4())
        ts = str(int(time.time()))

        # --- 构建请求参数（与 Go 版完全一致） ---
        params = {
            "secretid": self.secret_id,
            "timestamp": ts,
            "expired": str(int(time.time()) + 86400),
            "nonce": ts,
            "voice_id": voice_id,
            "voice_format": "1",
            "text_mode": "0",
            "ref_text": ref_text,
            "keyword": "",
            "eval_mode": eval_mode,
            "score_coeff": "1.0",
            "server_engine_type": engine,
            "sentence_info_enabled": "0",
            "rec_mode": "1",
        }

        # 按 key 排序（同 Go 的 sort.Strings）
        keys = sorted(params.keys())

        # 原始查询字符串（用于签名，不 URL 编码）
        raw_parts = [f"{k}={params[k]}" for k in keys]
        raw_query = "&".join(raw_parts)

        # 签名字符串
        sign_str = f"soe.cloud.tencent.com/soe/api/{self.app_id}?{raw_query}"

        # HMAC-SHA1
        mac = hmac.new(self.secret_key.encode("utf-8"), sign_str.encode("utf-8"), hashlib.sha1)
        signature = base64.b64encode(mac.digest()).decode("utf-8")

        # 标准 URL 编码的查询字符串
        uv = urllib.parse.urlencode([(k, params[k]) for k in keys])
        ws_url = f"wss://soe.cloud.tencent.com/soe/api/{self.app_id}?{uv}&signature={urllib.parse.quote(signature, safe='')}"

        logger.info("[SOE] 连接 WebSocket: %s", voice_id)
        logger.info("[SOE] URL: %s", ws_url[:120] + "...")

        # --- WebSocket 通信 ---
        audio_data = base64.b64decode(audio_base64)
        result = None

        try:
            ws = websocket.create_connection(ws_url, timeout=30)
        except Exception as e:
            raise RuntimeError(f"WebSocket 连接失败: {e}") from e

        try:
            # 1. 读握手响应
            msg = ws.recv()
            handshake = json.loads(msg)
            if handshake.get("code", -1) != 0:
                raise RuntimeError(
                    f"SOE 握手失败: code={handshake.get('code')} msg={handshake.get('message')}"
                )
            logger.info("[SOE] 握手成功")

            # 2. 发送音频（rec_mode=1：一次发完）
            ws.send_binary(audio_data)
            logger.info("[SOE] 音频已发送 (%d bytes)", len(audio_data))

            # 3. 发送结束标记
            ws.send(json.dumps({"type": "end"}))
            logger.info("[SOE] 结束标记已发送，等待结果...")

            # 4. 读取最终结果
            while True:
                msg = ws.recv()
                resp = json.loads(msg)
                if resp.get("code", -1) != 0:
                    raise RuntimeError(
                        f"SOE 服务端错误: code={resp.get('code')} msg={resp.get('message')}"
                    )
                if resp.get("final") == 1:
                    result = resp.get("result", {})
                    break
        except websocket.WebSocketTimeoutException:
            raise TimeoutError("SOE 评测超时（30 秒）")
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"SOE WebSocket 错误: {e}") from e
        finally:
            ws.close()

        if not result:
            raise RuntimeError("SOE 评测无返回结果")

        # --- 转换结果格式 ---
        words = []
        for w in result.get("Words", []):
            phones = [
                {"phone": p.get("Phone", ""), "accuracy": p.get("PronAccuracy", 0.0)}
                for p in w.get("PhoneInfos", [])
            ]
            words.append({
                "word": w.get("ReferenceWord", ""),
                "accuracy": w.get("PronAccuracy", 0.0),
                "match_tag": w.get("MatchTag", 0),
                "phone_infos": phones,
            })

        return {
            "pron_accuracy": result.get("PronAccuracy", 0.0),
            "pron_fluency": result.get("PronFluency", 0.0),
            "pron_completion": result.get("PronCompletion", 0.0),
            "suggested_score": result.get("SuggestedScore", 0.0),
            "words": words,
        }
