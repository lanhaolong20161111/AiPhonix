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
    """腾讯云智聆 SOE 语音评测（WebSocket 直连，与 Go 版签名算法一致）

    注意：腾讯 SOE 单次评测的 refText 有字数上限（中文整句约 60 字），
    一次评测对应一段独立音频。整段朗读需在客户端逐句录音评测。
    """

    def __init__(self, app_id: str, secret_id: str, secret_key: str):
        self.app_id = app_id
        self.secret_id = secret_id
        self.secret_key = secret_key

    @staticmethod
    def _resolve_eval_mode(scene: str, eval_mode: str, ref_text: str, is_zh: bool) -> tuple[str, int]:
        """解析评测模式，返回 (腾讯 eval_mode, 对应 refText 长度上限)。

        优先级：scene（被测对象类型）> eval_mode（兼容旧调用）> 自动判断。
        腾讯 SOE eval_mode 枚举：
          0=单词/单字（中文限 1 汉字 / 英文限 1 词，返回音素明细）
          1=句子（中文 ≤30 字 / 英文 ≤30 词，返回单词+音素）
          2=段落（中文 ≤120 字 / 英文 ≤120 词，只返回单词级，无音素）
          8=拼音（≤30 拼音，声调 ≤4，返回音素）
        """
        # 1) scene 明确指定（推荐，前端按被测对象类型传入）
        if scene:
            mapping = {
                "word": ("0", 30),       # 单字/单词
                "sentence": ("1", 120),  # 句子
                "paragraph": ("2", 120), # 段落
                "pinyin": ("8", 30),     # 拼音
            }
            m = mapping.get(scene)
            if m:
                return m

        # 2) 兼容旧 eval_mode 参数
        if eval_mode == "8":
            return "8", 30
        if eval_mode in ("0", "1", "2"):
            return eval_mode, {"0": 30, "1": 120, "2": 120}.get(eval_mode, 120)

        # 3) 未指定 → 自动判断（按被测对象类型）
        if is_zh:
            # 中文按汉字数
            char_count = len([c for c in ref_text if "\u4e00" <= c <= "\u9fff"])
            if char_count <= 1:
                return "0", 1
            if char_count <= 30:
                return "1", 120
            return "2", 120
        else:
            # 英文按空格分词数
            words = [w for w in ref_text.replace(",", " ").replace(".", " ").split() if w]
            if len(words) == 1:
                return "0", 30
            if len(words) <= 30:
                return "1", 30
            return "2", 120

    def evaluate(self, ref_text: str, audio_base64: str, engine: str = "", eval_mode: str = "", scene: str = "") -> dict:
        """语音评测，返回与 Go 版一致的 JSON 结构。

        评测模式由「被测对象类型」scene 决定（腾讯 SOE eval_mode 枚举）：
          - scene="word"      → eval_mode=0 单词/单字（返回音素明细 PhoneInfo）
          - scene="sentence"  → eval_mode=1 句子（返回单词+音素明细）
          - scene="paragraph" → eval_mode=2 段落（只返回单词级）
          - scene="pinyin"    → eval_mode=8 拼音（返回音素明细）
        未传 scene 时按 ref_text 自动判断（单个单词/字→word，多词→sentence，长文→paragraph）。

        关键：**必须按被测对象类型选对模式**，否则腾讯不返回对应粒度的明细
        （尤其段落模式无音素 PhoneInfo）。
        """
        # --- 参数准备 ---
        if not engine:
            if scene == "pinyin":
                # 拼音评测必须用中文引擎（refText 是拼音如 "sang4"，无中文，别误判成英文）
                engine = "16k_zh"
            else:
                engine = "16k_zh" if any("\u4e00" <= c <= "\u9fff" for c in ref_text) else "16k_en"
        logger.info("[SOE] engine=%s scene=%s eval_mode=%s", engine, scene or "auto", eval_mode or "-")

        is_zh = engine == "16k_zh"

        # ── 评测模式解析：scene > eval_mode > 自动 ──
        eval_mode_val, max_ref_len = self._resolve_eval_mode(scene, eval_mode, ref_text, is_zh)

        if len(ref_text) > max_ref_len:
            ref_text = ref_text[:max_ref_len]
            logger.info("[SOE] refText 超长，截断至 %d 字符", max_ref_len)

        eval_mode = eval_mode_val

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
            # 必须为 1 才会返回单词/音素级明细（Words → PhoneInfos），
            # 0 时只返回总分，Web/Android 端无法展示逐音素评分。
            "sentence_info_enabled": "1",
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

        logger.info("[SOE] 连接 WebSocket: %s (ref_len=%d, eval_mode=%s)", voice_id, len(ref_text), eval_mode)

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
        except RuntimeError as e:
            logger.error("[SOE] 评测失败: %s", e)
            raise
        except Exception as e:
            logger.error("[SOE] WebSocket 错误: %s", e)
            raise RuntimeError(f"SOE WebSocket 错误: {e}") from e
        finally:
            ws.close()

        if not result:
            raise RuntimeError("SOE 评测无返回结果")

        # 调试：打印原始结构（确认 SentenceResults / PhoneInfos 嵌套）
        logger.info("[SOE] 原始结果 keys: %s", list(result.keys()))
        for k in result.keys():
            v = result.get(k)
            if isinstance(v, list) and v:
                logger.info("[SOE]   %s: list[%d] first=%s", k, len(v), str(v[0])[:400])

        # --- 转换结果格式 ---
        words = []
        for w in result.get("Words", []):
            # 中文声调（RefTone/HypothesisTone，或嵌套在 Tone 对象中）
            tone = None
            t = w.get("Tone")
            if isinstance(t, dict):
                tone = {"ref": t.get("RefTone"), "hyp": t.get("HypothesisTone")}
            elif w.get("RefTone") is not None or w.get("HypothesisTone") is not None:
                tone = {"ref": w.get("RefTone"), "hyp": w.get("HypothesisTone")}

            # 兼容两种字段名：PhoneInfos（复数，部分模式） / PhoneInfo（单词模式，文档示例用单数）
            phone_items = w.get("PhoneInfos", []) or w.get("PhoneInfo", [])
            if not isinstance(phone_items, list):
                phone_items = []
            phones = [
                {
                    # 单词模式音素字段可能是 Phone / RefPhone / ReferencePhone / Word
                    "phone": p.get("Phone", "") or p.get("Word", "") or p.get("RefPhone", "") or "",
                    "reference_phone": p.get("ReferencePhone", "") or p.get("RefPhone", "") or "",
                    "accuracy": p.get("PronAccuracy", 0.0),
                    "match_tag": p.get("MatchTag", 0),
                }
                for p in phone_items
                if isinstance(p, dict)
            ]
            words.append({
                "word": w.get("ReferenceWord", "").split("_")[0] if w.get("ReferenceWord") else w.get("Word", ""),
                "accuracy": w.get("PronAccuracy", 0.0),
                "match_tag": w.get("MatchTag", 0),
                "tone": tone,
                "phone_infos": phones,
            })

        return {
            "engine": engine,
            "eval_mode": eval_mode,
            "pron_accuracy": result.get("PronAccuracy", 0.0),
            "pron_fluency": result.get("PronFluency", 0.0),
            "pron_completion": result.get("PronCompletion", 0.0),
            "suggested_score": result.get("SuggestedScore", 0.0),
            "words": words,
        }

    def close(self):
        pass
