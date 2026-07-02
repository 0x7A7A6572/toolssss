"""
Forge Studio Python 后端服务入口

启动方式：
  python main.py --port 8710
  uvicorn main:create_app --factory --port 8710

Electron 主进程通过子进程方式启动此服务，传递端口。
"""

import argparse
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import fastapi

# 将 server 目录加入 sys.path，确保 app 包可导入
_SERVER_DIR = Path(__file__).resolve().parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))


def create_app() -> "fastapi.FastAPI":
    """工厂函数：创建 FastAPI 应用实例（供 uvicorn --factory 使用）"""
    import os

    # 如果传入了 FS_DEBUG_PORT 环境变量，启动 debugpy 监听
    # _debug_port = os.environ.get("FS_DEBUG_PORT")
    # if _debug_port:
    #     try:
    #         import debugpy
    #         debugpy.listen(("127.0.0.1", int(_debug_port)))
    #         print(f"[debugpy] 监听端口 {_debug_port}，等待 VS Code 连接...")
    #         # 阻塞直到 VS Code attach 上来，确保断点在模块加载前生效
    #         debugpy.wait_for_client()
    #         print(f"[debugpy] VS Code 已连接，继续启动")
    #     except Exception as e:
    #         print(f"[debugpy] 启动失败: {e}")

    # from app.config import AppConfig
    
    from fastapi import FastAPI

    from app.core.exceptions import register_exception_handlers
    from app.core.middleware import register_middleware
    from app.domains.agents.router import router as agents_router
    from app.domains.ai.router import router as ai_router
    from app.domains.custom_modules.router import router as custom_modules_router
    from app.domains.windows.router import router as windows_router
    from app.domains.windows.service import shutdown_windows_runtime

    # 从命令行参数或环境变量解析配置
    from app.configs.main import init_config

    config = init_config()

    @asynccontextmanager
    async def lifespan(_app: "FastAPI"):
        try:
            yield
        finally:
            shutdown_windows_runtime()

    app = FastAPI(
        title="Forge Studio Server",
        version="0.1.0",
        docs_url="/docs" if config.base_config.debug else None,
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
    app.include_router(ai_router, prefix="/api/ai", tags=["AI 模型配置"])
    app.include_router(custom_modules_router, prefix="/api/modules", tags=["自定义模块"])
    app.include_router(windows_router, prefix="/api/windows", tags=["Windows 窗口"])

    # 系统端点
    @app.get("/health")
    async def health():
        """健康检查 —— Electron 用它判断 Python 服务是否就绪"""
        return {"status": "ok"}

    return app


def main():
    parser = argparse.ArgumentParser(description="Forge Studio Python 服务")
    parser.add_argument("--port", type=int, default=8710, help="监听端口（默认 8710）")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--debug", action="store_true", help="开启调试模式")
    args = parser.parse_args()

    # 通过环境变量传递配置给 create_app 工厂
    import os

    import uvicorn

    os.environ["FS_PORT"] = str(args.port)
    os.environ["FS_HOST"] = str(args.host)
    os.environ["FS_DATA_DIR"] = str(_SERVER_DIR / "data")
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
