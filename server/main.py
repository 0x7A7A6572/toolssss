"""
Forge Studio Python 后端服务入口

启动方式：
  python main.py --port 8710 --user-data-path "C:\\Users\\..."
  uvicorn main:create_app --factory --port 8710

Electron 主进程通过子进程方式启动此服务，传递端口和用户数据目录。
"""

import argparse
import sys
from pathlib import Path
from contextlib import asynccontextmanager

# 将 server 目录加入 sys.path，确保 app 包可导入
_SERVER_DIR = Path(__file__).resolve().parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))


def create_app() -> "fastapi.FastAPI":
    """工厂函数：创建 FastAPI 应用实例（供 uvicorn --factory 使用）"""
    from app.config import AppConfig
    from app.core.exceptions import register_exception_handlers
    from app.core.middleware import register_middleware
    from app.domains.agents.router import router as agents_router
    from app.domains.custom_modules.router import router as custom_modules_router
    from app.domains.windows.router import router as windows_router
    from app.domains.windows.service import shutdown_windows_runtime

    from fastapi import FastAPI

    # 从命令行参数或环境变量解析配置
    config = AppConfig.from_args()

    @asynccontextmanager
    async def lifespan(_app: "FastAPI"):
        try:
            yield
        finally:
            shutdown_windows_runtime()

    app = FastAPI(
        title="Forge Studio Server",
        version="0.1.0",
        docs_url="/docs" if config.debug else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # 将配置挂载到 app.state，供各 domain 通过 request.app.state 访问
    app.state.config = config

    # 注册中间件和异常处理器
    register_middleware(app)
    register_exception_handlers(app)

    # 注册 domain 路由
    app.include_router(agents_router, prefix="/api/agents", tags=["智能体对话"])
    app.include_router(custom_modules_router, prefix="/api/modules", tags=["自定义模块"])
    app.include_router(windows_router, prefix="/api/windows", tags=["Windows 窗口"])

    # 系统端点
    @app.get("/health")
    async def health():
        """健康检查 —— Electron 用它判断 Python 服务是否就绪"""
        return {"status": "ok"}

    # 配置同步端点 —— Electron 推送配置变更
    @app.post("/config")
    async def sync_config(payload: dict):
        """Electron 推送最新配置到 Python 服务"""
        from app.config import SettingsPayload

        settings = SettingsPayload.model_validate(payload)
        app.state.config.update_settings(settings)
        return {"status": "ok"}

    return app


def main():
    parser = argparse.ArgumentParser(description="Forge Studio Python 服务")
    parser.add_argument("--port", type=int, default=8710, help="监听端口（默认 8710）")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument(
        "--user-data-path", type=str, default="", help="Electron userData 目录路径"
    )
    parser.add_argument("--debug", action="store_true", help="开启调试模式")
    args = parser.parse_args()

    import uvicorn

    # 通过环境变量传递配置给 create_app 工厂
    import os

    os.environ["FS_PORT"] = str(args.port)
    os.environ["FS_HOST"] = str(args.host)
    os.environ["FS_USER_DATA_PATH"] = str(args.user_data_path)
    os.environ["FS_DEBUG"] = "1" if args.debug else "0"

    uvicorn.run(
        "main:create_app",
        host=args.host,
        port=args.port,
        factory=True,
        log_level="info" if not args.debug else "debug",
        reload=False,
    )


if __name__ == "__main__":
    main()
