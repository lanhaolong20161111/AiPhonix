"""练习追踪路由"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Config
from services.practice_tracker import PracticeTracker

logger = logging.getLogger(__name__)

router = APIRouter()

tracker: PracticeTracker = None  # type: ignore


def init(config: Config):
    global tracker
    tracker = PracticeTracker("data")


class RecordCharResultRequest(BaseModel):
    char: str
    correct: bool = False
    type: str = "pronunciation"  # "pinyin" / "pronunciation"


@router.post("/practice/char-record")
async def record_char_result(req: RecordCharResultRequest):
    tracker.record_result(req.char, req.type, req.correct)
    return {"status": "ok"}


class GetCharWeightsRequest(BaseModel):
    chars: list[str]


@router.post("/practice/char-weights")
async def get_char_weights(req: GetCharWeightsRequest):
    weights = tracker.get_all_weights(req.chars)
    return {"weights": weights}


class GetRecordsRequest(BaseModel):
    chars: list[str] = []


@router.post("/practice/records")
async def get_practice_records(req: GetRecordsRequest):
    """查询练习记录（每字的拼音/发音对错次数、连续正确、上次时间）。
    供练习页展示"练过几次"，家长/学生可见。"""
    records = tracker.get_records(req.chars if req.chars else None)
    return {"total": len(records), "records": records}
