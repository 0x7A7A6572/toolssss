"""pytest 共享 fixtures"""

import os
import sys
from pathlib import Path

# 确保 server 目录在 sys.path 中
server_dir = Path(__file__).resolve().parent.parent
if str(server_dir) not in sys.path:
    sys.path.insert(0, str(server_dir))

import pytest
from fastapi.testclient import TestClient

from main import create_app


@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient —— 无需实际启动服务器"""
    os.environ.setdefault("FS_DATA_DIR", str(server_dir / "tests" / "_data"))
    os.environ.setdefault("FS_DEBUG", "1")
    app = create_app()
    return TestClient(app)
