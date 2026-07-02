"""
智能体对话业务逻辑层

编排对话 CRUD、知识库管理、流式聊天的完整业务流程。
"""

import asyncio
import logging
import os
import time
from typing import Optional

from app.configs.main import AppConfig
from app.core.exceptions import NotFoundError, ValidationError
from app.domains.agents.chat_pipeline import run_chat_pipeline
from app.domains.agents.conversation_store import ConversationStore, generate_id
from app.domains.agents.kb_index_store import KbIndexStore
from app.domains.agents.kb_indexer import rebuild_knowledge_base_index
from app.domains.agents.knowledge_base_store import KnowledgeBaseStore
from app.domains.agents.rag_engine import RagChunk
from app.models.agents import (
    AgentConversation,
    AgentKnowledgeDoc,
    AgentMessage,
    KnowledgeBaseConfig,
)

logger = logging.getLogger(__name__)


class AgentService:
    """智能体服务 —— 整合对话、知识库、聊天管道"""

    def __init__(self, user_data_path: str) -> None:
        self._conv_store = ConversationStore(user_data_path)
        self._kb_store = KnowledgeBaseStore(user_data_path)
        self._index_store = KbIndexStore(user_data_path)

    # =========================================================================
    # 对话 CRUD
    # =========================================================================

    def list_conversations(self) -> list[AgentConversation]:
        return self._conv_store.list_all()

    def get_conversation(self, conv_id: str) -> AgentConversation:
        conv = self._conv_store.load(conv_id)
        if not conv:
            raise NotFoundError("对话不存在")
        return conv

    def create_conversation(self, agent_id: str, title: str = "新对话") -> AgentConversation:
        conv = AgentConversation(
            id=generate_id("conv"),
            agent_id=agent_id,
            title=title.strip() or "新对话",
        )
        self._conv_store.save(conv)
        return conv

    def delete_conversation(self, conv_id: str) -> None:
        if not self._conv_store.delete(conv_id):
            raise NotFoundError("对话不存在")

    def rename_conversation(self, conv_id: str, title: str) -> AgentConversation:
        conv = self.get_conversation(conv_id)
        conv.title = title.strip()
        self._conv_store.save(conv)
        return conv

    def clear_conversation(self, conv_id: str) -> AgentConversation:
        conv = self.get_conversation(conv_id)
        conv.messages.clear()
        self._conv_store.save(conv)
        return conv

    # =========================================================================
    # 流式聊天
    # =========================================================================

    async def chat_stream(
        self,
        *,
        conversation_id: str,
        agent_id: str,
        message: str,
        config: AppConfig,
        api_key: str,
        signal: Optional[asyncio.Event] = None,
    ):
        """
        流式聊天生成器 —— 返回 AsyncIterator

        流程：
        1. 加载/创建对话
        2. 保存用户消息
        3. 获取智能体配置（从 Electron 推送的 settings 中找）
        4. RAG 检索 + 流式生成
        5. 保存助手消息
        """
        # 加载或创建对话
        conv = self._conv_store.load(conversation_id)
        if not conv:
            conv = AgentConversation(
                id=conversation_id,
                agent_id=agent_id,
                title=message[:50],
            )

        # 保存用户消息
        user_msg = AgentMessage(
            id=generate_id("msg"),
            role="user",
            content=message,
        )
        conv.messages.append(user_msg)
        self._conv_store.save(conv)

        # 从 Electron 推送的配置中查找智能体
        agent_config = None
        for ac in config.agents.configs:
            if ac.id == agent_id:
                agent_config = ac
                break

        system_prompt = agent_config.system_prompt if agent_config else "你是一个智能助手。"
        knowledge_base_id = agent_config.knowledge_base_id if agent_config else None

        # 执行聊天管道
        full_text = ""
        rag_chunks_raw = []
        pipeline_completed = False

        async for event in run_chat_pipeline(
            config=config,
            api_key=api_key,
            system_prompt=system_prompt,
            knowledge_base_id=knowledge_base_id,
            conversation_messages=conv.messages[:-1],
            new_user_message=message,
            index_store=self._index_store,
            signal=signal,
        ):
            if event["type"] == "done":
                full_text = event["full_text"]
                if event.get("rag_context") and event["rag_context"].chunks:
                    rag_chunks_raw = event["rag_context"].chunks
                pipeline_completed = True
                break
            if event["type"] == "error":
                yield event
                return

            yield event

        if signal and signal.is_set():
            return
        if not pipeline_completed:
            return

        # 保存助手消息
        rag_chunks = None
        if rag_chunks_raw:
            rag_chunks = [
                {
                    "chunkId": c.chunk_id,
                    "docId": c.doc_id,
                    "text": c.text,
                    "docTitle": c.doc_title,
                    "score": c.score,
                }
                for c in rag_chunks_raw
            ]

        assistant_msg = AgentMessage(
            id=generate_id("msg"),
            role="assistant",
            content=full_text,
            rag_chunks=rag_chunks,
        )
        conv.messages.append(assistant_msg)

        # 首次对话取标题
        if len(conv.messages) == 2:
            conv.title = full_text[:50]

        self._conv_store.save(conv)

        # 发送完成事件
        yield {
            "type": "completed",
            "assistant_message": assistant_msg,
            "full_text": full_text,
        }

    # =========================================================================
    # 知识库 CRUD
    # =========================================================================

    def list_knowledge_bases(self) -> list[KnowledgeBaseConfig]:
        return self._kb_store.list_knowledge_bases()

    def save_knowledge_base(self, kb_id: str, name: str) -> KnowledgeBaseConfig:
        kb = KnowledgeBaseConfig(id=kb_id, name=name)
        return self._kb_store.save_knowledge_base(kb)

    def delete_knowledge_base(self, kb_id: str) -> None:
        self._kb_store.delete_knowledge_base(kb_id)

    def list_documents(self, kb_id: str) -> list[AgentKnowledgeDoc]:
        return self._kb_store.list_documents(kb_id)

    async def save_document(
        self,
        kb_id: str,
        doc: AgentKnowledgeDoc,
        config: AppConfig,
        api_key: str,
    ) -> AgentKnowledgeDoc:
        """保存文档并触发重新索引"""
        saved = self._kb_store.save_document(kb_id, doc)
        await self._reindex(kb_id, config, api_key)
        return saved

    async def delete_document(self, kb_id: str, doc_id: str, config: AppConfig, api_key: str) -> None:
        """删除文档并触发重新索引"""
        self._kb_store.delete_document(kb_id, doc_id)
        await self._reindex(kb_id, config, api_key)

    async def reindex(self, kb_id: str, config: AppConfig, api_key: str) -> KnowledgeBaseConfig:
        """重建知识库索引"""
        await self._reindex(kb_id, config, api_key)
        bases = self._kb_store.list_knowledge_bases()
        for b in bases:
            if b.id == kb_id:
                return b
        raise NotFoundError("知识库不存在")

    async def _reindex(self, kb_id: str, config: AppConfig, api_key: str) -> None:
        """内部：重建索引并更新知识库元数据"""
        docs = self._kb_store.list_documents(kb_id)
        index = await rebuild_knowledge_base_index(
            kb_id=kb_id,
            docs=docs,
            rag=config.agents.rag,
            config_ai=config.ai,
            ai_api_keys=config.ai_api_keys,
            active_api_key=config.api_key,
            index_store=self._index_store,
        )
        self._kb_store.update_knowledge_base(kb_id, {
            "docCount": len(docs),
            "indexedAt": index.indexed_at,
        })
