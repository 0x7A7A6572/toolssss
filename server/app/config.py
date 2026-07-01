"""
!! 将弃用，统一使用 app/configs/* 进行配置管理

应用配置管理

配置来源：
1. 命令行参数 / 环境变量（端口、host、userDataPath）
2. Electron 通过 POST /config 推送的 SettingsPayload（AI 配置等）

Python 服务只持有配置的只读内存副本，所有写入由 Electron 主进程通过 /config 和回调完成。

注意：Electron 端 JSON 使用 camelCase，Pydantic 模型通过 Field(alias=...) 做映射。
"""

import os
from dataclasses import dataclass, field
from typing import Optional

from pydantic import BaseModel, Field

from app.models.agents import AgentConfig


# =============================================================================
# Pydantic 模型 —— 对应 @shared/settings.ts 中的 AppSettings
# 使用 Field(alias=...) 接收 Electron 发来的 camelCase JSON
# =============================================================================


class EmbeddingProfileConfig(BaseModel):
    """向量嵌入配置（对应 settings.ai.embedding）"""
    model_config = {"populate_by_name": True}

    enabled: bool = False
    profile_id: str = Field(default="", validation_alias="profileId")
    model: str = "text-embedding-3-small"
    dimensions: int = 1536


class AiProfileConfig(BaseModel):
    """AI Profile 配置（对应 settings.ai.profiles[]）"""
    model_config = {"populate_by_name": True}

    id: str = ""
    name: str = ""
    source: str = "custom"
    provider: str = "custom"
    base_url: str = Field(default="", validation_alias="baseUrl")
    model: str = ""
    api_key_set: bool = Field(default=False, validation_alias="apiKeySet")
    model_type: str = Field(default="llm", validation_alias="modelType")


class AiSettings(BaseModel):
    """AI 相关配置（对应 settings.ai）"""
    model_config = {"populate_by_name": True}

    enabled: bool = False
    provider: str = "openai"
    base_url: str = Field(default="", validation_alias="baseUrl")
    model: str = ""
    api_key_set: bool = Field(default=False, validation_alias="apiKeySet")
    active_profile_id: str = Field(default="", validation_alias="activeProfileId")
    profiles: list[AiProfileConfig] = Field(default_factory=list)
    search_mcp_command: str = Field(
        default="npx -y mcp-remote https://search.parallel.ai/mcp",
        validation_alias="searchMcpCommand",
    )
    embedding: EmbeddingProfileConfig = Field(default_factory=EmbeddingProfileConfig)


class RagRuntimeConfig(BaseModel):
    """RAG 运行时配置（对应 settings.agents.rag）"""
    model_config = {"populate_by_name": True}

    top_k: int = Field(default=4, validation_alias="topK")
    chunk_size: int = Field(default=700, validation_alias="chunkSize")
    chunk_overlap: int = Field(default=120, validation_alias="chunkOverlap")


class AgentsSettings(BaseModel):
    """智能体设置（对应 settings.agents）"""
    model_config = {"populate_by_name": True}

    rag: RagRuntimeConfig = Field(default_factory=RagRuntimeConfig)
    configs: list["AgentConfig"] = Field(default_factory=list)
    knowledge_bases: list[dict] = Field(
        default_factory=list, validation_alias="knowledgeBases"
    )


class TranslateSettings(BaseModel):
    """翻译设置（对应 settings.translate）"""
    model_config = {"populate_by_name": True}

    provider: str = "baidu"
    default_source: str = Field(default="auto", validation_alias="defaultSource")
    default_target: str = Field(default="zh", validation_alias="defaultTarget")


class SettingsPayload(BaseModel):
    """Electron 推送的配置载荷

    顶层 JSON 键由 pushConfigToPython 构造，已使用 snake_case：
    - ai, agents, translate → 嵌套对象内部是 camelCase（通过子模型的 alias 处理）
    - api_key, fun_fact, callback_port → snake_case，无需 alias
    """
    model_config = {"populate_by_name": True}

    # AI 核心
    ai: Optional[AiSettings] = None
    agents: Optional[AgentsSettings] = None
    api_key: Optional[str] = None
    ai_api_keys: Optional[dict[str, str]] = None
    # 翻译
    translate: Optional[TranslateSettings] = None
    # 生命周期
    callback_port: Optional[int] = None


# =============================================================================
# 运行时配置
# =============================================================================


@dataclass
class AppConfig:
    """应用运行时配置（启动时从命令行/环境变量解析 + 运行时从 Electron 接收）"""

    port: int = 8710
    host: str = "127.0.0.1"
    debug: bool = False

    # Electron 推送的动态配置
    ai: AiSettings = field(default_factory=AiSettings)
    agents: AgentsSettings = field(default_factory=AgentsSettings)
    translate: TranslateSettings = field(default_factory=TranslateSettings)
    api_key: str = ""
    ai_api_keys: dict[str, str] = field(default_factory=dict)
    callback_port: int = 0

    @classmethod
    def from_args(cls) -> "AppConfig":
        """从环境变量解析配置（由 main.py 在启动前写入）"""
        return cls(
            port=int(os.getenv("FS_PORT", "8710")),
            host=os.getenv("FS_HOST", "127.0.0.1"),
            debug=os.getenv("FS_DEBUG", "0") == "1",
        )

    def update_settings(self, payload: SettingsPayload) -> None:
        """原子更新配置快照（调用方：POST /config）"""
        if payload.ai is not None:
            self.ai = payload.ai
        if payload.agents is not None:
            self.agents = payload.agents
        if payload.translate is not None:
            self.translate = payload.translate
        if payload.api_key is not None:
            self.api_key = payload.api_key
        if payload.ai_api_keys is not None:
            self.ai_api_keys = {
                key.strip(): value.strip()
                for key, value in payload.ai_api_keys.items()
                if isinstance(key, str) and key.strip() and isinstance(value, str) and value.strip()
            }
        if payload.callback_port is not None:
            self.callback_port = payload.callback_port
