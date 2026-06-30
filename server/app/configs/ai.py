from typing import Literal

from pydantic import BaseModel, Field

AI_MODEL_TYPE = Literal["llm", "vision", "multimodal", "speech", "embedding", "reasoning"]
AI_PROVIDER = {
    "openai": {
      "base_url": "https://api.openai.com/v1",
      "provider": "openai",
      "title": "OpenAI",
      "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
    },
    "google": {
      "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
      "provider": "google",
      "title": "Google Gemini",
      "models": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
    },
    "kimi": {
      "base_url": "https://api.moonshot.cn/v1",
      "provider": "kimi",
      "title": "Kimi (Moonshot)",
      "models": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    },
    "anthropic": {
      "base_url": "https://api.anthropic.com/v1",
      "provider": "anthropic",
      "title": "Anthropic",
      "models": ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"],
    },
    "deepseek": {
      "base_url": "https://api.deepseek.com",
      "provider": "deepseek",
      "title": "DeepSeek",
      "models": ["deepseek-v4-flash", "deepseek-v4-pro"],
    },
    "qwen": {
      "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "provider": "qwen",
      "title": "Qwen",
      "models": ["qwen2.5-7b-instruct", "qwen2.5-32b-instruct", "qwen2.5-72b-instruct"],
    },
    "custom": {
      "base_url": "",
      "provider": "custom",
      "title": "自定义",
      "models": [],
    }
}

class ProviderInfo(BaseModel):
    """服务商信息"""
    provider: str
    title: str
    base_url: str
    models: list[str]


class LLMSettings(BaseModel):
    """LLM 模型参数"""

    model_type: Literal["llm"] = "llm"
    temperature: float = Field(default=0.7, ge=0, le=2) # 温度参数，控制输出的随机性
    max_tokens: int = Field(default=4096, ge=1)     # 最大输出token数
    detail: Literal["low", "high", "auto"] = "auto" # 输出详情等级

class EmbeddingSettings(BaseModel):
    """向量嵌入模型参数"""

    model_type: Literal["embedding"] = "embedding"
    dimensions: int = Field(default=1024) # 向量维度
    

class AiModel(BaseModel):
    """AI 模型"""

    name: str = Field(default="", min_length=1, description="自定义名称")
    base_url: str = Field(default="")
    api_key: str = Field(default="")
    model_id: str = Field(default="", min_length=1, description="模型 ID")
    model_type: AI_MODEL_TYPE = Field(default="llm")
    provider: str = Field(default="custom")
    settings: LLMSettings | EmbeddingSettings = Field(default_factory=LLMSettings)


class AiConfig(BaseModel):
    """全局 AI 配置"""

    models: list[AiModel] = Field(default_factory=list)

