"""通用响应模型"""

from typing import Any, Optional

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """统一错误响应"""
    error: str


class SuccessResponse(BaseModel):
    """统一成功响应"""
    status: str = "ok"
    data: Optional[Any] = None
