"""
聊天流式管道

编排：RAG 检索 → 消息构建 → 流式生成 → 结果收集

对应 TypeScript 端 chat-pipeline.ts
"""

import asyncio
import logging
from typing import AsyncIterator, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.config import AppConfig
from app.core.ai_client import create_chat_model, normalize_base_url
from app.domains.agents.rag_engine import (
    RagContext,
    build_rag_context_prompt,
    retrieve_from_knowledge_base,
)
from app.domains.agents.kb_index_store import KbIndexStore
from app.models.agents import AgentMessage

logger = logging.getLogger(__name__)


async def run_chat_pipeline(
    *,
    config: AppConfig,
    api_key: str,
    system_prompt: str,
    knowledge_base_id: Optional[str],
    conversation_messages: list[AgentMessage],
    new_user_message: str,
    index_store: KbIndexStore,
    signal: Optional[asyncio.Event] = None,
) -> AsyncIterator[dict]:
    """
    执行聊天管道，通过 AsyncIterator 推送事件

    事件格式：
    - {"type": "status", "status": str}
    - {"type": "delta", "delta": str}
    - {"type": "done", "full_text": str, "rag_context": Optional[RagContext]}
    - {"type": "error", "message": str}
    """
    try:
        # 1. RAG 检索
        rag_context: Optional[RagContext] = None
        if knowledge_base_id:
            yield {"type": "status", "status": "rag_loading"}
            rag_context = await retrieve_from_knowledge_base(
                query=new_user_message,
                kb_id=knowledge_base_id,
                config=config,
                api_key=api_key,
                index_store=index_store,
            )

        # 2. 构建消息列表
        messages: list[BaseMessage] = []

        # 系统提示词 + RAG 上下文
        sys_content = system_prompt.strip() or "你是一个智能助手。"
        rag_supplement = build_rag_context_prompt(rag_context) if rag_context else ""
        messages.append(SystemMessage(content=sys_content + rag_supplement))

        # 对话历史（截断控制上下文窗口）
        MAX_HISTORY = 20
        recent = conversation_messages[-MAX_HISTORY:]
        for msg in recent:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                messages.append(AIMessage(content=msg.content))
            # system 角色消息不纳入历史

        # 当前用户消息
        messages.append(HumanMessage(content=new_user_message))

        # 3. 创建模型并流式生成
        yield {"type": "status", "status": "thinking"}

        model = create_chat_model(
            config=config.ai,
            api_key=api_key,
            temperature=0.7,
            max_tokens=16384,
        )

        yield {"type": "status", "status": "streaming"}

        full_text = ""
        stream = model.stream(messages)
        for chunk in stream:
            if signal and signal.is_set():
                break
            content = getattr(chunk, "content", None)
            if isinstance(content, str) and content:
                full_text += content
                yield {"type": "delta", "delta": content}

        # 4. 完成
        yield {
            "type": "done",
            "full_text": full_text,
            "rag_context": rag_context,
        }

    except Exception as e:
        if signal and signal.is_set():
            return
        logger.error("聊天管道异常: %s", e)
        yield {"type": "error", "message": f"AI 请求失败: {e}"}
