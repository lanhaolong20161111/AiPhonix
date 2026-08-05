"""Auth API — 注册/登录/刷新/注销"""
import uuid
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_session, User, RefreshToken

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# ── 密码哈希 ──
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── JWT 配置 ──
JWT_SECRET = os.environ.get("JWT_SECRET", "ai-phonix-jwt-secret-dev")
ACCESS_TOKEN_EXPIRE_MINUTES = 120  # 2 小时
REFRESH_TOKEN_EXPIRE_DAYS = 30

# ── 请求/响应模型 ──

class RegisterRequest(BaseModel):
    username: str
    password: str
    nickname: str
    grade: str = ""
    age: int = 0

class LoginRequest(BaseModel):
    username: str
    password: str
    device_info: str = ""

class RefreshRequest(BaseModel):
    refresh_token: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = ACCESS_TOKEN_EXPIRE_MINUTES * 60
    user_id: int = 0

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


# ── 工具函数 ──

def _generate_uuid() -> str:
    return str(uuid.uuid4())

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def _create_access_token(user_id: int, username: str, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "type": "access",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def _create_refresh_token() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex

def _decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "access":
            return None
        return payload
    except jwt.PyJWTError:
        return None


# ── 依赖：获取当前用户 ──

async def get_current_user(
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_session),
) -> User:
    """从 Authorization header 解析当前用户"""
    if not authorization:
        raise HTTPException(status_code=401, detail="未提供认证信息")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="认证格式错误")
    payload = _decode_access_token(parts[1])
    if not payload:
        raise HTTPException(status_code=401, detail="Token 无效或已过期")
    user_id = int(payload["sub"])
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


async def optional_user(
    authorization: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
) -> Optional[User]:
    """可选的当前用户（未登录返回 None）"""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    payload = _decode_access_token(parts[1])
    if not payload:
        return None
    result = await session.execute(select(User).where(User.id == int(payload["sub"])))
    return result.scalar_one_or_none()


# ── API 端点 ──

@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, session: AsyncSession = Depends(get_session)):
    """注册新用户"""
    # 检查用户名是否已存在
    result = await session.execute(select(User).where(User.username == req.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 创建用户
    user = User(
        uuid=_generate_uuid(),
        username=req.username,
        password_hash=pwd_context.hash(req.password),
        nickname=req.nickname,
        grade=req.grade,
        age=req.age,
    )
    session.add(user)
    await session.flush()  # 获取 user.id

    # 生成 token
    access_token = _create_access_token(user.id, user.username, user.role)
    refresh_token_str = _create_refresh_token()
    refresh_token = RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(refresh_token_str),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    session.add(refresh_token)
    await session.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token_str,
        user_id=user.id,
    )


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, session: AsyncSession = Depends(get_session)):
    """登录"""
    result = await session.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()
    if not user or not pwd_context.verify(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    access_token = _create_access_token(user.id, user.username, user.role)
    refresh_token_str = _create_refresh_token()
    refresh_token = RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(refresh_token_str),
        device_info=req.device_info,
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    session.add(refresh_token)
    await session.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token_str,
        user_id=user.id,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, session: AsyncSession = Depends(get_session)):
    """刷新 token"""
    token_hash = _hash_token(req.refresh_token)
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    rt = result.scalar_one_or_none()
    if not rt or rt.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token 无效或已过期")

    # 删除旧 refresh token
    await session.delete(rt)

    # 查询用户
    result = await session.execute(select(User).where(User.id == rt.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    # 颁发新 token
    access_token = _create_access_token(user.id, user.username, user.role)
    new_refresh_token_str = _create_refresh_token()
    new_rt = RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(new_refresh_token_str),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    session.add(new_rt)
    await session.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token_str,
        user_id=user.id,
    )


@router.post("/logout")
async def logout(
    req: RefreshRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """注销（使 refresh token 失效）"""
    token_hash = _hash_token(req.refresh_token)
    result = await session.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.user_id == current_user.id,
        )
    )
    rt = result.scalar_one_or_none()
    if rt:
        await session.delete(rt)
        await session.commit()
    return {"message": "已注销"}
