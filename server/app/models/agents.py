"""
智能体/对话/知识库 Pydantic 模型

对应 TypeScript 端 @shared/agents 中的类型定义。
"""

import time
from typing import Optional

from pydantic import BaseModel, Field


def _now_ms() -> float:
    return time.time() * 1000


# =============================================================================
# 智能体配置
# =============================================================================


class AgentConfig(BaseModel):
    """智能体配置（对应 TypeScript AgentConfig）"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    id: str
    name: str = ""
    system_prompt: str = Field(
        default="", validation_alias="systemPrompt", serialization_alias="systemPrompt"
    )
    knowledge_base_id: Optional[str] = Field(
        default=None,
        validation_alias="knowledgeBaseId",
        serialization_alias="knowledgeBaseId",
    )
    created_at: float = Field(
        default=0.0, validation_alias="createdAt", serialization_alias="createdAt"
    )
    updated_at: float = Field(
        default=0.0, validation_alias="updatedAt", serialization_alias="updatedAt"
    )


# =============================================================================
# 对话相关
# =============================================================================


class AgentRagChunk(BaseModel):
    """RAG 检索命中片段"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    chunk_id: str = Field(default="", validation_alias="chunkId", serialization_alias="chunkId")
    doc_id: str = Field(default="", validation_alias="docId", serialization_alias="docId")
    text: str = ""
    doc_title: str = Field(
        default="", validation_alias="docTitle", serialization_alias="docTitle"
    )
    score: float = 0.0


class AgentMessage(BaseModel):
    """对话消息"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    id: str
    role: str  # "user" | "assistant" | "system"
    content: str
    rag_chunks: Optional[list[AgentRagChunk]] = Field(
        default=None, validation_alias="ragChunks", serialization_alias="ragChunks"
    )
    timestamp: float = Field(default_factory=_now_ms)


class AgentConversation(BaseModel):
    """对话实体"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    id: str
    agent_id: str = Field(validation_alias="agentId", serialization_alias="agentId")
    title: str
    messages: list[AgentMessage] = Field(default_factory=list)
    created_at: float = Field(
        default_factory=_now_ms,
        validation_alias="createdAt",
        serialization_alias="createdAt",
    )
    updated_at: float = Field(
        default_factory=_now_ms,
        validation_alias="updatedAt",
        serialization_alias="updatedAt",
    )


class ConversationListItem(BaseModel):
    """对话列表项（不含消息内容）"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    id: str
    agent_id: str = Field(validation_alias="agentId", serialization_alias="agentId")
    title: str
    created_at: float = Field(validation_alias="createdAt", serialization_alias="createdAt")
    updated_at: float = Field(validation_alias="updatedAt", serialization_alias="updatedAt")


# =============================================================================
# 知识库相关
# =============================================================================


class KnowledgeBaseConfig(BaseModel):
    """知识库配置"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    id: str
    name: str
    doc_count: int = Field(default=0, validation_alias="docCount", serialization_alias="docCount")
    indexed_at: Optional[float] = Field(
        default=None, validation_alias="indexedAt", serialization_alias="indexedAt"
    )


class AgentKnowledgeDoc(BaseModel):
    """知识库文档"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    id: str
    kb_id: str = Field(default="", validation_alias="kbId", serialization_alias="kbId")
    title: str
    content: str = ""
    created_at: float = Field(
        default_factory=_now_ms,
        validation_alias="createdAt",
        serialization_alias="createdAt",
    )
    updated_at: float = Field(
        default_factory=_now_ms,
        validation_alias="updatedAt",
        serialization_alias="updatedAt",
    )


# =============================================================================
# 请求体
# =============================================================================


class ConversationCreateRequest(BaseModel):
    """创建对话请求"""
    agent_id: str
    title: str = "新对话"


class ConversationRenameRequest(BaseModel):
    """重命名对话请求"""
    title: str


class ChatStreamRequest(BaseModel):
    """流式聊天请求"""
    conversation_id: str
    agent_id: str
    message: str


class CancelStreamRequest(BaseModel):
    """取消流式请求"""
    stream_id: str


class KnowledgeBaseSaveRequest(BaseModel):
    """创建/更新知识库请求"""
    id: str
    name: str


class KnowledgeDocSaveRequest(BaseModel):
    """保存知识库文档请求"""
    doc: AgentKnowledgeDoc


class KnowledgeDocDeleteRequest(BaseModel):
    """删除知识库文档请求"""
    doc_id: str


class ReindexRequest(BaseModel):
    """重建索引请求"""
    kb_id: str
