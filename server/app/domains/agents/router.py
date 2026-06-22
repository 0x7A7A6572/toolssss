"""
智能体对话 Domain 路由

提供对话 CRUD、知识库 CRUD、流式聊天(SSE) 的 HTTP 端点。
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Request

from app.core.exceptions import NotFoundError, ValidationError
from app.domains.agents.service import AgentService
from app.models.agents import (
    ChatStreamRequest,
    ConversationCreateRequest,
    ConversationListItem,
    ConversationRenameRequest,
    KnowledgeBaseConfig,
    KnowledgeBaseSaveRequest,
    KnowledgeDocSaveRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# 活跃的流式取消信号
_active_streams: dict[str, asyncio.Event] = {}


def _get_service(request: Request) -> AgentService:
    """从 app.state 获取 AgentService 单例"""
    if not hasattr(request.app.state, "agent_service"):
        user_data_path = request.app.state.config.user_data_path
        request.app.state.agent_service = AgentService(user_data_path)
    return request.app.state.agent_service


def _require_string(value, name: str) -> str:
    """校验字符串参数"""
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"参数 {name} 无效")
    return value.strip()


def _get_api_key(request: Request) -> str:
    """从 app.state.config 获取 AI API Key"""
    key = request.app.state.config.api_key
    if not key:
        raise ValidationError("未配置 AI API Key")
    return key


# =============================================================================
# 对话 CRUD
# =============================================================================


@router.get("/conversations", response_model=list[ConversationListItem])
async def list_conversations(request: Request):
    """获取所有对话列表"""
    service = _get_service(request)
    conversations = service.list_conversations()
    return [
        ConversationListItem(
            id=c.id,
            agent_id=c.agent_id,
            title=c.title,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in conversations
    ]


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request):
    """获取单个对话"""
    service = _get_service(request)
    return service.get_conversation(conversation_id)


@router.post("/conversations")
async def create_conversation(body: ConversationCreateRequest, request: Request):
    """创建新对话"""
    service = _get_service(request)
    return service.create_conversation(body.agent_id, body.title)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request):
    """删除对话"""
    service = _get_service(request)
    service.delete_conversation(conversation_id)
    return {"status": "ok"}


@router.put("/conversations/{conversation_id}/rename")
async def rename_conversation(conversation_id: str, body: ConversationRenameRequest, request: Request):
    """重命名对话"""
    service = _get_service(request)
    return service.rename_conversation(conversation_id, body.title)


@router.delete("/conversations/{conversation_id}/messages")
async def clear_conversation(conversation_id: str, request: Request):
    """清空对话消息"""
    service = _get_service(request)
    return service.clear_conversation(conversation_id)


# =============================================================================
# 流式聊天 (SSE)
# =============================================================================


@router.post("/conversations/{conversation_id}/chat")
async def chat_stream(conversation_id: str, body: ChatStreamRequest, request: Request):
    """
    流式聊天 —— 返回 SSE 事件流

    事件类型：
    - status: { conversation_id, status }
    - chunk/delta: { conversation_id, delta }
    - done: { conversation_id, full_text }
    - error: { conversation_id, message }
    """
    from sse_starlette.sse import EventSourceResponse

    service = _get_service(request)
    config = request.app.state.config

    stream_id = f"stream-{conversation_id}-{id(body)}"
    cancel_event = asyncio.Event()
    _active_streams[stream_id] = cancel_event

    async def event_generator():
        try:
            api_key = _get_api_key(request)

            async for event in service.chat_stream(
                conversation_id=conversation_id,
                agent_id=body.agent_id,
                message=body.message,
                config=config,
                api_key=api_key,
                signal=cancel_event,
            ):
                if cancel_event.is_set():
                    yield {
                        "event": "error",
                        "data": json.dumps({
                            "conversation_id": conversation_id,
                            "message": "请求已取消",
                        }, ensure_ascii=False),
                    }
                    return

                event_type = event.get("type", "")

                if event_type == "status":
                    yield {
                        "event": "status",
                        "data": json.dumps({
                            "conversation_id": conversation_id,
                            "status": event["status"],
                        }, ensure_ascii=False),
                    }
                elif event_type == "delta":
                    yield {
                        "event": "delta",
                        "data": json.dumps({
                            "conversation_id": conversation_id,
                            "delta": event["delta"],
                        }, ensure_ascii=False),
                    }
                elif event_type == "done":
                    # 构建 RAG chunks 列表
                    rag_chunks_raw = []
                    rag_context = event.get("rag_context")
                    if rag_context and rag_context.chunks:
                        rag_chunks_raw = [
                            {"text": c.text, "doc_title": c.doc_title, "score": c.score}
                            for c in rag_context.chunks
                        ]

                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "conversation_id": conversation_id,
                            "full_text": event["full_text"],
                            "rag_chunks": rag_chunks_raw,
                        }, ensure_ascii=False),
                    }
                elif event_type == "completed":
                    # 最终完成事件（包含完整 assistant message）
                    assistant_msg = event["assistant_message"]
                    yield {
                        "event": "completed",
                        "data": assistant_msg.model_dump_json(ensure_ascii=False),
                    }
                elif event_type == "error":
                    yield {
                        "event": "error",
                        "data": json.dumps({
                            "conversation_id": conversation_id,
                            "message": event["message"],
                        }, ensure_ascii=False),
                    }
        except asyncio.CancelledError:
            yield {
                "event": "error",
                "data": json.dumps({
                    "conversation_id": conversation_id,
                    "message": "请求已取消",
                }, ensure_ascii=False),
            }
        except Exception as e:
            logger.exception("流式聊天异常")
            yield {
                "event": "error",
                "data": json.dumps({
                    "conversation_id": conversation_id,
                    "message": str(e),
                }, ensure_ascii=False),
            }
        finally:
            _active_streams.pop(stream_id, None)

    return EventSourceResponse(event_generator())


@router.post("/conversations/{conversation_id}/cancel")
async def cancel_stream(conversation_id: str, body: dict):
    """取消流式请求"""
    stream_id = body.get("stream_id", "")
    if not stream_id:
        # 尝试找到对应的流并取消
        for sid, event in list(_active_streams.items()):
            if sid.startswith(f"stream-{conversation_id}-"):
                event.set()
        return {"cancelled": True}

    cancel_event = _active_streams.pop(stream_id, None)
    if cancel_event:
        cancel_event.set()
        return {"cancelled": True}
    return {"cancelled": False}


# =============================================================================
# 知识库 CRUD
# =============================================================================


@router.get("/knowledge-bases", response_model=list[KnowledgeBaseConfig])
async def list_knowledge_bases(request: Request):
    """获取知识库列表"""
    service = _get_service(request)
    return service.list_knowledge_bases()


@router.post("/knowledge-bases", response_model=KnowledgeBaseConfig)
async def save_knowledge_base(body: KnowledgeBaseSaveRequest, request: Request):
    """创建/更新知识库"""
    service = _get_service(request)
    return service.save_knowledge_base(
        _require_string(body.id, "id"),
        _require_string(body.name, "name"),
    )


@router.delete("/knowledge-bases/{kb_id}")
async def delete_knowledge_base(kb_id: str, request: Request):
    """删除知识库"""
    service = _get_service(request)
    service.delete_knowledge_base(kb_id)
    return {"status": "ok"}


@router.get("/knowledge-bases/{kb_id}/docs")
async def list_documents(kb_id: str, request: Request):
    """获取知识库文档列表"""
    service = _get_service(request)
    return service.list_documents(kb_id)


@router.post("/knowledge-bases/{kb_id}/docs")
async def save_document(kb_id: str, body: KnowledgeDocSaveRequest, request: Request):
    """保存知识库文档（触发重新索引）"""
    service = _get_service(request)
    config = request.app.state.config
    api_key = _get_api_key(request)

    doc = body.doc
    return await service.save_document(kb_id, doc, config, api_key)


@router.delete("/knowledge-bases/{kb_id}/docs/{doc_id}")
async def delete_document(kb_id: str, doc_id: str, request: Request):
    """删除知识库文档（触发重新索引）"""
    service = _get_service(request)
    config = request.app.state.config
    api_key = _get_api_key(request)

    await service.delete_document(kb_id, doc_id, config, api_key)
    return {"status": "ok"}


@router.post("/knowledge-bases/{kb_id}/reindex")
async def reindex_knowledge_base(kb_id: str, request: Request):
    """重建知识库索引"""
    service = _get_service(request)
    config = request.app.state.config
    api_key = _get_api_key(request)

    return await service.reindex(kb_id, config, api_key)
