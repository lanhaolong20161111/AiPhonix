"""练习记录路由"""

import json
import logging
import os
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class PracticeRecord(BaseModel):
    char: str = ""
    module: str = ""
    attempt_count: int = 0
    first_try_correct: bool = False
    hint_used: bool = False
    correct: bool = False
    timestamp: str = ""
    date: str = ""
    grade: str = ""


class PracticeSession(BaseModel):
    module: str = ""
    grade: str = ""
    records: list[PracticeRecord] = []
    total_score: int = 0
    max_score: int = 0
    timestamp: str = ""
    date: str = ""


class PracticeStats:
    def __init__(self):
        self.total_sessions = 0
        self.total_chars = 0
        self.first_try_correct = 0
        self.total_correct = 0
        self.per_char: dict[str, int] = {}
        self.per_char_attempts: dict[str, int] = {}


class PracticeHandler:
    def __init__(self, data_dir: str):
        self._lock = threading.Lock()
        self._data_dir = os.path.join(data_dir, "practice")
        self._sessions: list[PracticeSession] = []
        os.makedirs(self._data_dir, exist_ok=True)
        self._load()

    def _load(self):
        if not os.path.isdir(self._data_dir):
            return
        for fname in os.listdir(self._data_dir):
            if fname.endswith(".json"):
                path = os.path.join(self._data_dir, fname)
                try:
                    with open(path, encoding="utf-8") as f:
                        data = json.load(f)
                    # Parse with defaults for missing fields
                    records = []
                    for r in data.get("records", []):
                        records.append(PracticeRecord(**r))
                    session = PracticeSession(
                        module=data.get("module", ""),
                        grade=data.get("grade", ""),
                        records=records,
                        total_score=data.get("total_score", 0),
                        max_score=data.get("max_score", 0),
                        timestamp=data.get("timestamp", ""),
                        date=data.get("date", ""),
                    )
                    self._sessions.append(session)
                except Exception as e:
                    logger.warning("加载练习记录失败 %s: %s", fname, e)

    def _save(self, session: PracticeSession):
        now = datetime.now(timezone.utc)
        filename = f"practice_{session.date}_{int(now.timestamp() * 1000)}.json"
        path = os.path.join(self._data_dir, filename)
        data = {
            "module": session.module,
            "grade": session.grade,
            "records": [r.model_dump() for r in session.records],
            "total_score": session.total_score,
            "max_score": session.max_score,
            "timestamp": session.timestamp,
            "date": session.date,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


handler: PracticeHandler = None  # type: ignore


def init(data_dir: str):
    global handler
    handler = PracticeHandler(data_dir)


@router.post("/practice/submit")
async def practice_submit(session: PracticeSession):
    now = datetime.now(timezone.utc)
    session.timestamp = now.isoformat()
    session.date = now.strftime("%Y-%m-%d")

    correct = sum(1 for r in session.records if r.correct)
    session.total_score = correct
    session.max_score = len(session.records)

    with handler._lock:
        handler._sessions.append(session)
        try:
            handler._save(session)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"保存失败: {e}")

    return {"status": "ok", "score": correct, "max_score": len(session.records)}


@router.get("/practice/stats")
async def practice_stats(module: str = ""):
    with handler._lock:
        sessions = handler._sessions
        if module:
            sessions = [s for s in sessions if s.module == module]

        stats = PracticeStats()
        stats.total_sessions = len(sessions)
        for s in sessions:
            for r in s.records:
                stats.total_chars += 1
                if r.first_try_correct:
                    stats.first_try_correct += 1
                if r.correct:
                    stats.total_correct += 1
                stats.per_char[r.char] = stats.per_char.get(r.char, 0) + (1 if r.first_try_correct else 0)
                stats.per_char_attempts[r.char] = stats.per_char_attempts.get(r.char, 0) + 1

        return {
            "total_sessions": stats.total_sessions,
            "total_chars": stats.total_chars,
            "first_try_correct": stats.first_try_correct,
            "total_correct": stats.total_correct,
            "per_char": stats.per_char,
            "per_char_attempts": stats.per_char_attempts,
        }


@router.get("/practice/history")
async def practice_history(module: str = "", limit: int = 20):
    with handler._lock:
        sessions = handler._sessions
        if module:
            sessions = [s for s in sessions if s.module == module]
        sessions = sessions[-limit:]
        sessions.reverse()
        return {
            "total": len(handler._sessions),
            "sessions": [{
                "module": s.module,
                "grade": s.grade,
                "total_score": s.total_score,
                "max_score": s.max_score,
                "timestamp": s.timestamp,
                "date": s.date,
                "records": len(s.records),
            } for s in sessions],
        }
