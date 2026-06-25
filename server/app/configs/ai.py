from typing import Literal

from pydantic import BaseModel, Field

AI_MODEL_TYPE = Literal["llm", "vision", "multimodal", "speech", "embedding", "reasoning"]
AI_PROVIDER = {
    "openai": {
      "base_url": "https://api.openai.com/v1",
      "provider": "openai",
    },
    "google": {
      "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
      "provider": "google",
    },
    "kimi": {
      "base_url": "https://api.moonshot.cn/v1",
      "provider": "kimi",
    },
    "anthropic": {
      "base_url": "https://api.anthropic.com/v1",
      "provider": "anthropic",
    },
    "deepseek": {
      "base_url": "https://api.deepseek.com",
      "provider": "deepseek",
    },
    "qwen": {
      "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "provider": "qwen",
    },
    "custom": {
      "base_url": "",
      "provider": "custom",
    }
}


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

    name: str = Field(default="") # 自定义名称
    base_url: str = Field(default="")
    api_key: str = Field(default="")
    model_id: str = Field(default="")
    model_type: AI_MODEL_TYPE = Field(default="llm") # 模型类型
    provider: str = Field(default="custom") # 提供商
    settings: LLMSettings | EmbeddingSettings = Field(default_factory=LLMSettings)
    
    


class AiConfig(BaseModel):
    """全局 AI 配置"""
    
    model: AiModel = Field(default_factory=AiModel)  # 当前模型
