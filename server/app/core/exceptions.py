"""
全局异常处理器

将 Python 异常转换为统一的 JSON 错误响应格式。
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """应用层异常 —— 消息可直接展示给用户"""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class ValidationError(AppError):
    """参数校验异常"""

    def __init__(self, message: str):
        super().__init__(message, status_code=422)


class NotFoundError(AppError):
    """资源不存在"""

    def __init__(self, message: str = "资源不存在"):
        super().__init__(message, status_code=404)


class AiServiceError(AppError):
    """AI 服务异常"""

    def __init__(self, message: str):
        super().__init__(message, status_code=502)


def register_exception_handlers(app: FastAPI) -> None:
    """注册全局异常处理器"""

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.message},
        )

    @app.exception_handler(ValueError)
    async def handle_value_error(_request: Request, exc: ValueError):
        return JSONResponse(
            status_code=422,
            content={"error": str(exc)},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception):
        # 不在 debug 模式下不泄露内部错误细节
        return JSONResponse(
            status_code=500,
            content={"error": "服务器内部错误"},
        )
