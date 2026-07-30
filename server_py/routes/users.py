"""User API — 个人信息"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_session, User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/v1/users", tags=["users"])


class UserInfo(BaseModel):
    uuid: str
    username: str
    nickname: str
    role: str
    grade: str
    age: int
    learning_level: str

class MeResponse(BaseModel):
    user: UserInfo

class UpdateMeRequest(BaseModel):
    nickname: str | None = None
    grade: str | None = None
    age: int | None = None


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    return MeResponse(user=UserInfo(
        uuid=current_user.uuid,
        username=current_user.username,
        nickname=current_user.nickname,
        role=current_user.role,
        grade=current_user.grade,
        age=current_user.age,
        learning_level=current_user.learning_level,
    ))


@router.put("/me", response_model=MeResponse)
async def update_me(
    req: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """更新个人信息"""
    if req.nickname is not None:
        current_user.nickname = req.nickname
    if req.grade is not None:
        current_user.grade = req.grade
    if req.age is not None:
        current_user.age = req.age
    await session.commit()
    return MeResponse(user=UserInfo(
        uuid=current_user.uuid,
        username=current_user.username,
        nickname=current_user.nickname,
        role=current_user.role,
        grade=current_user.grade,
        age=current_user.age,
        learning_level=current_user.learning_level,
    ))
