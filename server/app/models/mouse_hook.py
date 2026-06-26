"""鼠标钩子域请求/响应模型"""

from pydantic import BaseModel, Field


class MouseHookStartRequest(BaseModel):
    """启动鼠标钩子请求"""

    callback_port: int = Field(ge=1024, le=65535)


class MouseHookStatusResponse(BaseModel):
    """鼠标钩子状态"""

    running: bool
