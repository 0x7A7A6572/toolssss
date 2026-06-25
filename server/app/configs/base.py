import os

from pydantic import BaseModel

"""启动参数"""
class BaseConfig(BaseModel):
    port: int = int(os.getenv("FS_PORT", "8710"))
    host: str = os.getenv("FS_HOST", "127.0.0.1")
    user_data_path: str = os.getenv("FS_USER_DATA_PATH", "")
    debug: bool = os.getenv("FS_DEBUG", "0") == "1"


