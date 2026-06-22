"""
中间件注册 —— CORS、请求日志、超时
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware


def register_middleware(app: FastAPI) -> None:
    """注册全局中间件"""

    # CORS —— 允许本地 Electron 渲染进程的请求
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # 本地服务，安全风险可控
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
