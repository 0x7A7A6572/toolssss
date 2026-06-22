"""
自定义模块 Domain 路由

提供 AI 流式生成、取消、Prompt 增强的 HTTP 端点。

对应 TypeScript 端 custom-modules/index.ts
"""

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Request

from app.core.exceptions import ValidationError
from app.domains.custom_modules.service import enhance_prompt, run_module_stream
from app.models.custom_modules import (
    ModuleCancelRequest,
    ModuleEnhanceRequest,
    ModuleStreamRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# 活跃的流式请求
_active_module_streams: dict[str, asyncio.Event] = {}


def _generate_id() -> str:
    """生成唯一流 ID"""
    return f"stream-{int(time.time() * 1000)}-{id(object()) & 0xFFFF:04x}"


# =============================================================================
# 流式生成
# =============================================================================


@router.post("/stream")
async def module_stream(body: ModuleStreamRequest, request: Request):
    """
    自定义模块流式生成 —— 返回 SSE 事件流

    事件类型：
    - searching: { id, module_id, status }
    - delta: { id, module_id, delta }
    - done: { id, module_id, text, search_meta }
    - error: { id, module_id, message }
    """
    from sse_starlette.sse import EventSourceResponse

    if not body.module_id:
        raise ValidationError("模块 ID 不能为空")
    if not body.prompt:
        raise ValidationError("提示词不能为空")

    config = request.app.state.config
    api_key = config.api_key
    if not api_key:
        raise ValidationError("未配置 AI API Key")

    stream_id = _generate_id()
    cancel_event = asyncio.Event()
    _active_module_streams[stream_id] = cancel_event

    async def event_generator():
        try:
            async for event in run_module_stream(
                config=config,
                api_key=api_key,
                module_type=body.type,
                prompt=body.prompt,
                web_search=body.web_search,
                enable_markdown=body.enable_markdown,
                signal=cancel_event,
            ):
                if cancel_event.is_set():
                    yield {
                        "event": "error",
                        "data": json.dumps({
                            "id": stream_id,
                            "module_id": body.module_id,
                            "message": "已取消",
                        }, ensure_ascii=False),
                    }
                    return

                event_type = event.get("type", "")

                if event_type == "searching":
                    yield {
                        "event": "searching",
                        "data": json.dumps({
                            "id": stream_id,
                            "module_id": body.module_id,
                            "status": "searching",
                        }, ensure_ascii=False),
                    }
                elif event_type == "delta":
                    yield {
                        "event": "delta",
                        "data": json.dumps({
                            "id": stream_id,
                            "module_id": body.module_id,
                            "delta": event["delta"],
                        }, ensure_ascii=False),
                    }
                elif event_type == "done":
                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "id": stream_id,
                            "module_id": body.module_id,
                            "text": event["text"],
                            "search_meta": event.get("search_meta"),
                        }, ensure_ascii=False),
                    }
                elif event_type == "error":
                    yield {
                        "event": "error",
                        "data": json.dumps({
                            "id": stream_id,
                            "module_id": body.module_id,
                            "message": event["message"],
                        }, ensure_ascii=False),
                    }
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception("自定义模块流式异常")
            yield {
                "event": "error",
                "data": json.dumps({
                    "id": stream_id,
                    "module_id": body.module_id,
                    "message": str(e),
                }, ensure_ascii=False),
            }
        finally:
            _active_module_streams.pop(stream_id, None)

    return EventSourceResponse(event_generator())


@router.post("/cancel")
async def module_cancel(body: ModuleCancelRequest):
    """取消自定义模块生成"""
    cancel_event = _active_module_streams.pop(body.id, None)
    if cancel_event:
        cancel_event.set()
        return {"cancelled": True}
    return {"cancelled": False}


@router.post("/enhance")
async def enhance(body: ModuleEnhanceRequest, request: Request):
    """
    Prompt 增强 —— 使用 AI 优化用户提示词
    """
    if not body.title and not body.prompt:
        raise ValidationError("请至少输入模块名称或提示词")

    config = request.app.state.config
    api_key = config.api_key
    if not api_key:
        raise ValidationError("未配置 AI API Key")

    enhanced = await enhance_prompt(
        config=config,
        api_key=api_key,
        title=body.title,
        prompt=body.prompt,
        module_type=body.type,
    )

    return {"enhanced": enhanced}
