"""练习追踪 — 按字记录练习历史与权重计算"""

import json
import logging
import math
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class CharRecord:
    char: str = ""
    pinyin_correct: int = 0
    pinyin_wrong: int = 0
    pronunciation_correct: int = 0
    pronunciation_wrong: int = 0
    consecutive_correct: int = 0
    last_seen: Optional[float] = None  # unix timestamp
    last_correct: bool = False


class PracticeTracker:
    """练习追踪器 — 线程安全，带 JSON 持久化"""

    def __init__(self, data_dir: str):
        self.file_path = os.path.join(data_dir, "char_practice.json")
        self._lock = threading.Lock()
        self._records: dict[str, CharRecord] = {}
        self._load()

    def _load(self):
        if not os.path.exists(self.file_path):
            logger.info("[PracticeTracker] 无历史记录文件")
            return
        try:
            with open(self.file_path, encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                r = CharRecord(**item)
                self._records[r.char] = r
            logger.info("[PracticeTracker] 已加载 %d 条练习记录", len(self._records))
        except Exception as e:
            logger.warning("[PracticeTracker] 加载失败: %s", e)

    def _save(self):
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)
        data = []
        for r in self._records.values():
            d = {
                "char": r.char,
                "pinyin_correct": r.pinyin_correct,
                "pinyin_wrong": r.pinyin_wrong,
                "pronunciation_correct": r.pronunciation_correct,
                "pronunciation_wrong": r.pronunciation_wrong,
                "consecutive_correct": r.consecutive_correct,
                "last_seen": r.last_seen,
                "last_correct": r.last_correct,
            }
            data.append(d)
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def record_result(self, char: str, record_type: str, correct: bool):
        """记录一次练习结果（type: "pinyin" / "pronunciation"）"""
        with self._lock:
            r = self._records.get(char)
            if r is None:
                r = CharRecord(char=char)
                self._records[char] = r

            r.last_seen = time.time()
            if correct:
                if record_type == "pinyin":
                    r.pinyin_correct += 1
                elif record_type == "pronunciation":
                    r.pronunciation_correct += 1
            else:
                if record_type == "pinyin":
                    r.pinyin_wrong += 1
                elif record_type == "pronunciation":
                    r.pronunciation_wrong += 1

            # 连续正确判定
            r.last_correct = (r.pinyin_correct + r.pronunciation_correct >
                              r.pinyin_wrong + r.pronunciation_wrong)
            if r.last_correct:
                r.consecutive_correct += 1
            else:
                r.consecutive_correct = 0

            self._save()

    def get_weight(self, char: str) -> float:
        """计算一个字的选择权重（错误越多权重越高）"""
        with self._lock:
            r = self._records.get(char)
            if r is None:
                return 1.0

            weight = 1.0
            total_wrong = r.pinyin_wrong + r.pronunciation_wrong
            weight += total_wrong * 0.3

            if r.consecutive_correct > 0:
                weight -= min(r.consecutive_correct * 0.15, 0.7)

            if r.last_seen:
                days_since = (time.time() - r.last_seen) / 86400
                if days_since > 7:
                    weight += min(days_since * 0.02, 0.5)

            return max(weight, 0.1)

    def get_all_weights(self, chars: list[str]) -> dict[str, float]:
        return {c: self.get_weight(c) for c in chars}
