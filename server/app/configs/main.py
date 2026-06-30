"""
应用配置管理
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from app.configs.ai import AiConfig
from app.configs.base import BaseConfig


# =============================================================================
# 运行时配置
# =============================================================================

# 配置文件名
CONFIG_FILE_NAME = "app_config.json"


@dataclass
class AppConfig:
    """应用运行时配置"""
    config_dir: Path = Path(f"{Path.cwd()}/{CONFIG_FILE_NAME}")

    base_config: BaseConfig = field(default_factory=BaseConfig)
    ai_config: AiConfig = field(default_factory=AiConfig)

    def update_setting(self):
        """将当前配置存储到本地 JSON 文件"""
        self.config_dir.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "base": self.base_config.model_dump(),
            "ai": self.ai_config.model_dump(),
        }

        with open(self.config_dir, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @classmethod
    def load_from_file(cls) -> "AppConfig":
        """从本地 JSON 文件加载配置，文件不存在时返回默认配置"""
        config = cls()
        # config.base_config.user_data_path = user_data_path

        if not config.config_dir.exists():
            config.update_setting()
            return config

        try:
            with open(config.config_dir, encoding="utf-8") as f:
                data = json.load(f)

            if "base" in data:
                config.base_config = BaseConfig.model_validate(data["base"])
            if "ai" in data:
                config.ai_config = AiConfig.model_validate(data["ai"])
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

        return config
    
    
_current: Optional["AppConfig"] = None

def init_config() -> "AppConfig":
    global _current
    _current = AppConfig.load_from_file()
    return _current

def get_config() -> "AppConfig":
    if _current is None:
        raise RuntimeError("Config not initialized. Call init_config() first.")
    return _current

