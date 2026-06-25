from pydantic import BaseModel, Field


class RagRuntimeConfig(BaseModel):
    """RAG 运行时配置"""

    top_k: int = Field(default=4)
    chunk_size: int = Field(default=700)
    chunk_overlap: int = Field(default=120)
