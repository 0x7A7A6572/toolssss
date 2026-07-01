import os
from pathlib import Path

from pydantic import BaseModel

"""启动参数"""
class BaseConfig(BaseModel):
    port: int = int(os.getenv("FS_PORT", "8710"))
    host: str = os.getenv("FS_HOST", "127.0.0.1")
    data_dir: str = os.getenv("FS_DATA_DIR", str(Path.cwd() / "data"))
    debug: bool = os.getenv("FS_DEBUG", "0") == "1"


